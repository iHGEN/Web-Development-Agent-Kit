#!/usr/bin/env node

// A conservative, Node-only check for accidental changes outside a task's scope.
// It never stages, reverts, deletes, commits, pushes or changes branches.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { repositoryContext, sameDirectory } from "./project-paths.mjs";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { allow: [] };
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (!key.startsWith("--") || i + 1 >= rest.length) throw new Error(`Invalid argument: ${key}`);
    const value = rest[++i];
    if (key === "--allow") options.allow.push(value);
    else if (["--project", "--task-id", "--base", "--intent", "--reason", "--evidence"].includes(key)) {
      options[key.slice(2)] = value;
    } else throw new Error(`Unknown option: ${key}`);
  }
  return { command, options };
}

function git(project, args, input) {
  const result = spawnSync("git", args, { cwd: project, input, encoding: "buffer", maxBuffer: 50 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`git ${args.slice(0, 3).join(" ")} failed: ${result.error?.message || result.stderr?.toString("utf8").trim()}`);
  }
  return result.stdout;
}

function gitText(project, args) { return git(project, args).toString("utf8").trim(); }
function gitPaths(project, args) { return git(project, args).toString("utf8").split("\0").filter(Boolean); }
function digest(data) { return crypto.createHash("sha256").update(data).digest("hex"); }
function fileDigest(file) {
  // Fingerprint large user assets without loading them into memory. A size cap
  // would prevent scope locking when an unrelated untracked asset is >32 MiB.
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(file, "r");
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}
function trackedStateFiles(project, comparisonBase = null, statePrefix = ".agent-core/state/", head = "HEAD") {
  // Generated state is exempt only while untracked. A tracked state file is real
  // repository content and must not be hidden from the scope fence.
  return new Set([
    ...gitPaths(project, ["ls-tree", "-r", "--name-only", "-z", head, "--", statePrefix]),
    ...(comparisonBase ? gitPaths(project, ["ls-tree", "-r", "--name-only", "-z", comparisonBase, "--", statePrefix]) : []),
    ...gitPaths(project, ["ls-files", "--cached", "-z", "--", statePrefix]),
  ]);
}
function isGeneratedState(file, tracked = new Set(), statePrefix = ".agent-core/state/") {
  return file.startsWith(statePrefix) && !tracked.has(file);
}

function validPath(file) {
  if (typeof file !== "string" || !file || file.startsWith("/") || /^[a-zA-Z]:/.test(file)
    || file.includes("\\") || file.includes("\0") || /[*?\[\]]/.test(file)) {
    throw new Error(`Scope requires an exact relative file path, not a glob: ${file}`);
  }
  const parts = file.split("/");
  if (parts.some(p => !p || p === "." || p === ".." || p === ".git")
    || parts.some((p, i) => p === ".agent-core" && parts[i + 1] === "state")) {
    throw new Error(`Unsafe or generated-state path in task scope: ${file}`);
  }
  return file;
}

function currentBranch(project) {
  return gitText(project, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
}

function statusEntries(project, statePrefix) {
  const entries = new Map();
  const tracked = trackedStateFiles(project, null, statePrefix);
  for (const record of gitPaths(project, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"])) {
    if (record.length < 4 || record[2] !== " ") throw new Error("Could not parse git status safely");
    const file = record.slice(3);
    if (!isGeneratedState(file, tracked, statePrefix)) entries.set(file, record.slice(0, 2));
  }
  return entries;
}

function fingerprint(project, file, status) {
  if (status === "??") {
    const fullPath = path.join(project, file);
    const info = fs.lstatSync(fullPath);
    if (info.isSymbolicLink()) return digest(`link:${fs.readlinkSync(fullPath)}`);
    if (!info.isFile()) throw new Error(`Cannot safely fingerprint untracked file: ${file}`);
    return fileDigest(fullPath);
  }
  return digest(git(project, ["diff", "--binary", "--no-ext-diff", "HEAD", "--", file]));
}

function indexSnapshot(project) {
  const entries = new Map();
  for (const entry of gitPaths(project, ["ls-files", "--stage", "-z"])) {
    const split = entry.indexOf("\t");
    if (split < 0) throw new Error("Cannot parse Git index safely");
    const metadata = entry.slice(0, split);
    const name = entry.slice(split + 1);
    if (!/^\d{6} [a-f0-9]{40,64} [0-3]$/.test(metadata)) throw new Error(`Invalid Git index metadata for ${name}`);
    if (!metadata.endsWith(" 0")) throw new Error(`Unresolved Git conflict must be resolved before review: ${name}`);
    entries.set(name, metadata);
  }
  return entries;
}

function workingFingerprint(project, file, indexEntries) {
  const fullPath = path.join(project, file);
  const index = indexEntries.get(file);
  let info;
  try { info = fs.lstatSync(fullPath); }
  catch (error) {
    if (error.code === "ENOENT") {
      // An uninitialized submodule may be absent from the worktree while its
      // gitlink is still present in the proposed PR tree.
      return index?.startsWith("160000 ") ? `gitlink:${index}` : "deleted";
    }
    throw error;
  }
  if (info.isSymbolicLink()) return `link:${digest(fs.readlinkSync(fullPath))}`;
  if (info.isFile()) {
    const mode = process.platform === "win32" && index
      ? index.slice(0, 6) : info.mode & 0o111 ? "100755" : "100644";
    return `file:${mode}:${fileDigest(fullPath)}`;
  }
  if (info.isDirectory() && index?.startsWith("160000 ")) {
    const actualRoot = gitText(fullPath, ["rev-parse", "--show-toplevel"]);
    if (!sameDirectory(actualRoot, fullPath)) throw new Error(`Submodule is not checked out: ${file}`);
    return `gitlink:160000 ${gitText(fullPath, ["rev-parse", "--verify", "HEAD"])}`;
  }
  throw new Error(`Cannot safely fingerprint changed non-file path: ${file}`);
}

function untrackedShape(project, file) {
  let directory = project;
  let safeParents = true;
  for (const part of file.split("/").slice(0, -1)) {
    directory = path.join(directory, part);
    const info = fs.lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) safeParents = false;
  }
  const info = fs.lstatSync(path.join(project, file));
  return {
    type: info.isSymbolicLink() ? "symlink" : info.isFile() ? "file" : "other",
    mode: info.mode & 0o111 ? "100755" : "100644",
    links: info.nlink,
    safe_parents: safeParents,
  };
}

function hasContentEditBaseline(before) {
  const shape = before?.untracked_shape;
  return before?.status === "??" && shape?.type === "file" && shape.links === 1
    && shape.safe_parents === true && ["100644", "100755"].includes(shape.mode)
    && before.index_entry === null && before.head_present === false;
}

function headEntry(project, file) {
  const entries = gitPaths(project, ["--literal-pathspecs", "ls-tree", "-z", "HEAD", "--", file]);
  if (!entries.length) return null;
  const entry = /^(\d{6}) \w+ ([a-f0-9]{40,64})\t/.exec(entries[0]);
  if (!entry || entries.length !== 1) throw new Error(`Cannot safely read HEAD entry for ${file}`);
  return `${entry[1]} ${entry[2]} 0`;
}

function contentEditAllowed(project, file, before, status, indexEntries) {
  if (!hasContentEditBaseline(before)) return false;
  try {
    const shape = untrackedShape(project, file);
    if (shape.type !== "file" || shape.links !== 1 || !shape.safe_parents
      || shape.mode !== before.untracked_shape.mode) return false;
    const index = indexEntries.get(file);
    const committed = headEntry(project, file);
    if (!index) return status === "??" && committed === null;
    if (index.slice(0, 6) !== shape.mode) return false;
    if (index === committed) return true;
    // A new or changed staged version must equal the effective worktree.
    // Use Git's normalization so CRLF/check-out filters do not look like drift.
    const normalized = gitText(project, ["hash-object", `--path=${file}`, "--", file]);
    return index.split(" ")[1] === normalized;
  } catch { return false; }
}

function snapshotExisting(project, statePrefix) {
  const entries = statusEntries(project, statePrefix);
  const indexEntries = indexSnapshot(project);
  const headPaths = new Set(gitPaths(project, ["ls-tree", "-r", "-t", "--name-only", "-z", "HEAD"]));
  return Object.fromEntries([...entries].map(([file, status]) => {
    const snapshot = { status, fingerprint: fingerprint(project, file, status) };
    // A tracked dirty file can have distinct staged and working-tree versions.
    // `git diff HEAD` alone cannot detect staged-only drift when `MM` stays MM.
    snapshot.index_entry = indexEntries.get(file) ?? null;
    if (status === "??") {
      snapshot.untracked_shape = untrackedShape(project, file);
      snapshot.head_present = headPaths.has(file);
    }
    return [file, snapshot];
  }));
}

function changePaths(project, base, statePrefix, head = "HEAD") {
  const mergeBase = gitText(project, ["merge-base", base, head]);
  const committed = gitPaths(project, ["diff", "--name-only", "--no-renames", "-z", mergeBase, head]);
  const staged = gitPaths(project, ["diff", "--cached", "--name-only", "--no-renames", "-z", head]);
  const unstaged = gitPaths(project, ["diff", "--name-only", "--no-renames", "-z"]);
  // A committed deletion is still a real PR change even after the path vanished
  // from HEAD and the index. Preserve paths tracked at the comparison baseline.
  const tracked = trackedStateFiles(project, mergeBase, statePrefix, head);
  const untracked = gitPaths(project, ["ls-files", "--others", "--exclude-standard", "-z"])
    .filter(file => !isGeneratedState(file, tracked, statePrefix));
  return [...new Set([...committed, ...staged, ...unstaged, ...untracked])]
    .filter(file => !isGeneratedState(file, tracked, statePrefix)).sort();
}

function normalizedWorkingEntry(project, file, indexEntries) {
  const fullPath = path.join(project, file);
  const index = indexEntries.get(file);
  let info;
  try { info = fs.lstatSync(fullPath); }
  catch (error) {
    if (error.code === "ENOENT") return index?.startsWith("160000 ") ? index : null;
    throw error;
  }
  if (info.isSymbolicLink()) {
    const object = git(project, ["hash-object", "--stdin"], fs.readlinkSync(fullPath, { encoding: "buffer" })).toString("utf8").trim();
    return `120000 ${object} 0`;
  }
  if (info.isFile()) {
    const mode = process.platform === "win32" && index
      ? index.slice(0, 6) : info.mode & 0o111 ? "100755" : "100644";
    return `${mode} ${gitText(project, ["hash-object", `--path=${file}`, "--", file])} 0`;
  }
  if (info.isDirectory() && index?.startsWith("160000 ")) {
    if (!sameDirectory(gitText(fullPath, ["rev-parse", "--show-toplevel"]), fullPath)) {
      throw new Error(`Submodule is not checked out: ${file}`);
    }
    return `160000 ${gitText(fullPath, ["rev-parse", "--verify", "HEAD"])} 0`;
  }
  throw new Error(`Cannot safely fingerprint changed non-file path: ${file}`);
}

function publicationState(project, paths, head, indexEntries) {
  const entries = new Map();
  for (const record of gitPaths(project, ["ls-tree", "-r", "-z", head])) {
    const split = record.indexOf("\t");
    const metadata = /^(100644|100755|120000|160000) (?:blob|commit) ([a-f0-9]{40,64})$/.exec(record.slice(0, split));
    if (split < 0 || !metadata) throw new Error("Cannot safely parse publication tree entries");
    entries.set(record.slice(split + 1), `${metadata[1]} ${metadata[2]} 0`);
  }
  return paths.map(file => ({
    file,
    head_entry: entries.get(file) ?? null,
    working_entry: normalizedWorkingEntry(project, file, indexEntries),
  }));
}

function changeDigest(project, base, paths, head, indexEntries, workingEntries) {
  const mergeBase = gitText(project, ["merge-base", base, head]);
  const hash = crypto.createHash("sha256");
  hash.update("web-kit-pr-diff-v2\0");
  hash.update(mergeBase);
  // A content-equivalent `git add` or `git commit` must NOT invalidate a prior
  // review. Hash the effective working tree once, irrespective of whether a
  // changed file is committed, staged, or untracked.
  for (const file of paths) {
    hash.update(file);
    hash.update("\0");
    hash.update(workingFingerprint(project, file, indexEntries));
    hash.update("\0");
  }
  // Keep staged-only code visible when the index and working tree disagree.
  // Do not include the index when it matches the worktree: that would cause a
  // redundant review for a normal add/commit with no content change.
  const staged = new Set(gitPaths(project, ["diff", "--cached", "--name-only", "--no-renames", "-z", head]));
  const unstaged = new Set(gitPaths(project, ["diff", "--name-only", "--no-renames", "-z"]));
  const divergent = [...staged].filter(file => unstaged.has(file)).sort();
  if (divergent.length) {
    for (const file of divergent) {
      hash.update("staged-version\0");
      hash.update(file);
      hash.update("\0");
      hash.update(indexEntries.get(file) || "deleted-in-index");
      hash.update("\0");
    }
  }
  // A push publishes HEAD, even when an authorized edit restored different
  // reviewed content only in the worktree. Bind those committed variants too.
  // Include only PR changes that differ from Git-normalized working content:
  // equivalent add/commit (including CRLF) must preserve the review identity.
  const relevant = new Set(paths);
  const committed = gitPaths(project, ["diff", "--raw", "--no-abbrev", "--no-ext-diff", "--no-renames",
    "--ignore-submodules=none", "-z", mergeBase, head]);
  for (let i = 0; i < committed.length; i += 2) {
    const metadata = /^:\d{6} (\d{6}) [a-f0-9]{40,64} ([a-f0-9]{40,64}) [A-Z]$/.exec(committed[i]);
    const file = committed[i + 1];
    if (!metadata || !file) throw new Error("Cannot safely parse committed Git changes");
    if (!relevant.has(file)) continue;
    const entry = metadata[1] === "000000" ? null : `${metadata[1]} ${metadata[2]} 0`;
    if (!workingEntries.has(file)) throw new Error(`Missing publication evidence for ${file}`);
    if (entry === workingEntries.get(file)) continue;
    hash.update("committed-version\0");
    hash.update(file);
    hash.update("\0");
    hash.update(entry || "deleted-in-head");
    hash.update("\0");
  }
  return hash.digest("hex");
}

function manifestPath(project, taskId) {
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(taskId || "") || taskId === "." || taskId === "..") {
    throw new Error("--task-id must be a safe Work Progress task ID");
  }
  let directory = project;
  for (const part of [".agent-core", "state", "scope"]) {
    directory = path.join(directory, part);
    try {
      const info = fs.lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe scope state directory: ${directory}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const file = path.join(directory, `${taskId}.json`);
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error("Scope manifest must not be a symlink");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return file;
}

function readManifest(file, context) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(manifest.allowed_paths) || !manifest.preexisting || !manifest.base || !manifest.branch) {
    throw new Error("Invalid or incomplete scope manifest");
  }
  manifest.allowed_paths.forEach(validPath);
  if (manifest.version === 3) {
    if (manifest.project_prefix !== context.projectPrefix || typeof manifest.repository_root !== "string"
      || !sameDirectory(manifest.repository_root, context.repositoryRoot)) {
      throw new Error("Scope belongs to a different project or Git repository; create a task scope for this project.");
    }
  } else if (context.projectPrefix) {
    throw new Error("A nested project requires a scope created with repository-relative paths.");
  }
  return manifest;
}

function writeManifest(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function check(project, manifest, statePrefix) {
  if (currentBranch(project) !== manifest.branch) throw new Error(`Task is locked to branch ${manifest.branch}`);
  const head = gitText(project, ["rev-parse", "--verify", "HEAD"]);
  const changed = changePaths(project, manifest.base, statePrefix, head);
  const status = statusEntries(project, statePrefix);
  const indexEntries = indexSnapshot(project);
  const preexistingChanged = [];
  const authorizedChanges = [];
  const allowed = new Set(manifest.allowed_paths);
  const authorized = new Set((manifest.extensions || [])
    .filter(entry => entry.kind === "preexisting-untracked-content")
    .map(entry => {
      if (!allowed.has(entry.path) || !hasContentEditBaseline(manifest.preexisting[entry.path])
        || !entry.reason?.trim() || !entry.evidence?.trim()) {
        throw new Error("Invalid pre-existing content-edit authorization in scope manifest");
      }
      return entry.path;
    }));
  for (const [file, before] of Object.entries(manifest.preexisting)) {
    if (before.status !== "??" && !Object.hasOwn(before, "index_entry")) {
      // Older locks did not record staged data. Do not silently certify that
      // user work was preserved when the original index state is unknowable.
      throw new Error(`Scope lock lacks the staged baseline for ${file}; create a new task scope after reviewing existing user edits`);
    }
    const current = status.get(file);
    const indexChanged = before.status !== "??" && (indexEntries.get(file) ?? null) !== before.index_entry;
    const contentAuthorized = authorized.has(file) && contentEditAllowed(project, file, before, current, indexEntries);
    if (current !== before.status || indexChanged || (current && fingerprint(project, file, current) !== before.fingerprint)
      || (authorized.has(file) && !contentAuthorized)) {
      preexistingChanged.push(file);
      if (contentAuthorized) authorizedChanges.push(file);
    }
  }
  const taskChanges = [...new Set([...changed, ...preexistingChanged])]
    .filter(file => !(file in manifest.preexisting) || preexistingChanged.includes(file)).sort();
  const unexpected = taskChanges.filter(file => !allowed.has(file));
  const protectedChanges = preexistingChanged.filter(file => !authorizedChanges.includes(file));
  const errors = [];
  if (protectedChanges.length) errors.push("Protected pre-existing user changes were altered; content-edit authorization does not permit divergent staged content, deletion, mode/type changes or linked-file writes.");
  if (unexpected.length) errors.push("Task changed files outside its declared scope: stop and justify/approve before proceeding.");
  if (!taskChanges.length) errors.push("No task changes found for a pre-PR review.");
  const publication = publicationState(project, changed, head, indexEntries);
  const workingEntries = new Map(publication.map(entry => [entry.file, entry.working_entry]));
  const change = changeDigest(project, manifest.base, changed, head, indexEntries, workingEntries);
  if (gitText(project, ["rev-parse", "--verify", "HEAD"]) !== head) throw new Error("HEAD changed while collecting scope publication evidence");
  return {
    verdict: errors.length ? "FAIL" : "PASS",
    task_id: manifest.task_id,
    branch: manifest.branch,
    base: manifest.base,
    change_digest: change,
    publication_head: head,
    publication_state: publication,
    intended_changes: taskChanges.filter(file => allowed.has(file)),
    unexpected_paths: unexpected,
    preexisting_changed: preexistingChanged,
    authorized_preexisting_changes: authorizedChanges,
    protected_preexisting_changes: protectedChanges,
    untouched_preexisting_count: Object.keys(manifest.preexisting).length - preexistingChanged.length,
    scope_extensions: manifest.extensions || [],
    errors,
  };
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!(["start", "extend", "authorize", "check"].includes(command))) {
    throw new Error("Usage: scope-guard.mjs start --task-id ID --base main --intent TEXT --allow path [--allow path] | extend/authorize --task-id ID --allow path --reason TEXT --evidence REF | check --task-id ID");
  }
  const context = repositoryContext(options.project || ".");
  const { projectRoot: project, repositoryRoot: root, projectPrefix, statePrefix } = context;
  const file = manifestPath(project, options["task-id"]);

  if (command === "start") {
    if (fs.existsSync(file)) throw new Error("Scope already locked for this task; do not overwrite its baseline");
    const base = options.base;
    const branch = currentBranch(root);
    if (!base || !options.intent?.trim() || !options.allow.length) throw new Error("start requires --base, --intent, and one or more --allow paths");
    if (branch === base || branch === base.replace(/^origin\//, "")) throw new Error("Use a feature branch, not the base branch");
    gitText(root, ["rev-parse", "--verify", `${base}^{commit}`]);
    gitText(root, ["merge-base", base, "HEAD"]);
    const allowed = [...new Set(options.allow.map(validPath))];
    const manifest = {
      version: 3, task_id: options["task-id"], intent: options.intent, branch, base,
      repository_root: root, project_prefix: projectPrefix,
      allowed_paths: allowed, preexisting: snapshotExisting(root, statePrefix), extensions: [],
    };
    writeManifest(file, manifest);
    process.stdout.write(`${JSON.stringify({ verdict: "LOCKED", task_id: manifest.task_id, branch, base, allowed_paths: allowed, preexisting_count: Object.keys(manifest.preexisting).length }, null, 2)}\n`);
    return;
  }

  if (command === "extend" || command === "authorize") {
    if (options.allow.length !== 1 || !options.reason?.trim() || !options.evidence?.trim()) {
      throw new Error(`${command} requires exactly one --allow path, --reason and --evidence`);
    }
    const lock = `${file}.lock`;
    try { fs.mkdirSync(lock); } catch { throw new Error("Scope update already in progress or a stale lock needs investigation"); }
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      const latest = readManifest(file, context);
      const extra = validPath(options.allow[0]);
      if (currentBranch(root) !== latest.branch) throw new Error("Branch changed since scope was locked");
      latest.extensions ||= [];
      if (command === "authorize") {
        if (!latest.allowed_paths.includes(extra)) throw new Error("Content-edit authorization requires an already allowed exact path");
        const before = latest.preexisting[extra];
        if (before?.status !== "??") throw new Error("Content-edit authorization is limited to initially untracked files");
        if (!before.untracked_shape) throw new Error("Existing scope lacks required baseline type evidence; cannot authorize this path safely. Preserve the original scope and review its existing evidence.");
        if (!hasContentEditBaseline(before)) throw new Error("Content-edit authorization requires a baseline regular file absent from HEAD/index and without symlink or hardlink aliases");
        if (!contentEditAllowed(root, extra, before, statusEntries(root, statePrefix).get(extra), indexSnapshot(root))) {
          throw new Error("Content-edit authorization cannot permit divergent staged content, deletion, mode/type changes or linked-file writes");
        }
        if (latest.extensions.some(entry => entry.kind === "preexisting-untracked-content" && entry.path === extra)) {
          throw new Error("Pre-existing content edits are already authorized for this path");
        }
      } else {
        if (latest.allowed_paths.includes(extra)) throw new Error("Path is already allowed");
        if (extra in latest.preexisting || changePaths(root, latest.base, statePrefix).includes(extra)) {
          throw new Error("Cannot retroactively approve an already dirty/changed path");
        }
        latest.allowed_paths.push(extra);
      }
      latest.extensions.push({ path: extra, ...(command === "authorize" ? { kind: "preexisting-untracked-content" } : {}),
        reason: options.reason, evidence: options.evidence, recorded_at: new Date().toISOString() });
      fs.writeFileSync(temporary, `${JSON.stringify(latest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      fs.renameSync(temporary, file);
      process.stdout.write(`${JSON.stringify({ verdict: command === "authorize" ? "AUTHORIZED" : "EXTENDED", path: extra,
        ...(command === "authorize" ? { permission: "content-edit", staging: "content-equivalent-only" } : {}),
        reason: options.reason, evidence: options.evidence }, null, 2)}\n`);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      fs.rmdirSync(lock);
    }
    return;
  }

  const manifest = readManifest(file, context);
  const report = check(root, manifest, statePrefix);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.verdict !== "PASS") process.exitCode = 1;
}

try { main(); } catch (error) {
  process.stderr.write(`${JSON.stringify({ verdict: "BLOCKED", error: error.message }, null, 2)}\n`);
  process.exitCode = 2;
}
