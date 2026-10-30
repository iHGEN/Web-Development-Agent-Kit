#!/usr/bin/env node

// A conservative, Node-only check for accidental changes outside a task's scope.
// It never stages, reverts, deletes, commits, pushes or changes branches.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

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

function git(project, args) {
  const result = spawnSync("git", args, { cwd: project, encoding: "buffer", maxBuffer: 50 * 1024 * 1024 });
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
function trackedStateFiles(project) {
  // Generated state is exempt only while untracked. A tracked state file is real
  // repository content and must not be hidden from the scope fence.
  return new Set([
    ...gitPaths(project, ["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", ".agent-core/state"]),
    ...gitPaths(project, ["ls-files", "--cached", "-z", "--", ".agent-core/state"]),
  ]);
}
function isGeneratedState(file, tracked = new Set()) {
  return file.startsWith(".agent-core/state/") && !tracked.has(file);
}

function validPath(file) {
  if (typeof file !== "string" || !file || file.startsWith("/") || file.includes("\\") || /[*?\[\]]/.test(file)) {
    throw new Error(`Scope requires an exact relative file path, not a glob: ${file}`);
  }
  const parts = file.split("/");
  if (parts.some(p => !p || p === "." || p === "..") || file === ".git" || file.startsWith(".git/") || file.startsWith(".agent-core/state/")) {
    throw new Error(`Unsafe or generated-state path in task scope: ${file}`);
  }
  return file;
}

function currentBranch(project) {
  return gitText(project, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
}

function statusEntries(project) {
  const entries = new Map();
  const tracked = trackedStateFiles(project);
  for (const record of gitPaths(project, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"])) {
    if (record.length < 4 || record[2] !== " ") throw new Error("Could not parse git status safely");
    const file = record.slice(3);
    if (!isGeneratedState(file, tracked)) entries.set(file, record.slice(0, 2));
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
    if (path.resolve(actualRoot) !== fullPath) throw new Error(`Submodule is not checked out: ${file}`);
    return `gitlink:160000 ${gitText(fullPath, ["rev-parse", "--verify", "HEAD"])}`;
  }
  throw new Error(`Cannot safely fingerprint changed non-file path: ${file}`);
}

function snapshotExisting(project) {
  const entries = statusEntries(project);
  return Object.fromEntries([...entries].map(([file, status]) => [file, {
    status, fingerprint: fingerprint(project, file, status),
  }]));
}

function changePaths(project, base) {
  const mergeBase = gitText(project, ["merge-base", base, "HEAD"]);
  const committed = gitPaths(project, ["diff", "--name-only", "--no-renames", "-z", mergeBase, "HEAD"]);
  const staged = gitPaths(project, ["diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD"]);
  const unstaged = gitPaths(project, ["diff", "--name-only", "--no-renames", "-z"]);
  const tracked = trackedStateFiles(project);
  const untracked = gitPaths(project, ["ls-files", "--others", "--exclude-standard", "-z"])
    .filter(file => !isGeneratedState(file, tracked));
  return [...new Set([...committed, ...staged, ...unstaged, ...untracked])]
    .filter(file => !isGeneratedState(file, tracked)).sort();
}

function changeDigest(project, base) {
  const mergeBase = gitText(project, ["merge-base", base, "HEAD"]);
  const hash = crypto.createHash("sha256");
  hash.update("web-kit-pr-diff-v2\0");
  hash.update(mergeBase);
  // A content-equivalent `git add` or `git commit` must NOT invalidate a prior
  // review. Hash the effective working tree once, irrespective of whether a
  // changed file is committed, staged, or untracked.
  const paths = changePaths(project, base);
  const indexEntries = indexSnapshot(project);
  for (const file of paths) {
    hash.update(file);
    hash.update("\0");
    hash.update(workingFingerprint(project, file, indexEntries));
    hash.update("\0");
  }
  // Keep staged-only code visible when the index and working tree disagree.
  // Do not include the index when it matches the worktree: that would cause a
  // redundant review for a normal add/commit with no content change.
  const staged = new Set(gitPaths(project, ["diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD"]));
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

function readManifest(file) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(manifest.allowed_paths) || !manifest.preexisting || !manifest.base || !manifest.branch) {
    throw new Error("Invalid or incomplete scope manifest");
  }
  manifest.allowed_paths.forEach(validPath);
  return manifest;
}

function writeManifest(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function check(project, manifest) {
  if (currentBranch(project) !== manifest.branch) throw new Error(`Task is locked to branch ${manifest.branch}`);
  const changed = changePaths(project, manifest.base);
  const status = statusEntries(project);
  const preexistingChanged = [];
  for (const [file, before] of Object.entries(manifest.preexisting)) {
    const current = status.get(file);
    if (current !== before.status || (current && fingerprint(project, file, current) !== before.fingerprint)) {
      preexistingChanged.push(file);
    }
  }
  const taskChanges = changed.filter(file => !(file in manifest.preexisting) || preexistingChanged.includes(file));
  const allowed = new Set(manifest.allowed_paths);
  const unexpected = taskChanges.filter(file => !allowed.has(file));
  const errors = [];
  if (preexistingChanged.length) errors.push("Pre-existing user changes were altered: stop and ask for direction.");
  if (unexpected.length) errors.push("Task changed files outside its declared scope: stop and justify/approve before proceeding.");
  if (!taskChanges.length) errors.push("No task changes found for a pre-PR review.");
  return {
    verdict: errors.length ? "FAIL" : "PASS",
    task_id: manifest.task_id,
    branch: manifest.branch,
    base: manifest.base,
    change_digest: changeDigest(project, manifest.base),
    intended_changes: taskChanges.filter(file => allowed.has(file)),
    unexpected_paths: unexpected,
    preexisting_changed: preexistingChanged,
    untouched_preexisting_count: Object.keys(manifest.preexisting).length - preexistingChanged.length,
    scope_extensions: manifest.extensions || [],
    errors,
  };
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!(["start", "extend", "check"].includes(command))) {
    throw new Error("Usage: scope-guard.mjs start --task-id ID --base main --intent TEXT --allow path [--allow path] | extend --task-id ID --allow path --reason TEXT --evidence REF | check --task-id ID");
  }
  const project = path.resolve(options.project || ".");
  const root = gitText(project, ["rev-parse", "--show-toplevel"]);
  if (path.resolve(root) !== project) throw new Error("--project must be the Git repository root");
  const file = manifestPath(project, options["task-id"]);

  if (command === "start") {
    if (fs.existsSync(file)) throw new Error("Scope already locked for this task; do not overwrite its baseline");
    const base = options.base;
    const branch = currentBranch(project);
    if (!base || !options.intent?.trim() || !options.allow.length) throw new Error("start requires --base, --intent, and one or more --allow paths");
    if (branch === base || branch === base.replace(/^origin\//, "")) throw new Error("Use a feature branch, not the base branch");
    gitText(project, ["rev-parse", "--verify", `${base}^{commit}`]);
    gitText(project, ["merge-base", base, "HEAD"]);
    const allowed = [...new Set(options.allow.map(validPath))];
    const manifest = {
      version: 1, task_id: options["task-id"], intent: options.intent, branch, base,
      allowed_paths: allowed, preexisting: snapshotExisting(project), extensions: [],
    };
    writeManifest(file, manifest);
    process.stdout.write(`${JSON.stringify({ verdict: "LOCKED", task_id: manifest.task_id, branch, base, allowed_paths: allowed, preexisting_count: Object.keys(manifest.preexisting).length }, null, 2)}\n`);
    return;
  }

  if (command === "extend") {
    if (options.allow.length !== 1 || !options.reason?.trim() || !options.evidence?.trim()) {
      throw new Error("extend requires exactly one --allow path, --reason and --evidence");
    }
    const lock = `${file}.lock`;
    try { fs.mkdirSync(lock); } catch { throw new Error("Scope update already in progress or a stale lock needs investigation"); }
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      const latest = readManifest(file);
      const extra = validPath(options.allow[0]);
      if (currentBranch(project) !== latest.branch) throw new Error("Branch changed since scope was locked");
      if (latest.allowed_paths.includes(extra)) throw new Error("Path is already allowed");
      if (extra in latest.preexisting || changePaths(project, latest.base).includes(extra)) {
        throw new Error("Cannot retroactively approve an already dirty/changed path");
      }
      latest.allowed_paths.push(extra);
      latest.extensions.push({ path: extra, reason: options.reason, evidence: options.evidence, recorded_at: new Date().toISOString() });
      fs.writeFileSync(temporary, `${JSON.stringify(latest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      fs.renameSync(temporary, file);
      process.stdout.write(`${JSON.stringify({ verdict: "EXTENDED", path: extra, reason: options.reason, evidence: options.evidence }, null, 2)}\n`);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      fs.rmdirSync(lock);
    }
    return;
  }

  const manifest = readManifest(file);
  const report = check(project, manifest);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.verdict !== "PASS") process.exitCode = 1;
}

try { main(); } catch (error) {
  process.stderr.write(`${JSON.stringify({ verdict: "BLOCKED", error: error.message }, null, 2)}\n`);
  process.exitCode = 2;
}
