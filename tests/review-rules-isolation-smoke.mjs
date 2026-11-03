#!/usr/bin/env node
// Exercise the actual runner and policy inventories. Native success is not mocked.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = path.join(repo, "pack/runtime");
const fixture = path.join(repo, "tests/fixtures/mock-code-review-provider.mjs");
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-rules-isolation-")));
const project = path.join(root, "project with spaces");
const providerHome = path.join(root, "provider-home");
const systemHome = path.join(root, "provider-system");
const audit = path.join(root, "provider-audit.jsonl");
const marker = path.join(root, "allow-rule-write-marker");
const startupMarker = path.join(root, "unexpected-provider-startup");
const installationFile = path.join(providerHome, "installation_id");
const installationId = crypto.randomUUID();
const task = "RULES-ISOLATION";
const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/^CODEX_EXEC_SERVER_/i.test(name) && !/^(?:https?_proxy|all_proxy|no_proxy|OPENAI_BASE_URL|OPENAI_API_BASE)$/i.test(name)));
const env = { ...inherited, CODEX_HOME: providerHome, WEB_KIT_CODE_REVIEW_CODEX_BIN: fixture, WEB_KIT_TEST_CODE_REVIEW_SYSTEM_HOME: systemHome, WEB_KIT_TEST_CODE_REVIEW_AUDIT: audit, WEB_KIT_TEST_PERMISSION_MARKER: marker, WEB_KIT_CONTEXT_SUPERVISOR_BYPASS: "1" };
const restriction = ["--config", 'approval_policy="never"', "--config", 'approvals_reviewer="user"', "--config", 'sandbox_mode="read-only"'];
const allowRule = 'prefix_rule(pattern = ["node", ".codex/write-permission-marker.cjs"], decision = "allow")\n';

function write(relative, content) {
  const file = path.join(project, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function command(bin, args, expected = 0, extraEnv = {}) {
  const result = spawnSync(bin, args, { cwd: project, env: { ...env, ...extraEnv }, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${path.basename(bin)} ${args[0] || ""}\n${result.stdout}\n${result.stderr}`);
  return result;
}
const git = (...args) => command("git", args);
const progress = (...args) => JSON.parse(command(process.execPath, [path.join(runtime, "work-progress.mjs"), ...args, "--project", project]).stdout);
const readJob = () => JSON.parse(fs.readFileSync(path.join(project, ".agent-core/state/jobs", task + ".json"), "utf8"));
const readAudit = () => fs.readFileSync(audit, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
function verify() {
  progress("check-run", "--task-id", task, "--script", "test");
  progress("requirement-verify", "--task-id", task, "--id", "REQ-001", "--result", "PASS", "--check-script", "test", "--evidence", "Owner and non-owner inputs passed the real fixture regression test.");
}
function review(expected, mode = "normal", extraEnv = {}) {
  const result = command(process.execPath, [path.join(runtime, "code-review.mjs"), "--project", project, "--task-id", task, "--provider", "codex", "--json", "--timeout", "45"], expected, { WEB_KIT_TEST_CODE_REVIEW_MODE: mode, ...extraEnv });
  assert(!result.stdout.includes("DO_NOT_LEAK_PREFLIGHT_SECRET") && !result.stderr.includes("DO_NOT_LEAK_PREFLIGHT_SECRET"));
  return JSON.parse(result.stdout);
}

try {
  for (const directory of [project, providerHome, systemHome]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(providerHome, "config.toml"), 'model = "preserved-user-model"\napproval_policy = "on-request"\n');
  fs.writeFileSync(installationFile, installationId, { mode: 0o644 });
  fs.chmodSync(installationFile, 0o644);
  const installationStat = fs.lstatSync(installationFile);
  fs.writeFileSync(path.join(systemHome, "config.toml"), "# Preserved system policy\n");
  write(".codex/config.toml", 'model = "preserved-user-model"\n');
  write(".codex/write-permission-marker.cjs", 'require("node:fs").writeFileSync(process.env.WEB_KIT_TEST_PERMISSION_MARKER, "allow-rule write ran\\n");\n');
  write("src/feature.js", "export function canCancel() { return false; }\n");
  write("tests/feature.test.mjs", 'import assert from "node:assert/strict"; import { canCancel } from "../src/feature.js"; assert.equal(canCancel({id:"a"},{userId:"a"}),true); assert.equal(canCancel({id:"a"},{userId:"b"}),false);\n');
  write("package.json", JSON.stringify({ name: "rules-isolation-fixture", private: true, type: "module", scripts: { test: "node tests/feature.test.mjs" } }) + "\n");
  fs.mkdirSync(path.join(project, ".agent-core/rules"), { recursive: true });
  for (const name of ["scope-guard.mjs", "project-paths.mjs"]) fs.copyFileSync(path.join(repo, "pack/rules", name), path.join(project, ".agent-core/rules", name));
  git("init", "-b", "main");
  git("config", "user.name", "Rules isolation test");
  git("config", "user.email", "rules-test@example.invalid");
  git("add", ".");
  git("commit", "-m", "fixture baseline");
  git("switch", "-c", "fix/reviewer-rules");
  progress("start", "--task-id", task, "--classification", "SMALL", "--pr-bound", "--title", "Preserve booking owner boundary");
  command(process.execPath, [path.join(repo, "pack/rules/scope-guard.mjs"), "start", "--project", project, "--task-id", task, "--base", "main", "--intent", "Preserve booking owner boundary", "--allow", "src/feature.js", "--allow", ".codex/rules/review-probe.rules"]);
  progress("requirement-add", "--task-id", task, "--id", "REQ-001", "--description", "Booking owner boundary", "--acceptance", "Owners can cancel their bookings; other users cannot.");
  progress("check-require", "--task-id", task, "--script", "test");
  progress("update", "--task-id", task, "--status", "IMPLEMENTING", "--agent", "builder");
  write("src/feature.js", "export function canCancel(user, booking) { return Boolean(user) && user.id === booking.userId; }\n");
  verify();
  assert.equal(review(0).verdict, "READY TO OPEN PR", "Ordinary reviews without .rules must continue to work.");
  const configurationFiles = [path.join(providerHome, "config.toml"), path.join(systemHome, "config.toml"), path.join(project, ".codex/config.toml")];
  const originals = configurationFiles.map(file => fs.readFileSync(file, "utf8"));
  let checkedRealRules = false;
  let realCodexUnavailable = false;

  for (const directory of [path.join(providerHome, "rules"), path.join(systemHome, "rules"), path.join(project, ".codex/rules")]) {
    fs.mkdirSync(directory, { recursive: true });
    const policy = path.join(directory, "review-probe.rules");
    fs.writeFileSync(policy, allowRule);
    command(process.execPath, [fixture, "--fixture-permission-only", ...restriction]);
    assert.equal(fs.readFileSync(marker, "utf8"), "allow-rule write ran\n", "The unsandboxed positive control must execute the matching allow-rule command.");
    fs.rmSync(marker);
    if (!checkedRealRules && !realCodexUnavailable) {
      const classification = spawnSync("codex", ["execpolicy", "check", "--rules", policy, "--", "node", ".codex/write-permission-marker.cjs"], { cwd: project, env, encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
      if (classification.error?.code === "ENOENT") realCodexUnavailable = true;
      else {
        assert.ifError(classification.error);
        assert.equal(classification.status, 0, "Installed Codex must support actual no-inference rule classification for this check.");
        assert.equal(JSON.parse(classification.stdout).decision, "allow", "Real Codex must classify the exact probe command as allow.");
        checkedRealRules = true;
      }
    }
    verify();
    const inferenceCount = readAudit().filter(item => item.kind === "review").length;
    if (process.platform === "darwin") {
      const result = review(0, "outer-boundary");
      assert.equal(result.verdict, "READY TO OPEN PR");
      const artifact = JSON.parse(fs.readFileSync(path.join(project, result.report_path), "utf8"));
      assert.equal(artifact.provenance.outer_sandbox.backend, "macos-seatbelt");
      assert.match(artifact.report.summary, /matching allow-rule child.*real write was denied/);
      assert.equal(readJob().quality.code_review.status, "PASS");
    } else {
      const result = review(4, "outer-boundary", { WEB_KIT_CODE_REVIEW_SANDBOX_VERIFIED: "1" });
      assert.equal(result.verdict, "VERIFICATION BLOCKED");
      assert(result.reasons.some(reason => /outer sandbox|macOS.*sandbox|native.*sandbox/i.test(reason)), "Configured rules need an explicit unavailable outer-sandbox reason.");
      assert.equal(readJob().quality.code_review.status, "BLOCKED", "A failed outer boundary must invalidate earlier approval.");
      assert.equal(readAudit().filter(item => item.kind === "review").length, inferenceCount, "Unverified outer protection must block before inference.");
    }
    assert(!fs.existsSync(marker), "The actual allow-matching child escaped the outer boundary.");
    assert.equal(fs.readFileSync(policy, "utf8"), allowRule, "The runner deleted or rewrote configured rules.");
    assert.equal(fs.readFileSync(installationFile, "utf8"), installationId, "Runtime installation ID changed during review.");
    for (const field of ["dev", "ino", "uid", "mode", "nlink", "size", "mtimeMs", "ctimeMs"]) assert.equal(fs.lstatSync(installationFile)[field], installationStat[field], "Runtime installation identity or metadata changed during review.");
    assert.deepEqual(configurationFiles.map(file => fs.readFileSync(file, "utf8")), originals, "The runner modified user or managed configuration.");
    fs.rmSync(policy);
  }
  // Codex reports system and project layer locations even when their files or
  // rules directories do not exist. Keeping an absent policy path read-only
  // must not make an otherwise usable native boundary fail setup.
  fs.rmSync(systemHome, { recursive: true });
  const onlyUserPolicy = path.join(providerHome, "rules", "review-probe.rules");
  fs.writeFileSync(onlyUserPolicy, allowRule);
  verify();
  const absentSystem = review(process.platform === "darwin" ? 0 : 4, "outer-boundary");
  assert.equal(absentSystem.verdict, process.platform === "darwin" ? "READY TO OPEN PR" : "VERIFICATION BLOCKED");
  assert.equal(fs.existsSync(systemHome), false, "Read-only review must not manufacture absent configuration directories.");
  assert.equal(fs.readFileSync(onlyUserPolicy, "utf8"), allowRule);
  assert(!fs.existsSync(marker));
  fs.rmSync(onlyUserPolicy);
  if (process.platform === "darwin") {
    fs.writeFileSync(onlyUserPolicy, allowRule);
    verify();
    const invalidAlias = path.join(root, "invalid-runtime-alias");
    const invalidCases = [
      () => fs.writeFileSync(installationFile, "not-a-uuid"),
      () => fs.writeFileSync(installationFile, ""),
      () => fs.chmodSync(installationFile, 0o600),
      () => fs.linkSync(installationFile, invalidAlias),
      () => { fs.renameSync(installationFile, invalidAlias); fs.symlinkSync(invalidAlias, installationFile); },
    ];
    for (const arrange of invalidCases) {
      try {
        arrange();
        const before = fs.readFileSync(audit, "utf8");
        const bytes = fs.readFileSync(installationFile);
        const stat = fs.lstatSync(installationFile);
        const blocked = review(4, "outer-boundary", { WEB_KIT_TEST_CODE_REVIEW_STARTUP_MARKER: startupMarker });
        assert.equal(blocked.verdict, "VERIFICATION BLOCKED");
        assert(blocked.reasons.some(reason => /installation/i.test(reason)));
        assert.equal(fs.existsSync(startupMarker), false, "Invalid runtime state must block before any provider command can initialize or rewrite it.");
        assert.equal(fs.readFileSync(audit, "utf8"), before);
        assert.deepEqual(fs.readFileSync(installationFile), bytes, "Blocked startup must not repair or rewrite the unsafe runtime file.");
        for (const field of ["dev", "ino", "uid", "mode", "nlink", "size", "mtimeMs", "ctimeMs"]) assert.equal(fs.lstatSync(installationFile)[field], stat[field]);
      } finally {
        fs.rmSync(installationFile, { force: true });
        fs.rmSync(invalidAlias, { force: true });
        fs.writeFileSync(installationFile, installationId, { mode: 0o644 });
        fs.chmodSync(installationFile, 0o644);
      }
    }
    fs.rmSync(onlyUserPolicy);
    console.log("Native unsafe runtime ID guard before provider startup: PASS");
  }
  verify();
  assert.equal(review(0).verdict, "READY TO OPEN PR", "A failed protected attempt must not break a later legitimate no-rules run.");
  console.log("Rules inventory, policy preservation and fail-closed runner integration: PASS");
  console.log(checkedRealRules ? "Real Codex allow-rule classification: PASS" : "Real Codex allow-rule classification: NOT RUN (Codex is unavailable). The protocol fixture is not a real Codex security test.");
  console.log(process.platform === "darwin" ? "Native allow-rule read/write enforcement through the runner: PASS" : `Native allow-rule read/write enforcement through the runner: BLOCKED (requires macOS; current platform ${process.platform}).`);
  if (process.env.WEB_KIT_REQUIRE_NATIVE_SANDBOX_TEST === "1" && (process.platform !== "darwin" || !checkedRealRules)) throw new Error("Required native or real Codex verification could not run.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
