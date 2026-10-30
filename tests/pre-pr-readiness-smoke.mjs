#!/usr/bin/env node
// Exercise the existing quality-review gate and scope guard together, without installation.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-pre-pr-"));
const progress = path.join(repo, "pack/runtime/work-progress.mjs");
const guard = path.join(repo, "pack/rules/scope-guard.mjs");
function invoke(bin, args, expected = 0) {
  const run = spawnSync(bin, args, { cwd: project, encoding: "utf8" });
  assert.equal(run.status, expected, `${bin} ${args.join(" ")}\n${run.stdout}\n${run.stderr}`);
  if (expected !== 0) return run;
  return JSON.parse(run.stdout);
}
const git = (...args) => {
  const run = spawnSync("git", args, { cwd: project, encoding: "utf8" });
  assert.equal(run.status, 0, `git ${args.join(" ")}: ${run.stderr}`);
  return run;
};
const work = (...args) => invoke(process.execPath, [progress, ...args, "--project", project]);
const workFails = (...args) => invoke(process.execPath, [progress, ...args, "--project", project], 1);
const scope = (...args) => invoke(process.execPath, [guard, ...args, "--project", project]);
function write(rel, content) {
  const full = path.join(project, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
function job(taskId) {
  return JSON.parse(fs.readFileSync(path.join(project, ".agent-core/state/jobs", taskId + ".json"), "utf8"));
}

try {
  fs.mkdirSync(path.join(project, ".agent-core/rules"), { recursive: true });
  fs.copyFileSync(guard, path.join(project, ".agent-core/rules/scope-guard.mjs"));
  write("src/feature.js", "export const enabled = false;\n");
  write("docs/feature.md", "# Original behavior\n");
  write("package.json", JSON.stringify({ name: "pre-pr-smoke", private: true, type: "module", scripts: { test: "node --check src/feature.js" } }) + "\n");
  git("init", "-b", "main");
  git("config", "user.name", "Web Kit Smoke");
  git("config", "user.email", "smoke@example.invalid");
  git("add", "src", "docs", "package.json");
  git("commit", "-m", "baseline");
  git("switch", "-c", "feat/pre-pr");

  // The task is flagged PR-bound before any code change. No scope snapshot => hard stop.
  work("start", "--task-id", "NO-SCOPE", "--classification", "SMALL", "--pr-bound");
  work("update", "--task-id", "NO-SCOPE", "--status", "IMPLEMENTING", "--agent", "implementer");
  workFails("quality-review", "--task-id", "NO-SCOPE", "--reviewer", "code-reviewer",
    "--result", "PASS", "--evidence", "Cannot review missing scope");
  workFails("update", "--task-id", "NO-SCOPE", "--status", "DONE", "--final-validation", "PASS");

  // Existing jobs can opt into PR readiness later; they cannot bypass the new gate.
  work("start", "--task-id", "LATE-PR", "--classification", "SMALL");
  work("update", "--task-id", "LATE-PR", "--pr-bound");
  assert.equal(job("LATE-PR").pr_bound, true);
  workFails("update", "--task-id", "LATE-PR", "--status", "DONE", "--final-validation", "PASS");

  const task = "PRE-PR";
  work("start", "--task-id", task, "--classification", "SMALL", "--pr-bound");
  scope("start", "--task-id", task, "--base", "main", "--intent", "Enable feature",
    "--allow", "src/feature.js", "--allow", "docs/feature.md");
  write("src/feature.js", "export const enabled = true;\n");
  work("update", "--task-id", task, "--status", "IMPLEMENTING", "--agent", "implementer");
  assert.equal(scope("check", "--task-id", task).verdict, "PASS");
  workFails("update", "--task-id", task, "--status", "DONE", "--final-validation", "PASS");
  workFails("quality-review", "--task-id", task, "--reviewer", "implementer",
    "--result", "PASS", "--evidence", "Self approval must fail");

  // One independent review is enough; it also serves as the existing quality-review record.
  // The current agent may be the reviewer; independence is checked against the implementer.
  work("update", "--task-id", task, "--status", "REVIEWING", "--agent", "code-reviewer");
  work("quality-review", "--task-id", task, "--reviewer", "code-reviewer",
    "--result", "PASS", "--evidence", "Full diff and requirements checked");
  const reviewed = job(task).quality.code_review.change_digest;
  assert.match(reviewed, /^[a-f0-9]{64}$/);
  workFails("update", "--task-id", task, "--status", "DONE", "--final-validation", "PASS");
  assert.equal(work("check-run", "--task-id", task, "--script", "test").status, "PASS",
    "An actual current npm test run is required for PR readiness");

  // Docs are deliberately excluded from the old source digest. The new Git diff
  // binding must still invalidate review if an allowed .md file changes afterward.
  write("docs/feature.md", "# Updated instructions after review\n");
  assert.notEqual(scope("check", "--task-id", task).change_digest, reviewed);
  workFails("update", "--task-id", task, "--status", "DONE", "--final-validation", "PASS");

  // Unrelated changes block a fresh PASS review as well as DONE.
  write("src/unrelated.js", "export const unrelated = true;\n");
  assert.equal(invoke(process.execPath, [guard, "check", "--task-id", task, "--project", project], 1).status, 1);
  workFails("quality-review", "--task-id", task, "--reviewer", "code-reviewer",
    "--result", "PASS", "--evidence", "Unrelated change should block approval");
  fs.unlinkSync(path.join(project, "src/unrelated.js")); // Only the disposable test fixture.

  work("quality-review", "--task-id", task, "--reviewer", "code-reviewer",
    "--result", "PASS", "--evidence", "Final current PR diff checked");
  assert.notEqual(job(task).quality.code_review.change_digest, reviewed);
  const finalReviewDigest = job(task).quality.code_review.change_digest;
  git("add", "src/feature.js", "docs/feature.md");
  assert.equal(scope("check", "--task-id", task).change_digest, finalReviewDigest,
    "Staging an unchanged review must not invalidate PR readiness");
  git("commit", "-m", "final reviewed feature");
  assert.equal(scope("check", "--task-id", task).change_digest, finalReviewDigest,
    "Committing unchanged reviewed content must preserve PR readiness");
  work("update", "--task-id", task, "--status", "DONE", "--final-validation", "PASS");
  assert.equal(job(task).status, "DONE");
  const report = work("report", "--task-id", task);
  assert.equal(report.engineering_quality.scope_guard, "PASS");
  assert.equal(report.engineering_quality.reviewed_diff_current, true);
  write("docs/feature.md", "# Changed after completion\n");
  const stale = work("report", "--task-id", task);
  assert.equal(stale.engineering_quality.current_source_freshness, "STALE",
    "Post-completion doc edits must not masquerade as current reviewed source");
  assert.equal(stale.engineering_quality.reviewed_diff_current, false);
  console.log("Pre-PR readiness smoke: PASS");
} finally {
  // The entire fixture is created by this test; no user project is removed.
  fs.rmSync(project, { recursive: true, force: true });
}
