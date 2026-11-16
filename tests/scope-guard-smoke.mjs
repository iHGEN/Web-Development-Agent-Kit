import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rolesMarkdown } from "../scripts/ai-compat.mjs";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../pack/rules/scope-guard.mjs");
const project = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-scope-guard-"));
const projectAlias = project + "-alias";
const run = (bin, args, expected = 0) => {
  const result = spawnSync(bin, args, { cwd: project, encoding: "utf8" });
  assert.equal(result.status, expected, `${bin} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(bin === "node" ? result.stdout || result.stderr : "{}");
};
const git = (...args) => spawnSync("git", args, { cwd: project, encoding: "utf8" });
const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
  fs.writeFileSync(path.join(project, file), content);
};

try {
  assert.match(rolesMarkdown("Codex"), /pre-pr-review\.md/);
  assert.match(rolesMarkdown("Codex"), /scope-guard\.mjs/);
  assert.match(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../pack/rules/workflow.md"), "utf8"), /READY TO OPEN PR/);
  assert.equal(git("init", "-b", "main").status, 0);
  assert.equal(git("config", "user.email", "scope-test@example.invalid").status, 0);
  assert.equal(git("config", "user.name", "Scope Test").status, 0);
  write("src/feature.js", "export const feature = false;\n");
  write("src/unrelated.js", "export const other = false;\n");
  write("tests/feature.test.js", "// future test\n");
  assert.equal(git("add", ".").status, 0);
  assert.equal(git("commit", "-m", "baseline").status, 0);
  assert.equal(git("switch", "-c", "feat/scoped-change").status, 0);
  write("private-notes.txt", "Do not touch\n");
  // A symlink/junction reproduces macOS /var aliases and Windows alternate
  // physical spellings. State and Git scope must identify the same directory.
  fs.symlinkSync(project, projectAlias, process.platform === "win32" ? "junction" : "dir");

  const args = ["--task-id", "TASK-001", "--project", project];
  const start = run("node", [script, "start", "--task-id", "TASK-001", "--project", projectAlias, "--base", "main", "--intent", "Implement feature", "--allow", "src/feature.js"]);
  assert.equal(start.verdict, "LOCKED");
  assert.equal(start.preexisting_count, 1);
  assert.equal(run("node", [script, "check", ...args], 1).verdict, "FAIL", "An empty task should not pass pre-PR readiness");

  write("src/feature.js", "export const feature = true;\n");
  const clean = run("node", [script, "check", ...args]);
  assert.equal(clean.verdict, "PASS");
  assert.match(clean.change_digest, /^[a-f0-9]{64}$/, "Review evidence must be bound to the exact Git change set");
  assert.equal(clean.untouched_preexisting_count, 1);

  // A staged-only change must still invalidate review, even if its worktree
  // contents have been restored to the previously reviewed version.
  write("src/feature.js", "export const feature = 'staged shadow';\n");
  assert.equal(git("add", "src/feature.js").status, 0);
  write("src/feature.js", "export const feature = true;\n");
  assert.notEqual(run("node", [script, "check", ...args]).change_digest, clean.change_digest);
  assert.equal(git("restore", "--staged", "src/feature.js").status, 0);
  assert.equal(run("node", [script, "check", ...args]).change_digest, clean.change_digest);

  write("src/unrelated.js", "export const other = true;\n");
  const drift = run("node", [script, "check", ...args], 1);
  assert.deepEqual(drift.unexpected_paths, ["src/unrelated.js"]);
  assert.notEqual(drift.change_digest, clean.change_digest);
  run("node", [script, "extend", ...args, "--allow", "src/unrelated.js", "--reason", "Too late", "--evidence", "none"], 2);
  write("src/unrelated.js", "export const other = false;\n");

  // An unrelated change staged in the index cannot be hidden by restoring the worktree.
  write("src/unrelated.js", "export const other = 'staged only';\n");
  assert.equal(git("add", "src/unrelated.js").status, 0);
  write("src/unrelated.js", "export const other = false;\n");
  const stagedOnly = run("node", [script, "check", ...args], 1);
  assert.deepEqual(stagedOnly.unexpected_paths, ["src/unrelated.js"]);
  assert.equal(git("restore", "--staged", "src/unrelated.js").status, 0);

  write("private-notes.txt", "Altered by mistake\n");
  const contaminated = run("node", [script, "check", ...args], 1);
  assert.deepEqual(contaminated.preexisting_changed, ["private-notes.txt"]);
  write("private-notes.txt", "Do not touch\n");

  const lock = path.join(project, ".agent-core/state/scope/TASK-001.json.lock");
  fs.mkdirSync(lock);
  run("node", [script, "extend", ...args, "--allow", "tests/feature.test.js", "--reason", "Regression test", "--evidence", "REQ-001"], 2);
  fs.rmdirSync(lock);
  run("node", [script, "extend", ...args, "--allow", "tests/feature.test.js", "--reason", "Regression test", "--evidence", "REQ-001"]);
  write("tests/feature.test.js", "// tested new behavior\n");
  const expanded = run("node", [script, "check", ...args]);
  assert.equal(expanded.verdict, "PASS");
  assert.equal(expanded.scope_extensions.length, 1);

  run("node", [script, "extend", ...args, "--allow", "tests/new.test.js", "--reason", "New regression test", "--evidence", "REQ-001"]);
  write("tests/new.test.js", "// new test created during implementation\n");
  const withUntracked = run("node", [script, "check", ...args]);
  assert.equal(withUntracked.verdict, "PASS");

  // Staged changes, branch mixups, globs, and fresh unrelated untracked files cannot pass.
  const expectedFinalDiff = withUntracked.change_digest;
  assert.equal(git("add", "src/feature.js").status, 0);
  assert.equal(run("node", [script, "check", ...args]).change_digest, expectedFinalDiff,
    "Staging unchanged content must reuse the existing full-diff review");
  assert.equal(git("add", "tests/feature.test.js").status, 0);
  assert.equal(run("node", [script, "check", ...args]).change_digest, expectedFinalDiff,
    "Staging all unchanged content must not invalidate review");
  assert.equal(git("add", "tests/new.test.js").status, 0);
  assert.equal(run("node", [script, "check", ...args]).change_digest, expectedFinalDiff,
    "Staging an untracked file must preserve its existing review fingerprint");
  assert.equal(git("commit", "-m", "implement scoped feature").status, 0);
  assert.equal(run("node", [script, "check", ...args]).change_digest, expectedFinalDiff,
    "Committing the exact reviewed content must not require a duplicate review");
  write("extra.txt", "Unexpected new file\n");
  assert.deepEqual(run("node", [script, "check", ...args], 1).unexpected_paths, ["extra.txt"]);
  run("node", [script, "extend", ...args, "--allow", "src/**", "--reason", "Broad", "--evidence", "N/A"], 2);
  assert.equal(git("switch", "main").status, 0);
  run("node", [script, "check", ...args], 2);
  run("node", [script, "start", "--task-id", "TASK-002", "--project", project, "--base", "main", "--intent", "Wrong branch", "--allow", "src/feature.js"], 2);

  // Generated untracked bookkeeping is exempt; tracked bookkeeping is not.
  assert.equal(git("switch", "-c", "feat/state-protection").status, 0);
  // Existing large untracked assets are legitimate user work. The guard must
  // fingerprint without loading them all into memory or refusing to start.
  const large = path.join(project, "media/large-user-asset.bin");
  fs.mkdirSync(path.dirname(large), { recursive: true });
  const fd = fs.openSync(large, "w");
  try { fs.ftruncateSync(fd, 33 * 1024 * 1024); }
  finally { fs.closeSync(fd); }
  const stateArgs = ["--task-id", "TASK.STATE", "--project", project];
  run("node", [script, "start", ...stateArgs, "--base", "main", "--intent", "Scoped change", "--allow", "src/feature.js"]);
  write("src/feature.js", "export const feature = 'scoped';\n");
  write(".agent-core/state/jobs/progress.json", "{\"progress\":1}\n");
  const largePreserved = run("node", [script, "check", ...stateArgs]);
  assert.equal(largePreserved.verdict, "PASS");
  assert(largePreserved.untouched_preexisting_count >= 1, "Untracked large user asset should be preserved");
  write(".agent-core/state/jobs/accidental.json", "{\"tracked\":true}\n");
  assert.equal(git("add", ".agent-core/state/jobs/accidental.json").status, 0);
  assert.deepEqual(run("node", [script, "check", ...stateArgs], 1).unexpected_paths, [".agent-core/state/jobs/accidental.json"]);

  // A pre-existing tracked file can have two distinct user versions: the
  // staged index blob and the unstaged working-tree content. Changing only
  // the staged blob must never pass merely because `MM` and `diff HEAD` stay
  // identical after the worktree is restored.
  const userFile = "src/unrelated.js";
  const stagedA = "export const other = 'original staged user work';\n";
  const stagedC = "export const other = 'replaced staged user work';\n";
  const workingB = "export const other = 'unstaged user work';\n";
  write(userFile, stagedA);
  assert.equal(git("add", userFile).status, 0);
  write(userFile, workingB);
  const mixedArgs = ["--task-id", "TASK.MIXED", "--project", project];
  const beforeStatus = git("status", "--porcelain=v1", "--", userFile).stdout.trim();
  const beforeIndex = git("rev-parse", `:${userFile}`).stdout.trim();
  const beforeDiff = git("diff", "--binary", "HEAD", "--", userFile).stdout;
  assert.match(beforeStatus, /^MM src\/unrelated\.js$/);
  run("node", [script, "start", ...mixedArgs, "--base", "main", "--intent", "Protect mixed user edits", "--allow", "tests/feature.test.js"]);
  write("tests/feature.test.js", "// Scoped change with existing mixed user edits\n");
  assert.equal(run("node", [script, "check", ...mixedArgs]).verdict, "PASS", "Original staged and unstaged user versions are preserved");

  write(userFile, stagedC);
  assert.equal(git("add", userFile).status, 0);
  write(userFile, workingB);
  assert.equal(git("status", "--porcelain=v1", "--", userFile).stdout.trim(), beforeStatus);
  assert.equal(git("diff", "--binary", "HEAD", "--", userFile).stdout, beforeDiff);
  assert.notEqual(git("rev-parse", `:${userFile}`).stdout.trim(), beforeIndex);
  const mixedDrift = run("node", [script, "check", ...mixedArgs], 1);
  assert.deepEqual(mixedDrift.preexisting_changed, [userFile]);

  // Old locks cannot certify staged-data preservation because they never
  // recorded the original index entry; require a new reviewed baseline.
  const legacyId = "TASK.LEGACY";
  const scopeDir = path.join(project, ".agent-core/state/scope");
  const legacyManifest = JSON.parse(fs.readFileSync(path.join(scopeDir, "TASK.MIXED.json"), "utf8"));
  legacyManifest.task_id = legacyId;
  delete legacyManifest.preexisting[userFile].index_entry;
  fs.writeFileSync(path.join(scopeDir, `${legacyId}.json`), `${JSON.stringify(legacyManifest)}\n`);
  const legacyResult = run("node", [script, "check", "--task-id", legacyId, "--project", project], 2);
  assert.match(legacyResult.error, /lacks the staged baseline/);

  // Existing task authorization can permit edits to selected untracked user
  // files without erasing their original contents or exempting nearby work.
  const authorizedProject = path.join(project, "authorized-untracked");
  fs.mkdirSync(authorizedProject);
  const authorizedGit = (...values) => {
    const result = spawnSync("git", values, { cwd: authorizedProject, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const authorizedWrite = (file, content) => {
    const target = path.join(authorizedProject, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  const authorizedArgs = ["--project", authorizedProject, "--task-id", "AUTHORIZED"];
  const authorizedRun = (command, extra = [], expected = 0, taskArgs = authorizedArgs) => {
    const result = spawnSync(process.execPath, [script, command, ...taskArgs, ...extra], { encoding: "utf8" });
    assert.equal(result.status, expected, result.stdout + result.stderr);
    return JSON.parse(result.stdout || result.stderr);
  };
  const authorization = file => ["--allow", file, "--reason", "Implement the user's eight-file fix",
    "--evidence", "Task request explicitly authorizes edits to these existing files"];
  authorizedGit("init", "-b", "main");
  authorizedGit("config", "user.name", "Authorized scope regression");
  authorizedGit("config", "user.email", "authorized-scope@example.invalid");
  authorizedWrite("tracked.js", "// baseline\n");
  authorizedGit("add", "."); authorizedGit("commit", "-m", "baseline");
  authorizedGit("switch", "-c", "feat/authorized-content");
  authorizedWrite("tracked.js", "// original staged user content\n");
  authorizedGit("add", "tracked.js");
  authorizedWrite("tracked.js", "// original unstaged user content\n");
  const protectedIndex = authorizedGit("rev-parse", ":tracked.js");
  const eight = ["src/one.js", "isolated/two.js", "src/three.js", "src/four.js", "src/five.js", "src/six.js", "src/space name.js", "src/ملف.js"];
  for (const file of eight) authorizedWrite(file, `// original ${file}\n`);
  authorizedWrite("ninth-private.txt", "Private user work\n");
  authorizedWrite("src/allowed-without-authorization.js", "// separate user work\n");
  authorizedRun("start", ["--base", "main", "--intent", "Fix eight existing files",
    ...[...eight, "src/allowed-without-authorization.js", "tracked.js"].flatMap(file => ["--allow", file])]);
  const authorizationManifestPath = path.join(authorizedProject, ".agent-core/state/scope/AUTHORIZED.json");
  const originalAuthorizationManifest = JSON.parse(fs.readFileSync(authorizationManifestPath, "utf8"));
  for (const file of eight) authorizedWrite(file, `// authorized fix ${file}\n`);
  assert.equal(authorizedRun("check", [], 1).preexisting_changed.length, 8);
  authorizedRun("authorize", ["--allow", eight[0], "--reason", "No evidence"], 2);
  authorizedRun("authorize", ["--allow", eight[0], "--reason", " ", "--evidence", "Request"], 2);
  for (const file of ["../escape.js", "C:/escape.js", "src/**", eight[0] + "-sibling", "ninth-private.txt", "tracked.js"]) {
    authorizedRun("authorize", authorization(file), 2);
  }
  for (const file of eight) {
    const approved = authorizedRun("authorize", authorization(file));
    assert.equal(approved.verdict, "AUTHORIZED");
    assert.equal(approved.permission, "content-edit");
    assert.equal(approved.staging, "content-equivalent-only");
  }
  authorizedRun("authorize", authorization(eight[0]), 2);
  const approvedManifest = JSON.parse(fs.readFileSync(authorizationManifestPath, "utf8"));
  assert.deepEqual(approvedManifest.preexisting, originalAuthorizationManifest.preexisting, "Authorization must never rebaseline existing content");
  assert.deepEqual(approvedManifest.allowed_paths, originalAuthorizationManifest.allowed_paths);
  assert.equal(approvedManifest.extensions.filter(entry => entry.kind === "preexisting-untracked-content").length, 8);
  const authorizedClean = authorizedRun("check");
  assert.deepEqual(authorizedClean.authorized_preexisting_changes, [...eight].sort());
  assert.deepEqual(authorizedClean.protected_preexisting_changes, []);
  assert.equal(authorizedGit("rev-parse", ":tracked.js"), protectedIndex);

  const ninthStatus = authorizedGit("status", "--porcelain=v1", "--", "ninth-private.txt");
  authorizedWrite("ninth-private.txt", "Accidental overwrite\n");
  assert.equal(authorizedGit("status", "--porcelain=v1", "--", "ninth-private.txt"), ninthStatus);
  const unauthorizedNinth = authorizedRun("check", [], 1);
  assert.deepEqual(unauthorizedNinth.unexpected_paths, ["ninth-private.txt"]);
  assert.deepEqual(unauthorizedNinth.protected_preexisting_changes, ["ninth-private.txt"]);
  authorizedWrite("ninth-private.txt", "Private user work\n");
  authorizedWrite("src/allowed-without-authorization.js", "// allowlist alone is not authorization\n");
  assert.deepEqual(authorizedRun("check", [], 1).protected_preexisting_changes, ["src/allowed-without-authorization.js"]);
  authorizedWrite("src/allowed-without-authorization.js", "// separate user work\n");

  // Ordinary editor replacement is allowed; file identity is not tied to inode.
  const firstPath = path.join(authorizedProject, eight[0]);
  const replacement = path.join(project, "editor-replacement.tmp");
  fs.writeFileSync(replacement, "// atomic replacement\n");
  fs.renameSync(replacement, firstPath);
  assert.equal(authorizedRun("check").verdict, "PASS");
  const linkedCopy = path.join(project, "unauthorized-hardlink.tmp");
  fs.linkSync(firstPath, linkedCopy);
  assert.deepEqual(authorizedRun("check", [], 1).protected_preexisting_changes, [eight[0]]);
  fs.unlinkSync(linkedCopy);
  fs.unlinkSync(firstPath);
  assert.deepEqual(authorizedRun("check", [], 1).protected_preexisting_changes, [eight[0]]);
  fs.writeFileSync(firstPath, "// atomic replacement\n");
  if (process.platform !== "win32") {
    fs.chmodSync(firstPath, 0o755);
    assert.deepEqual(authorizedRun("check", [], 1).protected_preexisting_changes, [eight[0]]);
    fs.chmodSync(firstPath, 0o644);
    fs.unlinkSync(firstPath);
    fs.symlinkSync("../ninth-private.txt", firstPath);
    assert.deepEqual(authorizedRun("check", [], 1).protected_preexisting_changes, [eight[0]]);
    fs.unlinkSync(firstPath); fs.writeFileSync(firstPath, "// atomic replacement\n");
  }
  const originalDirectory = path.join(authorizedProject, "isolated");
  const movedDirectory = path.join(project, "outside-authorized-parent");
  fs.renameSync(originalDirectory, movedDirectory);
  fs.symlinkSync(movedDirectory, originalDirectory, process.platform === "win32" ? "junction" : "dir");
  assert(authorizedRun("check", [], 1).protected_preexisting_changes.includes(eight[1]), "A symlink ancestor cannot extend edit authority");
  fs.unlinkSync(originalDirectory); fs.renameSync(movedDirectory, originalDirectory);

  // Equivalent staging/commits preserve readiness, including Git's CRLF
  // normalization, but a hidden staged version cannot be certified.
  authorizedGit("config", "core.autocrlf", "true");
  authorizedWrite(eight[0], "// normalized content\r\n");
  const beforeAdd = authorizedRun("check").change_digest;
  authorizedGit("add", "--", ...eight);
  assert.equal(authorizedRun("check").change_digest, beforeAdd);
  authorizedWrite(eight[0], "// differing worktree\r\n");
  assert.deepEqual(authorizedRun("check", [], 1).protected_preexisting_changes, [eight[0]]);
  authorizedWrite(eight[0], "// normalized content\r\n");
  authorizedGit("commit", "--only", "-m", "authorized fixes", "--", ...eight);
  assert.equal(authorizedRun("check").change_digest, beforeAdd);
  assert.equal(authorizedGit("rev-parse", ":tracked.js"), protectedIndex);
  authorizedWrite(eight[0], "// authorized follow-up edit\r\n");
  assert.equal(authorizedRun("check").verdict, "PASS");
  authorizedGit("rm", "--cached", "--", eight[1]);
  assert(authorizedRun("check", [], 1).protected_preexisting_changes.includes(eight[1]));
  authorizedGit("restore", "--staged", "--", eight[1]);
  authorizedGit("config", "core.autocrlf", "false");
  authorizedWrite("tracked.js", "// replaced staged user content\n");
  authorizedGit("add", "tracked.js");
  authorizedWrite("tracked.js", "// original unstaged user content\n");
  assert.deepEqual(authorizedRun("check", [], 1).protected_preexisting_changes, ["tracked.js"]);

  const legacyAuthorization = structuredClone(originalAuthorizationManifest);
  legacyAuthorization.task_id = "AUTHORIZATION.LEGACY";
  delete legacyAuthorization.preexisting[eight[0]].untracked_shape;
  const legacyAuthorizationPath = path.join(authorizedProject, ".agent-core/state/scope/AUTHORIZATION.LEGACY.json");
  const legacyAuthorizationBytes = JSON.stringify(legacyAuthorization);
  fs.writeFileSync(legacyAuthorizationPath, legacyAuthorizationBytes);
  const missingTypeEvidence = authorizedRun("authorize", authorization(eight[0]), 2,
    ["--project", authorizedProject, "--task-id", "AUTHORIZATION.LEGACY"]);
  assert.match(missingTypeEvidence.error, /lacks required baseline type evidence/);
  assert.equal(fs.readFileSync(legacyAuthorizationPath, "utf8"), legacyAuthorizationBytes);

  // A tracked bookkeeping file remains PR content after its deletion is committed.
  // HEAD/index alone cannot decide whether a state path is generated.
  const deletedProject = path.join(project, "committed-state-deletion");
  fs.mkdirSync(deletedProject);
  const deletedGit = (...values) => {
    const result = spawnSync("git", values, { cwd: deletedProject, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  deletedGit("init", "-b", "main");
  deletedGit("config", "user.name", "State deletion regression");
  deletedGit("config", "user.email", "state-delete@example.invalid");
  fs.mkdirSync(path.join(deletedProject, ".agent-core/state"), { recursive: true });
  fs.writeFileSync(path.join(deletedProject, ".agent-core/state/history.md"), "Tracked baseline history\n");
  fs.writeFileSync(path.join(deletedProject, "feature.mjs"), "export const enabled = false;\n");
  deletedGit("add", "."); deletedGit("commit", "-m", "baseline"); deletedGit("switch", "-c", "feat/delete-state");
  const deletionArgs = ["--task-id", "STATE-DELETE", "--project", deletedProject];
  const locked = spawnSync(process.execPath, [script, "start", ...deletionArgs, "--base", "main", "--intent", "Enable feature only", "--allow", "feature.mjs"], { encoding: "utf8" });
  assert.equal(locked.status, 0, locked.stdout + locked.stderr);
  fs.unlinkSync(path.join(deletedProject, ".agent-core/state/history.md"));
  fs.writeFileSync(path.join(deletedProject, "feature.mjs"), "export const enabled = true;\n");
  deletedGit("add", "feature.mjs", ".agent-core/state/history.md"); deletedGit("commit", "-m", "feature with accidental deletion");
  const deleted = spawnSync(process.execPath, [script, "check", ...deletionArgs], { encoding: "utf8" });
  assert.equal(deleted.status, 1, deleted.stdout + deleted.stderr);
  assert.deepEqual(JSON.parse(deleted.stdout).unexpected_paths, [".agent-core/state/history.md"]);
  console.log("Scope guard smoke: PASS");
} finally {
  // The fixture is entirely created by this test and contains no user files.
  fs.rmSync(projectAlias, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
}
