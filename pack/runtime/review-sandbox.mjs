// An outer boundary for Codex allow rules, which can bypass its command sandbox.
// Never trust an environment flag, successful process exit, or a caller-supplied
// "verified" claim as evidence that this boundary was actually enforced.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startReviewProxy } from "./review-sandbox-proxy.mjs";

const SEATBELT = "/usr/bin/sandbox-exec";
const PROBE = fileURLToPath(new URL("./review-sandbox-probe.mjs", import.meta.url));
const MAX_FILES = 1024;
const MAX_READ_BYTES = 32 * 1024 * 1024;
// Only directory paths/frontier consume space as the scan grows. Bound
// those, and bound traversal time with the review's existing shared deadline.
const MAX_REPOSITORY_DIRECTORIES = 100000;
const DEFAULT_REPOSITORY_SCAN_TIMEOUT_MS = 180000;
const PROBE_FIELDS = Object.freeze([
  "reads_ok", "writable_opens_denied", "file_create_denied", "scratch_writable",
  "symlink_write_denied", "hardlink_denied", "descendant_write_denied",
  "proxy_reachable", "direct_tcp_denied", "unix_socket_denied",
  "runtime_state_open",
]);

function readBoundedRecord(file, maximum) {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > MAX_READ_BYTES) {
    throw new Error("Outer sandbox file-read budget is invalid.");
  }
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size > maximum) throw new Error("Outer sandbox input is not a bounded regular file.");
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(descriptor, bytes, length, bytes.length - length, length);
      if (!count) break;
      length += count;
    }
    const after = fs.fstatSync(descriptor);
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
        || after.ctimeMs !== before.ctimeMs || after.mode !== before.mode || after.uid !== before.uid
        || after.nlink !== before.nlink || after.dev !== before.dev || after.ino !== before.ino) {
      throw new Error("Outer sandbox input changed while being read.");
    }
    return { bytes: bytes.subarray(0, length), stat: after };
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function readBoundedFile(file, maximum) { return readBoundedRecord(file, maximum).bytes; }

function safeAbsolute(value) {
  return typeof value === "string" && path.isAbsolute(value) && value !== path.parse(value).root
    && !/[\x00-\x1f\x7f]/.test(value);
}

function quoted(value) {
  // SBPL supports the same quote/backslash escapes needed by filesystem paths.
  // Control characters are rejected rather than interpreted as profile syntax.
  if (!safeAbsolute(value) || path.resolve(value) !== value) throw new Error("Outer sandbox requires a safe canonical absolute scratch path.");
  return JSON.stringify(value);
}

export function buildSeatbeltProfile({ scratch, proxyPort, installationId = null }) {
  const directory = quoted(scratch);
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) throw new Error("Outer sandbox requires a valid proxy port.");
  let runtimePermission = "";
  if (installationId !== null) {
    const installation = quoted(installationId);
    if (path.basename(installationId) !== "installation_id" || within(installationId, scratch)) {
      throw new Error("Outer sandbox requires the exact existing Codex installation_id path outside scratch.");
    }
    runtimePermission = `(allow file-write-data (literal ${installation}))\n`;
  }
  // Operations and filters follow the native upstream policies, without PTY,
  // shared-memory, broad Mach, direct network or host execution permissions:
  // https://github.com/openai/codex/blob/main/codex-rs/sandboxing/src/seatbelt_base_policy.sbpl
  // https://github.com/openai/codex/blob/main/codex-rs/sandboxing/src/seatbelt_network_policy.sbpl
  // file-link is independent of file-write*: hard links must never turn a
  // protected inode into a writable scratch alias.
  // Native operation reference:
  // https://github.com/WebKit/WebKit/blob/main/Source/WebKit/Resources/SandboxProfiles/ios/com.apple.WebKit.Networking.sb.in
  return `(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow file-read*)
(allow file-write* (subpath ${directory}))
(deny file-link)
${runtimePermission}(allow file-write-data
  (require-all (literal "/dev/null") (vnode-type CHARACTER-DEVICE)))
(allow sysctl-read)
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
  (global-name "com.apple.SecurityServer")
  (global-name "com.apple.ocspd")
  (global-name "com.apple.trustd.agent")
  (global-name "com.apple.TrustEvaluationAgent"))
(allow network-outbound (remote ip "127.0.0.1:${proxyPort}"))
`;
}

export function assertReviewSandboxProbe(report, expected) {
  const keys = ["schema_version", "nonce", "files_read", "directories_read", ...PROBE_FIELDS].sort();
  const validExpected = expected && typeof expected === "object" && !Array.isArray(expected)
    && /^[a-f0-9]{64}$/.test(expected.nonce || "")
    && Number.isInteger(expected.files) && expected.files > 0
    && Number.isInteger(expected.directories) && expected.directories > 0;
  if (!validExpected || !report || typeof report !== "object" || Array.isArray(report)
      || JSON.stringify(Object.keys(report).sort()) !== JSON.stringify(keys)
      || report.schema_version !== 1 || report.nonce !== expected.nonce
      || report.files_read !== expected.files || report.directories_read !== expected.directories
      || PROBE_FIELDS.some(name => report[name] !== true)) {
    throw new Error("Codex outer sandbox verification failed: read-only filesystem, process inheritance or transport protection was not demonstrated.");
  }
}

function realDirectory(value, description) {
  if (!safeAbsolute(value)) throw new Error(`Outer sandbox cannot verify the ${description} directory.`);
  let directory;
  try {
    directory = fs.realpathSync.native(value);
    if (!fs.statSync(directory).isDirectory() || !safeAbsolute(directory)) throw new Error();
  } catch { throw new Error(`Outer sandbox cannot verify the ${description} directory.`); }
  return directory;
}

function within(file, directory) {
  // Be conservative on macOS volumes that fold case and Unicode. realpath
  // resolves aliases but may retain a caller's spelling on those volumes.
  const comparable = value => process.platform === "darwin" ? value.normalize("NFD").toLowerCase() : value;
  const relative = path.relative(comparable(directory), comparable(file));
  return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function runtimeSnapshot(file, record) {
  const stat = record.stat;
  return {
    path: file, sha256: crypto.createHash("sha256").update(record.bytes).digest("hex"),
    dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode, nlink: stat.nlink,
    size: stat.size, mtime_ms: stat.mtimeMs, ctime_ms: stat.ctimeMs,
  };
}

export function checkExistingInstallationId({ codexHome, repositoryRoot }) {
  const home = policyDirectory(codexHome).intended;
  const repository = realDirectory(repositoryRoot, "repository");
  const file = path.join(home, "installation_id");
  if (within(file, repository)) throw new Error("Codex installation_id must be outside the reviewed repository.");
  let leaf;
  try { leaf = fs.lstatSync(file); }
  catch (error) {
    if (error.code === "ENOENT") return Object.freeze({ exists: false, path: file });
    throw new Error("Codex installation_id could not be inspected before startup.");
  }
  let record;
  try {
    if (!leaf.isFile() || leaf.isSymbolicLink() || typeof process.getuid !== "function") throw new Error();
    record = readBoundedRecord(file, 256);
    if (leaf.dev !== record.stat.dev || leaf.ino !== record.stat.ino) throw new Error();
    if ((record.stat.mode & 0o7777) !== 0o644 || record.stat.uid !== process.getuid()
        || record.stat.nlink !== 1
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(record.bytes.toString("utf8").trim())) throw new Error();
  } catch {
    throw new Error("Codex outer sandbox requires an existing valid installation_id: a regular, singly linked file owned by the current user with mode 0644. Initialize Codex normally before retrying; the reviewer will not create or repair this runtime identifier.");
  }
  return Object.freeze({ exists: true, path: file, snapshot: Object.freeze(runtimeSnapshot(file, record)) });
}

function assertNoRepositoryAlias(repository, installationId, reviewDeadline) {
  const startedAt = Date.now();
  const pending = [];
  const visitedDirectories = new Set();
  let entries = 0;
  const exhausted = (reason, directory) => {
    throw new Error(`Outer sandbox repository alias scan exceeded its verification limits: ${reason}; `
      + `${entries} entries, ${visitedDirectories.size} unique directories, ${Math.max(0, Date.now() - startedAt)} ms elapsed; `
      + `directory ${JSON.stringify(directory)}. Review remains blocked; no incomplete scan can approve review.`);
  };
  const checkDeadline = directory => {
    if (Date.now() >= reviewDeadline) exhausted("review deadline exhausted", directory);
  };
  const queueDirectory = directory => {
    checkDeadline(directory);
    const canonical = fs.realpathSync.native(directory);
    const stat = fs.statSync(canonical);
    if (!stat.isDirectory()) {
      throw new Error("Outer sandbox repository alias scan encountered a changed directory; review remains blocked.");
    }
    // Inspect every incoming edge before deduplicating canonical paths. Do not
    // deduplicate by inode: mount aliases can share an inode while relative
    // symlink targets resolve differently through their different parents.
    if (within(installationId, canonical)) {
      throw new Error("Codex installation_id is reachable through a repository symlink; the operational-file exception is blocked.");
    }
    checkDeadline(canonical);
    if (visitedDirectories.has(canonical)) return;
    if (visitedDirectories.size >= MAX_REPOSITORY_DIRECTORIES) {
      exhausted(`unique-directory limit (${MAX_REPOSITORY_DIRECTORIES})`, canonical);
    }
    visitedDirectories.add(canonical);
    pending.push(canonical);
  };
  queueDirectory(repository);
  while (pending.length) {
    const directory = pending.pop();
    checkDeadline(directory);
    const opened = fs.opendirSync(directory, { bufferSize: 256 });
    try {
      let entry;
      while ((entry = opened.readSync()) !== null) {
        entries++;
        checkDeadline(directory);
        const file = path.join(directory, entry.name);
        // Recheck the leaf instead of trusting a stale directory entry's type.
        const current = fs.lstatSync(file);
        if (current.isSymbolicLink()) {
          let target;
          try { target = fs.realpathSync.native(file); }
          catch { throw new Error("Outer sandbox cannot resolve every repository symlink, including ignored paths; review remains blocked."); }
          if (within(installationId, target)) {
            throw new Error("Codex installation_id is reachable through a repository symlink; the operational-file exception is blocked.");
          }
          // A linked external directory can contain another link to the ID.
          // Inspect every reachable directory, with canonical deduplication so
          // harmless directory-link cycles do not evade limits or loop forever.
          if (fs.statSync(target).isDirectory()) queueDirectory(target);
        } else if (current.isDirectory()) {
          // Ignored content, such as node_modules and local caches, is part of
          // the same bounded reachability check.
          queueDirectory(file);
        }
      }
    } finally { opened.closeSync(); }
    // A slow final read/close (including an empty directory) must not turn an
    // expired review into a successful verification.
    checkDeadline(directory);
  }
}

export function captureRuntimeInstallation({ codexHome, repositoryRoot, evidenceDirectory, policyFiles, deadline = null }) {
  const repository = realDirectory(repositoryRoot, "repository");
  const evidence = realDirectory(evidenceDirectory, "review evidence");
  const existing = checkExistingInstallationId({ codexHome, repositoryRoot: repository });
  if (!existing.exists) throw new Error("Codex outer sandbox requires an existing installation_id. Initialize Codex normally before retrying; the reviewer will not create this runtime identifier.");
  if (!Array.isArray(policyFiles) || policyFiles.length > MAX_FILES
      || (deadline !== null && (!Number.isSafeInteger(deadline) || deadline <= Date.now()))) {
    throw new Error("Outer sandbox cannot verify Codex operational-file ownership and policy separation.");
  }
  const file = existing.path;
  const snapshot = existing.snapshot;
  const scanDeadline = deadline ?? Date.now() + DEFAULT_REPOSITORY_SCAN_TIMEOUT_MS;
  if (within(file, evidence)) throw new Error("Codex installation_id must be outside the review evidence.");
  for (const policyFile of policyFiles) {
    let policy;
    try { policy = fs.statSync(policyFile); }
    catch { throw new Error("Outer sandbox could not verify installation_id separation from policy files."); }
    if (!policy.isFile() || (policy.dev === snapshot.dev && policy.ino === snapshot.ino)
        || within(file, policyFile) || within(policyFile, file)) {
      throw new Error("Codex installation_id must not be a policy file or alias a policy inode.");
    }
  }
  // Codex opens this existing UUID read/write/create even for ephemeral runs:
  // https://github.com/openai/codex/blob/main/codex-rs/core/src/installation_id.rs
  // Only its exact data permission is granted; creation, rename, unlink and
  // permission changes remain denied. The exception is operational metadata,
  // never repository/configuration/rules access.
  const assertInstallationUnchanged = () => {
    let current;
    try { current = runtimeSnapshot(file, readBoundedRecord(file, 256)); }
    catch { throw new Error("Codex operational installation_id changed during review; the result cannot approve the task."); }
    if (Object.keys(snapshot).some(key => current[key] !== snapshot[key])) {
      throw new Error("Codex operational installation_id changed during review; the result cannot approve the task.");
    }
  };
  const assertUnchanged = () => {
    assertInstallationUnchanged();
    assertNoRepositoryAlias(repository, file, scanDeadline);
    // A large repository may take time to traverse. Do not accept an ID that
    // changed after the first read while its aliases were being inspected.
    assertInstallationUnchanged();
  };
  assertUnchanged();
  return Object.freeze({ path: file, snapshot, assertUnchanged });
}

function policyDirectory(value) {
  if (!safeAbsolute(value)) throw new Error("Outer sandbox cannot verify a policy directory.");
  let existing = path.resolve(value);
  const missing = [];
  for (;;) {
    let stat;
    try { stat = fs.lstatSync(existing); }
    catch (error) {
      if (error.code !== "ENOENT") throw new Error("Outer sandbox cannot inspect a policy directory ancestor.");
      const parent = path.dirname(existing);
      if (parent === existing) throw new Error("Outer sandbox cannot locate a policy directory ancestor.");
      missing.unshift(path.basename(existing));
      existing = parent;
      continue;
    }
    // Resolve an existing symlink only if it names a real directory. A dangling
    // link, non-directory component, or unexpected read error is not absence.
    let canonical;
    try {
      canonical = fs.realpathSync.native(existing);
      if ((!stat.isDirectory() && !stat.isSymbolicLink()) || !fs.statSync(canonical).isDirectory()) throw new Error();
    } catch { throw new Error("Outer sandbox cannot verify a policy directory ancestor."); }
    return { intended: path.join(canonical, ...missing), probe: canonical };
  }
}

function fileEvidence(files) {
  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES) throw new Error("Outer sandbox requires a bounded protected-file inventory.");
  let total = 0;
  return [...new Set(files)].map(file => {
    if (!safeAbsolute(file)) throw new Error("Outer sandbox cannot verify a protected file path.");
    const resolved = fs.realpathSync.native(file);
    const bytes = readBoundedFile(resolved, MAX_READ_BYTES - total);
    total += bytes.length;
    return { path: resolved, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  });
}

function repositoryReadSample(repository, context) {
  // Use the already captured change inventory first. Do not traverse or execute
  // arbitrary project code to find a file for the read probe.
  let candidates = [];
  try {
    const captured = JSON.parse(readBoundedFile(context, 1024 * 1024).toString("utf8"));
    if (Array.isArray(captured.snapshot?.files)) candidates = captured.snapshot.files.slice(0, 1024);
  } catch { throw new Error("Outer sandbox could not inspect captured review evidence."); }
  for (const relative of candidates) {
    if (typeof relative !== "string" || relative.includes("\0")) continue;
    const file = path.resolve(repository, relative);
    try {
      const real = fs.realpathSync.native(file);
      if (within(real, repository) && fs.statSync(real).isFile()) return real;
    } catch {}
  }
  const entries = fs.opendirSync(repository);
  try {
    let entry;
    let count = 0;
    while ((entry = entries.readSync()) !== null && count++ < 1024) {
      if (entry.isFile()) return path.join(repository, entry.name);
    }
  } finally { entries.closeSync(); }
  throw new Error("Outer sandbox could not identify a repository file for its read probe.");
}

function listen(server, address) {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("Outer sandbox could not prepare its local transport probe."));
    server.once("error", fail);
    server.listen(address, () => { server.removeListener("error", fail); resolve(); });
  });
}

function connectProbe(address) {
  return new Promise(resolve => {
    const socket = net.createConnection(address);
    const timer = setTimeout(() => finish(false), 1000);
    const finish = ok => { clearTimeout(timer); socket.destroy(); resolve(ok); };
    // Wait for the host listener's acknowledgement so its positive-control
    // accept cannot be mistaken for a later sandbox escape.
    socket.once("data", chunk => finish(chunk.toString() === "probe-ready"));
    socket.once("error", () => finish(false));
  });
}

function stopServer(server) {
  return new Promise(resolve => {
    if (!server?.listening) { resolve(); return; }
    server.close(() => resolve());
  });
}

function runProbe(spec, env, cwd, deadline) {
  const remaining = Math.min(15000, deadline - Date.now());
  if (remaining <= 0) throw new Error("Reviewer timed out before outer sandbox verification.");
  return new Promise((resolve, reject) => {
    // No additional inherited descriptors or host sockets enter the sandbox.
    const child = spawn(spec.command, spec.args, { cwd, env, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let bytes = 0;
    let output = "";
    let failed = false;
    let settled = false;
    const stop = () => {
      failed = true;
      if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
    };
    const interrupt = () => stop();
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const timer = setTimeout(stop, remaining);
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      if (failed || error || code !== 0) {
        reject(new Error("Codex outer sandbox native probe could not execute successfully; review remains blocked."));
        return;
      }
      try { resolve(JSON.parse(output)); }
      catch { reject(new Error("Codex outer sandbox native probe returned malformed verification evidence.")); }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 65536) stop();
      else output += chunk;
    });
    child.stderr.on("data", chunk => { bytes += chunk.length; if (bytes > 65536) stop(); });
    child.once("error", error => finish(null, error));
    child.once("close", code => finish(code));
  });
}

export async function createReviewSandbox({ project, repositoryRoot, codexHome, evidenceDirectory, policyFiles, policyDirectories, env, deadline }) {
  if (process.platform !== "darwin") {
    throw new Error("Codex configured .rules files require a verified outer sandbox. The native macOS backend is currently supported; this platform remains blocked.");
  }
  if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new Error("Reviewer timed out before outer sandbox setup.");
  try {
    const stat = fs.lstatSync(SEATBELT);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022)) throw new Error();
    fs.accessSync(SEATBELT, fs.constants.X_OK);
  } catch { throw new Error("Codex outer sandbox requires the system /usr/bin/sandbox-exec executable."); }
  if (!env || typeof env !== "object" || Array.isArray(env)
      || Object.entries(env).some(([key, value]) => /^(https?_proxy|all_proxy)$/i.test(key) && value)) {
    throw new Error("Codex outer sandbox cannot replace an existing proxy transport; review remains blocked.");
  }
  const workingDirectory = realDirectory(project, "project");
  const repository = realDirectory(repositoryRoot, "repository");
  const home = realDirectory(codexHome, "Codex policy");
  const evidence = realDirectory(evidenceDirectory, "review evidence");
  if (!within(workingDirectory, repository)) throw new Error("Outer sandbox project is outside the reviewed repository.");
  if (!Array.isArray(policyDirectories) || policyDirectories.length > MAX_FILES
      || !Array.isArray(policyFiles) || !policyFiles.length) throw new Error("Outer sandbox requires the configured policy inventory.");
  const runtimeState = captureRuntimeInstallation({ codexHome: home, repositoryRoot: repository, evidenceDirectory: evidence, policyFiles, deadline });
  const policyLocations = policyDirectories.map(policyDirectory);
  const protectedRoots = [...new Set([repository, home, evidence, ...policyLocations.map(item => item.intended)])];
  const directories = [...new Set([repository, home, evidence, ...policyLocations.map(item => item.probe)])];
  let scratch;
  let control;
  let proxy;
  let tcp;
  let unix;
  let closed = false;
  let manifest;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.allSettled([stopServer(tcp), stopServer(unix), proxy?.close()]);
    // A failed probe may have created only these specifically owned canaries.
    // Never remove another process's file in a real repository/policy folder.
    for (const directory of manifest?.protected_directories || []) {
      const file = path.join(directory, manifest.canary_name);
      try {
        const stat = fs.lstatSync(file);
        if (stat.isFile() && !stat.isSymbolicLink() && stat.size === manifest.nonce.length
            && readBoundedFile(file, manifest.nonce.length).toString("utf8") === manifest.nonce) fs.unlinkSync(file);
      } catch {}
    }
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    if (control) fs.rmSync(control, { recursive: true, force: true });
  };
  try {
    const temporaryRoot = fs.realpathSync.native(os.tmpdir());
    scratch = fs.mkdtempSync(path.join(temporaryRoot, "web-kit-review-sandbox-"));
    control = fs.mkdtempSync(path.join(temporaryRoot, "wk-probe-"));
    fs.chmodSync(scratch, 0o700);
    fs.chmodSync(control, 0o700);
    for (const protectedRoot of [...protectedRoots, ...policyFiles.map(file => fs.realpathSync.native(file)), control]) {
      if (within(scratch, protectedRoot) || within(protectedRoot, scratch)) throw new Error("Outer sandbox scratch must be separate from the repository, review evidence and every policy path.");
    }
    const nonce = crypto.randomBytes(32).toString("hex");
    const sentinel = path.join(control, "protected.txt");
    fs.writeFileSync(sentinel, nonce, { mode: 0o600, flag: "wx" });
    const context = path.join(evidence, "context.json");
    const readFiles = fileEvidence([sentinel, context, repositoryReadSample(repository, context), ...policyFiles]);
    const probeDirectories = [...new Set([...directories, control, ...readFiles.map(file => path.dirname(file.path))])];
    let unexpectedTcp = false;
    let unexpectedUnix = false;
    let checking = false;
    tcp = net.createServer(socket => {
      if (checking) { unexpectedTcp = true; socket.destroy(); }
      else socket.end("probe-ready");
    });
    unix = net.createServer(socket => {
      if (checking) { unexpectedUnix = true; socket.destroy(); }
      else socket.end("probe-ready");
    });
    await listen(tcp, { host: "127.0.0.1", port: 0 });
    const unixPath = path.join(control, "host.sock");
    // macOS Unix-domain names are bounded; use a short private temporary path.
    if (Buffer.byteLength(unixPath) > 100) throw new Error("Outer sandbox probe temporary path is too long for native Unix sockets.");
    await listen(unix, unixPath);
    const tcpPort = tcp.address().port;
    if (!await connectProbe({ host: "127.0.0.1", port: tcpPort }) || !await connectProbe({ path: unixPath })) {
      throw new Error("Outer sandbox transport probe positive control failed.");
    }
    proxy = await startReviewProxy({ allowedHosts: ["api.openai.com", "chatgpt.com", "auth.openai.com"], deadline });
    const profile = buildSeatbeltProfile({ scratch, proxyPort: proxy.port, installationId: runtimeState.path });
    const configuration = Object.freeze([
      "--config", `sqlite_home=${JSON.stringify(path.join(scratch, "sqlite"))}`,
      "--config", `log_dir=${JSON.stringify(path.join(scratch, "logs"))}`,
    ]);
    fs.mkdirSync(path.join(scratch, "sqlite"));
    fs.mkdirSync(path.join(scratch, "logs"));
    const proxyUrl = `http://127.0.0.1:${proxy.port}`;
    const childEnv = Object.freeze({
      ...env, TMPDIR: scratch, TMP: scratch, TEMP: scratch,
      CODEX_SQLITE_HOME: path.join(scratch, "sqlite"),
      HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl,
      http_proxy: proxyUrl, https_proxy: proxyUrl, all_proxy: proxyUrl,
      NO_PROXY: "", no_proxy: "",
    });
    const wrap = spec => {
      if (closed) throw new Error("Outer sandbox has already closed.");
      if (!spec || !safeAbsolute(spec.command) || !Array.isArray(spec.args)
          || spec.args.some(arg => typeof arg !== "string" || arg.includes("\0"))) throw new Error("Outer sandbox requires an explicit executable and literal arguments.");
      return { command: SEATBELT, args: ["-p", profile, spec.command, ...spec.args] };
    };
    manifest = {
      schema_version: 1, nonce, scratch, read_files: readFiles,
      read_directories: probeDirectories, protected_files: readFiles.map(file => file.path),
      protected_directories: probeDirectories, sentinel,
      canary_name: `.web-kit-review-probe-${nonce}`,
      tcp_port: tcpPort, unix_path: unixPath, proxy_port: proxy.port,
      runtime_state: runtimeState.snapshot,
    };
    const manifestPath = path.join(control, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600, flag: "wx" });
    checking = true;
    const report = await runProbe(wrap({ command: process.execPath, args: [PROBE, manifestPath] }), childEnv, workingDirectory, deadline);
    assertReviewSandboxProbe(report, { nonce, files: readFiles.length, directories: probeDirectories.length });
    runtimeState.assertUnchanged();
    if (unexpectedTcp || unexpectedUnix) throw new Error("Codex outer sandbox failed to isolate host transport services.");
    let recheckedBytes = 0;
    for (const file of readFiles) {
      const bytes = readBoundedFile(file.path, MAX_READ_BYTES - recheckedBytes);
      recheckedBytes += bytes.length;
      if (crypto.createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("Protected files changed during outer sandbox verification.");
    }
    await Promise.all([stopServer(tcp), stopServer(unix)]);
    const provenance = Object.freeze({
      backend: "macos-seatbelt", schema_version: 1, verified: true,
      protected_filesystem_read_only: true, inherited_by_children: true,
      policy_files_read: policyFiles.length, host_socket_probes_denied: true,
      writable_runtime_metadata: Object.freeze(["installation_id"]),
      network: "bounded-model-connect-proxy", profile_sha256: crypto.createHash("sha256").update(profile).digest("hex"),
    });
    return Object.freeze({ wrap, env: childEnv, configuration, provenance, assertRuntimeStateUnchanged: runtimeState.assertUnchanged, close });
  } catch (error) {
    await close();
    throw error;
  }
}
