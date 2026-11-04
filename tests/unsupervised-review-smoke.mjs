#!/usr/bin/env node
// Exercise unsupervised native handoff through installed files, not live model inference.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mock = path.join(repo, "tests", "fixtures", "mock-standalone-codex.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-unsupervised-review-"));
const project = path.join(root, "project");
const home = path.join(root, "home");
const observations = path.join(root, "observation.json");
const env = { ...process.env, WEB_KIT_USER_HOME: home, WEB_KIT_HOME: path.join(home, ".web-kit"),
  WEB_KIT_DISABLE_SHELL_PROFILE: "1", WEB_KIT_STANDALONE_CODEX_BIN: mock };
for (const key of ["WEB_KIT_CONTEXT_SUPERVISOR_ACTIVE", "WEB_KIT_SUPERVISOR_ID",
  "WEB_KIT_LAUNCH_ID", "WEB_KIT_REVIEW_TASK_ID", "WEB_KIT_STANDALONE_REVIEW_ACTIVE"]) delete env[key];
const run = (args, options = {}) => spawnSync(process.execPath, args, {
  cwd: project, env, encoding: "utf8", windowsHide: true, timeout: 120000,
  maxBuffer: 4 * 1024 * 1024, ...options,
});
const git = (...args) => {
  const r = spawnSync("git", args, { cwd: project, encoding: "utf8" });
  assert.equal(r.status, 0, (r.stderr || r.stdout));
  return r.stdout;
};
const json = file => JSON.parse(fs.readFileSync(file, "utf8"));
const digest = text => createHash("sha256").update(text).digest("hex");
try {
  fs.mkdirSync(project, { recursive: true });
  git("init", "-q");
  git("config", "user.email", "web-kit-fixture@example.invalid");
  git("config", "user.name", "Web Kit Fixture");
  fs.writeFileSync(path.join(project, "package.json"), '{"name":"standalone-review-fixture","private":true}\n');
  fs.mkdirSync(path.join(project, "src"));
  fs.writeFileSync(path.join(project, "src", "example.js"), "export const answer = 0;\n");
  git("add", "src/example.js", "package.json");
  git("commit", "-qm", "fixture initial source");
  const setup = run([path.join(repo, "scripts", "agent-kit.mjs"), "install", project]);
  assert.equal(setup.status, 0, "Web Kit installation failed: " + setup.stdout + setup.stderr);
  assert.equal(json(path.join(project, ".agent-kit.json")).kit, "web-dev-agent-kit");
  const helper = path.join(project, ".agent-core", "bin", "task-handoff.mjs");
  fs.writeFileSync(path.join(project, "src", "example.js"), "export const answer = 1;\n");
  git("add", "src/example.js");
  fs.writeFileSync(path.join(project, "src", "example.js"), "export const answer = 2;\n");
  fs.writeFileSync(path.join(project, "src", "untracked.js"), "export const preserveMe = true;\n");
  const before = {
    status: git("status", "--porcelain=v1", "--untracked-files=all"),
    tracked: fs.readFileSync(path.join(project, "src", "example.js")),
    untracked: fs.readFileSync(path.join(project, "src", "untracked.js")),
    index: git("show", ":src/example.js"),
  };
  const tasks = new Set();
  const scenarios = ["success", "invalid", "wrong-task", "no-completion", "no-thread", "crash"];
  for (const mode of scenarios) {
    const result = run([helper, "request-review", "--request", "review these changes",
      "--selection", "current staged, unstaged and relevant untracked changes"], {
      env: { ...env, WEB_KIT_TEST_STANDALONE_MODE: mode, WEB_KIT_TEST_STANDALONE_OBSERVATION: observations }
    });
    const observation = json(observations);
    assert(!tasks.has(observation.taskId), "fresh request reused the review task");
    tasks.add(observation.taskId);
    assert.equal(observation.original_task, null, "standalone reviewer inherited builder task");
    const reviewRoot = path.join(project, ".agent-core", "state", "reviews", observation.taskId);
    const record = json(path.join(reviewRoot, "result.json"));
    const job = json(path.join(project, ".agent-core", "state", "jobs", observation.taskId + ".json"));
    if (mode === "success") {
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.status, "delivered");
      assert.equal(output.task_id, observation.taskId);
      assert.equal(output.execution, "independent-codex-cli");
      assert.equal(record.status, "delivered");
      assert.equal(record.certifies, "report-delivery-only");
      assert.equal(job.status, "DONE");
      assert.equal(job.review.status, "PENDING");
      assert.equal(job.quality.code_review.status, "PENDING");
      const receipt = json(path.join(reviewRoot, "ready.json"));
      assert.equal(receipt.task_id, observation.taskId);
      assert.equal(receipt.report_digest, digest(fs.readFileSync(path.join(reviewRoot, "report.md"))));
      assert.match(output.report, /^Changes review: COMPLETED/);
    } else {
      assert.notEqual(result.status, 0, "failed review claimed completion: " + mode);
      assert.equal(record.status, "failed", "failure not recorded: " + mode);
      assert.notEqual(job.status, "DONE");
      assert(!fs.existsSync(path.join(reviewRoot, "ready.json")), "failure emitted fake receipt");
      assert(!fs.existsSync(path.join(reviewRoot, "report.md")), "failure emitted fake report");
    }
    assert.equal(git("status", "--porcelain=v1", "--untracked-files=all"), before.status,
      "review changed git status or file inventory: " + mode);
    assert.deepEqual(fs.readFileSync(path.join(project, "src", "example.js")), before.tracked);
    assert.deepEqual(fs.readFileSync(path.join(project, "src", "untracked.js")), before.untracked);
    assert.equal(git("show", ":src/example.js"), before.index);
    console.log("Unsupervised review process case: PASS (" + mode + ")");
  }
  const countBefore = fs.readdirSync(path.join(project, ".agent-core", "state", "reviews")).length;
  const missing = run([helper, "request-review", "--request", "review these changes",
    "--selection", "current changes"], { env: { ...env, WEB_KIT_STANDALONE_CODEX_BIN: path.join(root, "no-codex") } });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /no independent Codex CLI executable/);
  assert.equal(fs.readdirSync(path.join(project, ".agent-core", "state", "reviews")).length, countBefore,
    "unavailable executable registered a bogus review task");
  console.log("Unsupervised review process case: PASS (provider unavailable)");
  console.log("Unsupervised Changes Review smoke: PASS (" + process.platform + "; mocked Codex CLI)");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
