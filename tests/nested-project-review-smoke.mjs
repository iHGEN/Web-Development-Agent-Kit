#!/usr/bin/env node
// An installed nested project must reach review/DONE while protecting the
// entire repository and keeping its bookkeeping in the selected project.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-nested-review-"));
const providerHome = path.join(temporary, "provider-home");
fs.mkdirSync(providerHome);
const repository = path.join(temporary, "repository");
const project = path.join(repository, "apps/web");
const progress = path.join(project, ".agent-core/bin/work-progress.mjs");
const guard = path.join(project, ".agent-core/rules/scope-guard.mjs");
const runner = path.join(project, ".agent-core/bin/code-review.mjs");
const fixture = path.join(source, "tests/fixtures/mock-code-review-provider.mjs");
const task = "NESTED";
const fixtureEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("CODEX_EXEC_SERVER_")));
const env = { ...fixtureEnv, CODEX_HOME: providerHome, WEB_KIT_CODE_REVIEW_CODEX_BIN: fixture };

function write(relative, content) {
  const file = path.join(repository, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function run(command, args, expected = 0, cwd = project) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, expected, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result;
}
const git = (...args) => run("git", args, 0, repository);
const work = (...args) => JSON.parse(run(process.execPath, [progress, ...args, "--project", project]).stdout);
const scope = (command, ...args) => JSON.parse(run(process.execPath, [guard, command, "--task-id", task, "--project", project, ...args]).stdout);
const job = () => JSON.parse(fs.readFileSync(path.join(project, `.agent-core/state/jobs/${task}.json`), "utf8"));
const review = () => JSON.parse(run(process.execPath, [runner, "--project", project, "--task-id", task, "--provider", "codex", "--json"]).stdout);
function verify() {
  assert.equal(work("check-run", "--task-id", task, "--script", "test").status, "PASS");
  work("requirement-verify", "--task-id", task, "--id", "REQ-001", "--result", "PASS", "--check-script", "test",
    "--evidence", "Nested package test imported the feature and repository shared dependency and verified the selected working directory.");
}

try {
  write("package.json", JSON.stringify({ private: true, type: "module" }) + "\n");
  write("apps/web/package.json", JSON.stringify({ name: "nested-review-fixture", private: true, type: "module", scripts: { test: "node tests/feature.test.mjs" } }) + "\n");
  write("apps/web/src/feature.js", "export const enabled = false;\n");
  write("packages/shared/value.js", "export const value = 1;\n");
  write("packages/other/user.txt", "Original sibling content.\n");
  write("apps/web/tests/feature.test.mjs", 'import assert from "node:assert/strict"; import path from "node:path"; import { enabled } from "../src/feature.js"; import { value } from "../../../packages/shared/value.js"; assert.equal(path.basename(process.cwd()), "web"); assert.equal(enabled, true); assert(value >= 2);\n');
  run(process.execPath, [path.join(source, "scripts/agent-kit.mjs"), "install", project], 0, source);
  assert(fs.existsSync(path.join(project, ".agent-core/rules/project-paths.mjs")), "Installer omitted the shared path helper.");
  assert(fs.existsSync(path.join(project, ".agent-core/bin/check-command.mjs")), "Installer omitted the external-check launcher.");
  git("init", "-b", "main");
  git("config", "user.name", "Nested Review Test");
  git("config", "user.email", "nested@example.invalid");
  git("add", ".");
  git("commit", "-m", "nested project baseline");
  git("switch", "-c", "feat/nested-review");
  write("packages/other/user.txt", "Keep this unrelated user edit.\n");

  // Default feature-branch detection must enroll a usable PR-bound task.
  work("start", "--task-id", task, "--classification", "SMALL", "--title", "Enable nested feature with shared dependency");
  assert.equal(job().pr_bound, true);
  assert(!fs.existsSync(path.join(repository, ".agent-core/state/jobs", task + ".json")), "Task state leaked to the repository root.");
  const started = scope("start", "--base", "main", "--intent", "Enable nested feature with shared dependency",
    "--allow", "apps/web/src/feature.js", "--allow", "packages/shared/value.js");
  assert.equal(started.preexisting_count, 1, "Own generated task state must not be treated as source.");
  work("requirement-add", "--task-id", task, "--id", "REQ-001", "--description", "Enable the nested feature", "--acceptance", "The nested module exports true and its consumer loads the shared value.");
  work("check-require", "--task-id", task, "--script", "test");
  write("apps/web/src/feature.js", "export const enabled = true;\n");
  write("packages/shared/value.js", "export const value = 2;\n");
  work("update", "--task-id", task, "--status", "IMPLEMENTING", "--agent", "implementer");
  const checked = scope("check");
  assert.deepEqual(checked.intended_changes, ["apps/web/src/feature.js", "packages/shared/value.js"]);
  assert.equal(checked.untouched_preexisting_count, 1);
  verify();
  assert.equal(review().verdict, "READY TO OPEN PR");
  let envelope = JSON.parse(fs.readFileSync(path.join(project, job().quality.code_review.report_path), "utf8"));
  assert.equal(envelope.snapshot.repository_root, fs.realpathSync.native(repository));
  assert.equal(envelope.snapshot.project_root, fs.realpathSync.native(project));
  assert.equal(envelope.snapshot.project_prefix, "apps/web");
  assert(envelope.snapshot.files.includes("packages/shared/value.js"), "Reviewer missed shared code outside the installed project.");
  assert(!envelope.snapshot.files.some(file => file.startsWith("apps/web/.agent-core/state/")), "Generated state entered source review.");

  // A shared-file change outside sourceDigest(project) still invalidates review.
  const reviewedDigest = envelope.snapshot.change_digest;
  write("packages/shared/value.js", "export const value = 3;\n");
  assert.notEqual(scope("check").change_digest, reviewedDigest);
  run(process.execPath, [progress, "update", "--task-id", task, "--status", "DONE", "--final-validation", "PASS", "--project", project], 1);
  verify();
  assert.equal(review().verdict, "READY TO OPEN PR");

  // Changes in another project remain inside the repository-wide scope fence.
  write("packages/other/new.txt", "Unexpected sibling change.\n");
  const outside = JSON.parse(run(process.execPath, [guard, "check", "--task-id", task, "--project", project], 1).stdout);
  assert.deepEqual(outside.unexpected_paths, ["packages/other/new.txt"]);
  fs.unlinkSync(path.join(repository, "packages/other/new.txt"));
  write("packages/other/user.txt", "Accidentally altered user work.\n");
  const altered = JSON.parse(run(process.execPath, [guard, "check", "--task-id", task, "--project", project], 1).stdout);
  assert.deepEqual(altered.preexisting_changed, ["packages/other/user.txt"]);
  write("packages/other/user.txt", "Keep this unrelated user edit.\n");
  assert.equal(scope("check").verdict, "PASS");
  git("add", "apps/web/src/feature.js", "packages/shared/value.js");
  git("commit", "-m", "reviewed nested feature");
  work("update", "--task-id", task, "--status", "DONE", "--final-validation", "PASS");
  assert.equal(job().status, "DONE");
  assert.equal(fs.readFileSync(path.join(repository, "packages/other/user.txt"), "utf8"), "Keep this unrelated user edit.\n");
  assert.equal(work("report", "--task-id", task).engineering_quality.reviewed_diff_current, true);
  console.log("Nested project review smoke: PASS");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
