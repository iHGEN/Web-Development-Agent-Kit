import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rolesMarkdown } from "../scripts/ai-compat.mjs";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../pack/rules/scope-guard.mjs");
const project = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-scope-guard-"));
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

  const args = ["--task-id", "TASK-001", "--project", project];
  const start = run("node", [script, "start", ...args, "--base", "main", "--intent", "Implement feature", "--allow", "src/feature.js"]);
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
  console.log("Scope guard smoke: PASS");
} finally {
  // The fixture is entirely created by this test and contains no user files.
  fs.rmSync(project, { recursive: true, force: true });
}
