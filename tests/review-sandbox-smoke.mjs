#!/usr/bin/env node
// The portable assertions do not substitute for the native OS enforcement case.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createReviewSandbox, buildSeatbeltProfile, assertReviewSandboxProbe, captureRuntimeInstallation, checkExistingInstallationId } from "../pack/runtime/review-sandbox.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-outer-sandbox-")));
const project = path.join(root, "project with spaces");
const providerHome = path.join(root, "provider-home");
const evidence = path.join(root, "evidence");
const rulesDirectory = path.join(providerHome, "rules");
const ruleFile = path.join(rulesDirectory, "default.rules");
const installationFile = path.join(providerHome, "installation_id");
const installationId = crypto.randomUUID();
const source = path.join(project, "source.txt");
const contextFile = path.join(evidence, "context.json");
const sourceText = "readable source; unchanged after every restricted command\n";
const ruleText = 'prefix_rule(pattern = ["node", "review-write-probe"], decision = "allow")\n';
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/^(?:https?_proxy|all_proxy|no_proxy)$/i.test(name) && !/^CODEX_EXEC_SERVER_/i.test(name)));
let sandbox;

function execute(spec, childEnv, cwd = project) {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { cwd, env: childEnv, shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Outer sandbox specimen timed out.")); }, 15000);
    child.stdout.on("data", chunk => { stdout += chunk; if (stdout.length > 128 * 1024) child.kill("SIGKILL"); });
    child.stderr.on("data", chunk => { stderr += chunk; if (stderr.length > 128 * 1024) child.kill("SIGKILL"); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

function installedCodex() {
  for (const directory of (env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const file = path.join(directory, "codex");
    try {
      fs.accessSync(file, fs.constants.X_OK);
      if (fs.statSync(file).isFile()) return fs.realpathSync.native(file);
    } catch { /* Keep searching PATH; an absent CLI is reported explicitly. */ }
  }
  return null;
}

function inspectRealCodex(spec, childEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { cwd: project, env: childEnv, shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let pending = "";
    let bytes = 0;
    let step = 0;
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(new Error("Contained real Codex app-server initialization/configuration did not complete; no inference was requested."));
    };
    const timer = setTimeout(fail, 30000);
    const send = message => child.stdin.write(JSON.stringify(message) + "\n");
    child.once("error", fail);
    child.stdin.on("error", fail);
    child.stderr.on("data", chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) fail(); });
    child.stdout.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) return fail();
      pending += chunk.toString("utf8");
      let newline;
      while (!settled && (newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (!Object.hasOwn(message, "id") && typeof message.method === "string") continue;
          if (message.id !== step + 1 || message.error || !message.result) throw new Error();
          if (step === 0) {
            if (fs.realpathSync.native(message.result.codexHome) !== providerHome
                || message.result.platformOs !== "macos" || message.result.platformFamily !== "unix") throw new Error();
            step = 1;
            send({ method: "initialized" });
            send({ id: 2, method: "config/read", params: { includeLayers: true, cwd: project } });
          } else if (step === 1) {
            const config = message.result.config;
            if (config?.approval_policy !== "never" || config?.approvals_reviewer !== "user" || config?.sandbox_mode !== "read-only"
                || ["apps", "plugins", "hooks", "shell_snapshot", "shell_snapshot_v2"].some(name => config.features?.[name] !== false)
                || !Array.isArray(config.notify) || config.notify.length
                || Object.values(config.mcp_servers || {}).some(server => server.enabled !== false)) throw new Error();
            for (const key of ["sqlite_home", "log_dir"]) {
              if (typeof config[key] !== "string" || !config[key].startsWith(childEnv.TMPDIR + path.sep)) throw new Error();
            }
            step = 2;
            send({ id: 3, method: "configRequirements/read" });
          } else if (step === 2) {
            if (!Object.hasOwn(message.result, "requirements")) throw new Error();
            step = 3;
            child.stdin.end();
          } else throw new Error();
        } catch { fail(); }
      }
    });
    child.once("close", status => {
      if (settled) return;
      if (status !== 0 || step !== 3) return fail();
      settled = true;
      clearTimeout(timer);
      resolve();
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: `web-kit-review-${crypto.randomUUID()}`, version: "1", title: null }, capabilities: { experimentalApi: true, explicitGatewayOauth: true } } });
  });
}

try {
  for (const directory of [project, rulesDirectory, evidence]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(source, sourceText);
  fs.writeFileSync(ruleFile, ruleText);
  fs.writeFileSync(contextFile, JSON.stringify({ required_read: true }));
  fs.writeFileSync(installationFile, installationId, { mode: 0o644 });
  fs.chmodSync(installationFile, 0o644);

  const profile = buildSeatbeltProfile({ scratch: "/private/tmp/review \"quoted\" scratch", proxyPort: 43210 });
  assert.match(profile, /\(deny default\)/);
  assert.match(profile, /\(deny file-link\)/, "Scratch must not accept hardlinks to protected inodes.");
  assert(profile.includes("43210"), "The profile must bind network permission to this broker instance.");
  for (const scratch of ["relative/path", "/", "/private/tmp/unsafe\n(allow default)", "/private/tmp/unsafe\0path"]) {
    assert.throws(() => buildSeatbeltProfile({ scratch, proxyPort: 43210 }), `Unsafe profile path was accepted: ${JSON.stringify(scratch)}`);
  }
  for (const proxyPort of [0, -1, 65536, 1.5, NaN, Infinity, "443"]) {
    assert.throws(() => buildSeatbeltProfile({ scratch: "/private/tmp/review", proxyPort }), "Invalid proxy endpoint must not become policy source.");
  }
  const runtimeProfile = buildSeatbeltProfile({ scratch: "/private/tmp/review", proxyPort: 43210, installationId: "/private/tmp/codex-home/installation_id" });
  assert(runtimeProfile.includes('(allow file-write-data (literal "/private/tmp/codex-home/installation_id"))'), "Only the exact runtime file may receive writable-open permission.");
  assert(!runtimeProfile.includes('(allow file-write* (subpath "/private/tmp/codex-home"))'), "Runtime startup must not make the policy home writable.");
  for (const installationId of ["relative/installation_id", "/", "/private/tmp/review/installation_id", "/private/tmp/codex-home/config.toml", "/private/tmp/unsafe\n/installation_id"]) {
    assert.throws(() => buildSeatbeltProfile({ scratch: "/private/tmp/review", proxyPort: 43210, installationId }));
  }

  const expected = { nonce: "a".repeat(64), files: 3, directories: 2 };
  const booleans = ["reads_ok", "writable_opens_denied", "file_create_denied", "scratch_writable", "symlink_write_denied", "hardlink_denied", "descendant_write_denied", "proxy_reachable", "direct_tcp_denied", "unix_socket_denied", "runtime_state_open"];
  const proof = { schema_version: 1, nonce: expected.nonce, files_read: expected.files, directories_read: expected.directories, ...Object.fromEntries(booleans.map(key => [key, true])) };
  assert.doesNotThrow(() => assertReviewSandboxProbe(proof, expected));
  for (const key of booleans) {
    for (const value of [false, "true", 1, null, undefined]) {
      assert.throws(() => assertReviewSandboxProbe({ ...proof, [key]: value }, expected), `Unproven ${key} must prevent review.`);
    }
  }
  for (const invalid of [null, [], {}, { ...proof, nonce: "older-probe" }, { ...proof, files_read: 2 }, { ...proof, directories_read: 1 }, { ...proof, schema_version: 2 }, { ...proof, caller_verified: true }]) {
    assert.throws(() => assertReviewSandboxProbe(invalid, expected), "Stale, incomplete or caller-asserted protection must fail closed.");
  }
  console.log("Review sandbox input and probe validation: PASS");

  const probeScript = path.join(repo, "pack/runtime/review-sandbox-probe.mjs");
  const oversizedManifest = path.join(root, "oversized-manifest.json");
  fs.writeFileSync(oversizedManifest, Buffer.alloc(1024 * 1024 + 1, 32));
  const boundedProbe = file => {
    const result = spawnSync(process.execPath, [probeScript, file], { cwd: project, env, encoding: "utf8", windowsHide: true, timeout: 2000, maxBuffer: 65536 });
    assert.ifError(result.error);
    assert.equal(result.status, 1, "Untrusted manifest input must be refused promptly before verification.");
    assert.equal(result.stdout, "", "Invalid manifests must never produce a protection claim.");
  };
  boundedProbe(oversizedManifest);
  if (process.platform !== "win32") {
    const fifo = path.join(root, "manifest.fifo");
    const mkfifo = spawnSync("mkfifo", [fifo], { encoding: "utf8", timeout: 2000 });
    assert.ifError(mkfifo.error);
    assert.equal(mkfifo.status, 0, "The POSIX FIFO positive fixture must be created.");
    boundedProbe(fifo);
    console.log("Bounded oversized and FIFO probe-manifest rejection: PASS");

    const stateOptions = { codexHome: providerHome, repositoryRoot: project, evidenceDirectory: evidence, policyFiles: [ruleFile] };
    const resetInstallation = () => {
      fs.rmSync(installationFile, { force: true });
      fs.writeFileSync(installationFile, installationId, { mode: 0o644 });
      fs.chmodSync(installationFile, 0o644);
    };
    assert.equal(checkExistingInstallationId(stateOptions).exists, true);
    const captured = captureRuntimeInstallation(stateOptions);
    const opened = fs.openSync(installationFile, fs.constants.O_RDWR | fs.constants.O_CREAT, 0o644);
    assert.equal(fs.readFileSync(opened, "utf8"), installationId);
    fs.closeSync(opened);
    assert.doesNotThrow(() => captured.assertUnchanged(), "Codex's exact nonmutating O_RDWR|O_CREAT open must be accepted.");
    assert.equal(fs.readFileSync(installationFile, "utf8"), installationId);
    assert.equal(fs.lstatSync(installationFile).ino, captured.snapshot.ino);
    fs.writeFileSync(installationFile, crypto.randomUUID());
    assert.throws(() => captured.assertUnchanged(), "A replaced ID must invalidate the boundary even when it is another valid UUID.");
    resetInstallation();
    const beforeReplacement = captureRuntimeInstallation(stateOptions);
    const replacement = path.join(providerHome, "replacement-id");
    fs.writeFileSync(replacement, installationId, { mode: 0o644 });
    fs.chmodSync(replacement, 0o644);
    fs.renameSync(replacement, installationFile);
    assert.throws(() => beforeReplacement.assertUnchanged(), "Identical bytes on a replacement inode must not reuse the old boundary.");

    for (const value of ["", "not-a-uuid", "../policy-file", installationId + " unexpected data"]) {
      fs.writeFileSync(installationFile, value);
      assert.throws(() => checkExistingInstallationId(stateOptions));
      assert.throws(() => captureRuntimeInstallation(stateOptions));
    }
    resetInstallation();
    for (const mode of [0o600, 0o664, 0o666, 0o777, 0o2644, 0o4644]) {
      fs.chmodSync(installationFile, mode);
      assert.throws(() => checkExistingInstallationId(stateOptions));
      assert.throws(() => captureRuntimeInstallation(stateOptions));
    }
    resetInstallation();
    const idAlias = path.join(root, "installation-alias");
    fs.linkSync(installationFile, idAlias);
    assert.throws(() => checkExistingInstallationId(stateOptions));
    assert.throws(() => captureRuntimeInstallation(stateOptions));
    fs.unlinkSync(idAlias);
    fs.renameSync(installationFile, idAlias);
    fs.symlinkSync(idAlias, installationFile);
    assert.throws(() => checkExistingInstallationId(stateOptions));
    assert.throws(() => captureRuntimeInstallation(stateOptions));
    fs.unlinkSync(installationFile);
    fs.renameSync(idAlias, installationFile);
    assert.throws(() => captureRuntimeInstallation({ ...stateOptions, policyFiles: [ruleFile, installationFile] }), "A policy file cannot receive the runtime-state exception.");

    for (const parent of [project, evidence]) {
      const overlappingHome = path.join(parent, "provider-home");
      fs.mkdirSync(overlappingHome);
      const overlappingId = path.join(overlappingHome, "installation_id");
      fs.writeFileSync(overlappingId, installationId, { mode: 0o644 });
      fs.chmodSync(overlappingId, 0o644);
      assert.throws(() => captureRuntimeInstallation({ ...stateOptions, codexHome: overlappingHome }), "Repository or review evidence cannot contain writable runtime state.");
      if (parent === project) assert.throws(() => checkExistingInstallationId({ ...stateOptions, codexHome: overlappingHome }));
      fs.rmSync(overlappingHome, { recursive: true });
    }
    for (const target of [installationFile, providerHome, root]) {
      const repositoryAlias = path.join(project, "policy-state-alias");
      fs.symlinkSync(target, repositoryAlias);
      assert.throws(() => captureRuntimeInstallation(stateOptions), "Repository symlink aliases must not expose writable runtime state.");
      fs.unlinkSync(repositoryAlias);
    }
    const externalDirectory = path.join(root, "external-alias-directory");
    const ignoredDirectory = path.join(project, ".ignored-cache");
    fs.mkdirSync(externalDirectory);
    fs.mkdirSync(ignoredDirectory);
    fs.writeFileSync(path.join(project, ".gitignore"), ".ignored-cache/\n");
    fs.symlinkSync(externalDirectory, path.join(ignoredDirectory, "external"));
    fs.symlinkSync(installationFile, path.join(externalDirectory, "nested-id-alias"));
    assert.throws(() => captureRuntimeInstallation(stateOptions), "A nested external symlink reachable through an ignored repository directory must not expose the runtime ID.");
    fs.unlinkSync(path.join(externalDirectory, "nested-id-alias"));
    fs.symlinkSync(project, path.join(externalDirectory, "harmless-cycle"));
    assert.doesNotThrow(() => captureRuntimeInstallation(stateOptions), "A harmless directory-link cycle must terminate without granting or rejecting unrelated access.");
    fs.rmSync(ignoredDirectory, { recursive: true });
    fs.rmSync(externalDirectory, { recursive: true });
    fs.unlinkSync(installationFile);
    assert.equal(checkExistingInstallationId(stateOptions).exists, false, "First preflight may initialize a missing ID outside the repository.");
    assert.throws(() => captureRuntimeInstallation(stateOptions), "The protected run must have an existing validated ID.");
    assert.equal(fs.existsSync(installationFile), false, "Validation must not create the runtime ID itself.");
    resetInstallation();
    console.log("Runtime installation ID validity, identity and alias protection: PASS");

    const unprotectedScratch = path.join(root, "unprotected-probe-scratch");
    fs.mkdirSync(unprotectedScratch);
    const regularManifest = path.join(root, "valid-manifest.json");
    const linkedManifest = path.join(root, "linked-manifest.json");
    const listener = net.createServer(socket => socket.destroy());
    await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
    try {
      const nonce = "b".repeat(64);
      const manifestFiles = [source, ruleFile].map(file => ({ path: file, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") }));
      fs.writeFileSync(regularManifest, JSON.stringify({
        schema_version: 1, nonce, scratch: unprotectedScratch,
        read_files: manifestFiles, read_directories: [project, rulesDirectory],
        protected_files: manifestFiles.map(file => file.path), protected_directories: [project, rulesDirectory],
        sentinel: source, canary_name: ".web-kit-probe-" + nonce,
        tcp_port: listener.address().port, proxy_port: listener.address().port,
        unix_path: path.join(root, "missing-host.sock"), runtime_state: captureRuntimeInstallation(stateOptions).snapshot,
      }));
      const unprotected = await execute({ command: process.execPath, args: [probeScript, regularManifest] }, env);
      assert.equal(unprotected.status, 0, "A regular, valid manifest must reach the real probes.");
      const unprotectedReport = JSON.parse(unprotected.stdout);
      assert.equal(unprotectedReport.reads_ok, true);
      assert.equal(unprotectedReport.runtime_state_open, true);
      assert.equal(unprotectedReport.writable_opens_denied, false, "An ineffective wrapper must not receive verification credit.");
      assert.throws(() => assertReviewSandboxProbe(unprotectedReport, { nonce, files: 2, directories: 2 }));
      fs.symlinkSync(regularManifest, linkedManifest);
      boundedProbe(linkedManifest);
      assert.equal(fs.readFileSync(source, "utf8"), sourceText);
      assert.equal(fs.readFileSync(ruleFile, "utf8"), ruleText);
      console.log("Valid-manifest positive control, symlink refusal and ineffective-wrapper rejection: PASS");
    } finally { await new Promise(resolve => listener.close(resolve)); }
  } else {
    console.log("POSIX FIFO, ownership, permission and alias checks: NOT RUN on Windows (native backend unsupported).");
  }

  const options = { project, repositoryRoot: project, codexHome: providerHome, evidenceDirectory: evidence, policyFiles: [ruleFile], policyDirectories: [providerHome, rulesDirectory], env: { ...env, CODEX_HOME: providerHome }, deadline: Date.now() + 60000 };
  if (process.platform !== "darwin") {
    await assert.rejects(createReviewSandbox(options), /(?:macOS|darwin|unsupported|unavailable|outer sandbox)/i);
    await assert.rejects(createReviewSandbox({ ...options, env: { ...options.env, WEB_KIT_CODE_REVIEW_SANDBOX_VERIFIED: "1", SANDBOX_EXEC: process.execPath } }), /(?:macOS|darwin|unsupported|unavailable|outer sandbox)/i);
    assert.equal(fs.readFileSync(source, "utf8"), sourceText);
    assert.equal(fs.readFileSync(ruleFile, "utf8"), ruleText);
    console.log("Unsupported-platform outer sandbox rejection: PASS");
    console.log(`Native read/write enforcement: BLOCKED (requires macOS sandbox-exec; current platform ${process.platform}).`);
    console.log("Real Codex contained app-server startup: NOT RUN (requires the verified macOS boundary; no model inference requested).");
    if (process.env.WEB_KIT_REQUIRE_NATIVE_SANDBOX_TEST === "1") throw new Error("Native sandbox verification was required but could not run.");
  } else {
    sandbox = await createReviewSandbox(options);
    assert.equal(sandbox.env.CODEX_HOME, providerHome, "The real policy home must not be substituted.");
    assert.equal(sandbox.env.HOME, options.env.HOME);
    assert.equal(sandbox.provenance.backend, "macos-seatbelt");
    assert.doesNotThrow(() => sandbox.assertRuntimeStateUnchanged());
    const scratch = fs.realpathSync.native(sandbox.env.TMPDIR);
    assert(!scratch.startsWith(project + path.sep) && !project.startsWith(scratch + path.sep));
    const specimen = path.join(root, "write-specimen.mjs");
    fs.writeFileSync(specimen, `import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const [project, ruleFile, scratch] = process.argv.slice(2);
const read = fs.readFileSync(path.join(project, "source.txt"), "utf8").length > 0 && fs.readFileSync(ruleFile, "utf8").includes("prefix_rule");
const attempts = [
 ["open-rw", () => { const fd=fs.openSync(path.join(project,"open.txt"),"r+");fs.closeSync(fd); }],
 ["create", () => fs.writeFileSync(path.join(project,"created.txt"),"write",{flag:"wx"})],
 ["truncate", () => fs.truncateSync(path.join(project,"truncate.txt"),0)],
 ["rename", () => fs.renameSync(path.join(project,"rename.txt"),path.join(project,"renamed.txt"))],
 ["unlink", () => fs.unlinkSync(path.join(project,"unlink.txt"))],
 ["chmod", () => fs.chmodSync(path.join(project,"chmod.txt"),0o777)],
 ["policy-write", () => fs.appendFileSync(ruleFile,"# changed\\n")],
 ["symlink-write", () => { const alias=path.join(scratch,"source-link");fs.symlinkSync(path.join(project,"symlink.txt"),alias);fs.appendFileSync(alias,"write"); }],
 ["hardlink", () => fs.linkSync(path.join(project,"hardlink.txt"),path.join(scratch,"hardlink-alias"))],
 ["child-write", () => { const r=spawnSync(process.execPath,["-e","require('node:fs').appendFileSync(process.argv[1], 'write')",path.join(project,"child.txt")],{encoding:"utf8"}); if(r.error)throw r.error;if(r.status!==0) { const e=new Error("child denied");e.code="CHILD_DENIED";throw e;} }]
];
const results=attempts.map(([name,fn])=>{try{fn();return {name,denied:false};}catch(error){return {name,denied:true,code:error.code};}});
fs.writeFileSync(path.join(scratch,"scratch-write.txt"),"allowed");
console.log(JSON.stringify({read,results,scratch:true}));
`);
    const names = ["open", "truncate", "rename", "unlink", "chmod", "symlink", "hardlink", "child"];
    function resetSpecimens() {
      for (const name of names) fs.writeFileSync(path.join(project, name + ".txt"), "original\n", { mode: 0o600 });
      fs.chmodSync(path.join(project, "chmod.txt"), 0o600);
      for (const file of [path.join(project, "created.txt"), path.join(project, "renamed.txt"), path.join(scratch, "source-link"), path.join(scratch, "hardlink-alias"), path.join(scratch, "scratch-write.txt")]) fs.rmSync(file, { force: true });
      fs.writeFileSync(ruleFile, ruleText);
    }
    resetSpecimens();
    const spec = { command: process.execPath, args: [specimen, project, ruleFile, scratch] };
    const positive = await execute(spec, options.env);
    assert.equal(positive.status, 0, positive.stderr);
    const positiveReport = JSON.parse(positive.stdout);
    assert(positiveReport.read && positiveReport.scratch);
    assert(positiveReport.results.every(item => !item.denied), "The disposable write operations must work without the outer sandbox.");
    resetSpecimens();
    const protectedRun = await execute(sandbox.wrap(spec), sandbox.env);
    assert.equal(protectedRun.status, 0, protectedRun.stderr);
    const report = JSON.parse(protectedRun.stdout);
    assert(report.read && report.scratch, "Read access and private scratch writes must remain available.");
    assert(report.results.every(item => item.denied && ["EACCES", "EPERM", "EROFS", "CHILD_DENIED"].includes(item.code)), JSON.stringify(report));
    for (const name of names) assert.equal(fs.readFileSync(path.join(project, name + ".txt"), "utf8"), "original\n", `${name} changed despite the outer sandbox.`);
    assert.equal(fs.readFileSync(ruleFile, "utf8"), ruleText, "Configured policies were modified.");
    assert.equal(fs.readFileSync(source, "utf8"), sourceText);
    assert.equal(fs.readFileSync(installationFile, "utf8"), installationId);
    assert.doesNotThrow(() => sandbox.assertRuntimeStateUnchanged());
    console.log("Native read/write, aliases and descendant isolation: PASS");
    const codex = installedCodex();
    if (codex) {
      const configuration = ["--config", "features.apps=false", "--config", "features.plugins=false", "--config", "features.hooks=false", "--config", "features.shell_snapshot=false", "--config", "features.shell_snapshot_v2=false", "--config", "notify=[]", "--config", 'approval_policy="never"', "--config", 'approvals_reviewer="user"', "--config", 'sandbox_mode="read-only"', ...sandbox.configuration];
      await inspectRealCodex(sandbox.wrap({ command: codex, args: [...configuration, "app-server", "--strict-config", "--listen", "stdio://"] }), sandbox.env);
      assert.doesNotThrow(() => sandbox.assertRuntimeStateUnchanged());
      assert.equal(fs.readFileSync(installationFile, "utf8"), installationId);
      assert.equal(fs.readFileSync(ruleFile, "utf8"), ruleText);
      assert.equal(fs.readFileSync(source, "utf8"), sourceText);
      console.log("Real Codex contained app-server startup and unchanged runtime ID: PASS (initialize/configuration only; no inference).");
    } else {
      console.log("Real Codex contained app-server startup: NOT RUN (Codex is unavailable on PATH).");
      if (process.env.WEB_KIT_REQUIRE_NATIVE_SANDBOX_TEST === "1") throw new Error("Native verification requires actual contained Codex startup, but Codex is unavailable.");
    }
  }
} finally {
  if (sandbox) await sandbox.close();
  fs.rmSync(root, { recursive: true, force: true });
}
