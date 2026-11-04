#!/usr/bin/env node
// The ordinary review must return a fresh response without creating task state or changing Git.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-simple-review-"));
const project = path.join(root, "project with spaces");
const mock = path.join(repo, "tests", "fixtures", "mock-simple-codex.mjs");
const probe = path.join(root, "codex-invocation.json");
const env = {
  ...process.env,
  WEB_KIT_DISABLE_CONTEXT_SUPERVISOR: "1",
  WEB_KIT_DISABLE_SHELL_PROFILE: "1",
  WEB_KIT_STANDALONE_CODEX_BIN: mock,
  WEB_KIT_REVIEW_TEST_CAPTURE: probe,
};
const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: project, env: { ...env, ...options.env }, encoding: "utf8",
  windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024,
});
const git = args => {
  const result = run("git", args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
function snapshot() {
  const files = new Map();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = path.relative(project, path.join(dir, entry.name));
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else files.set(relative, fs.readFileSync(path.join(dir, entry.name)).toString("hex"));
    }
  }
  walk(project);
  return { files, git: git(["status", "--porcelain=v1"]) };
}
function unchanged(before) {
  const after = snapshot();
  assert.deepEqual(after, before, "The review changed project files or Git status");
  assert(!fs.existsSync(path.join(project, ".agent-core", "state", "reviews")), "Review task directory was created");
}

try {
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(project, "src"));
  fs.writeFileSync(path.join(project, "package.json"), '{"name":"review-fixture","private":true}\n');
  fs.writeFileSync(path.join(project, "src", "feature.js"), "export const value = 'staged A';\n");
  const setup = run(process.execPath, [path.join(repo, "scripts", "agent-kit.mjs"), "install", project]);
  assert.equal(setup.status, 0, setup.stderr);
  git(["init", "-q"]);
  git(["add", "src/feature.js"]);
  fs.writeFileSync(path.join(project, "src", "feature.js"), "export const value = 'unstaged B';\n");
  fs.writeFileSync(path.join(project, "src", "untracked.js"), "export const secret = false;\n");
  const before = snapshot();

  const command = path.join(project, ".agent-core", "bin", "changes-review.mjs");
  const success = run(process.execPath, [command, "--request", "Review just the uncommitted code", "--selection", "src/feature.js"]);
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /^# Changes review/m);
  assert.match(success.stderr, /fresh Codex review session/);
  const invoked = JSON.parse(fs.readFileSync(probe, "utf8"));
  assert.deepEqual(invoked.args.slice(0, 7), ["exec", "--json", "--ephemeral", "--sandbox", "read-only", "-C", project]);
  assert.match(invoked.prompt, /Review just the uncommitted code/);
  assert.match(invoked.prompt, /src\/feature\.js/);
  assert.match(invoked.prompt, /Review ONLY the current staged, unstaged and relevant untracked changes/);
  assert.match(invoked.prompt, /authorization\/access control, injection, secrets/);
  assert.match(invoked.prompt, /security 25%, architecture 20%, correctness 20%/);
  unchanged(before);

  const throughCli = run(process.execPath, [path.join(repo, "bin", "web-kit-entry.js"), "review", "--project", project]);
  assert.equal(throughCli.status, 0, throughCli.stderr);
  assert.match(throughCli.stdout, /Findings: no confirmed defects/);
  unchanged(before);

  const explicitReviewOnly = run(process.execPath, [command, "--auto-fix=false"]);
  assert.equal(explicitReviewOnly.status, 0, explicitReviewOnly.stderr);
  assert.match(explicitReviewOnly.stdout, /Changes review/);
  unchanged(before);

  const linger = run(process.execPath, [command], { env: { WEB_KIT_REVIEW_TEST_MODE: "linger" } });
  assert.equal(linger.status, 0, `Completed review should survive a lingering CLI: ${linger.stderr}`);
  assert.match(linger.stdout, /Findings: no confirmed defects/);
  unchanged(before);

  const incomplete = run(process.execPath, [command], { env: { WEB_KIT_REVIEW_TEST_MODE: "incomplete" } });
  assert.notEqual(incomplete.status, 0);
  assert.match(incomplete.stderr, /did not return a complete response/);
  unchanged(before);

  const stalled = run(process.execPath, [command, "--timeout", "1"], { env: { WEB_KIT_REVIEW_TEST_MODE: "stall" } });
  assert.notEqual(stalled.status, 0, "Unresponsive Codex must be terminated by the deadline");
  assert.match(stalled.stderr, /timed out after 1 seconds/);
  unchanged(before);

  const failed = run(process.execPath, [command], { env: { WEB_KIT_REVIEW_TEST_MODE: "error" } });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /exit 7/);
  unchanged(before);

  const localFake = path.join(project, "node_modules", ".bin", "codex.mjs");
  fs.mkdirSync(path.dirname(localFake), { recursive: true });
  fs.writeFileSync(localFake, "throw new Error('project-controlled CLI was executed');\n");
  const withFake = snapshot();
  const rejected = run(process.execPath, [command], { env: { WEB_KIT_STANDALONE_CODEX_BIN: localFake } });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /No trusted Codex CLI/);
  unchanged(withFake);
  console.log("Simple changes review: PASS (fresh process, direct report, failures, preserved Git and source)");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
