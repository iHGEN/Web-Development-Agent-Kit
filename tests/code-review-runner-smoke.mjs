#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = path.join(repo, "pack/runtime");
const fixture = path.join(repo, "tests/fixtures/mock-code-review-provider.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-review-runner-"));
const project = path.join(root, "project with spaces");
const audit = path.join(root, "provider-audit.jsonl");
const task = "REVIEW-RUNNER";
const env = { ...process.env, WEB_KIT_CODE_REVIEW_CODEX_BIN: fixture, WEB_KIT_CODE_REVIEW_CLAUDE_BIN: fixture, WEB_KIT_CODE_REVIEW_GEMINI_BIN: fixture, WEB_KIT_TEST_CODE_REVIEW_AUDIT: audit, WEB_KIT_TEST_CODE_REVIEW_DIFF_MARKERS: "1", GIT_EXTERNAL_DIFF: path.join(root, "external-diff-must-not-run") };
const write = (relative, content) => { const file = path.join(project, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const readJob = () => JSON.parse(fs.readFileSync(path.join(project, `.agent-core/state/jobs/${task}.json`), "utf8"));
const readAudit = () => fs.readFileSync(audit, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
function command(bin, args, expected = 0, extraEnv = {}) {
  const result = spawnSync(bin, args, { cwd: project, env: { ...env, ...extraEnv }, encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, expected, `${bin} ${args.join(" ")}\n${result.error?.message || ""}\n${result.stdout}\n${result.stderr}`);
  return result;
}
const git = (...args) => command("git", args);
const progress = (...args) => JSON.parse(command(process.execPath, [path.join(runtime, "work-progress.mjs"), ...args, "--project", project]).stdout);
function review(provider = "codex", mode = "normal", expected = 0, extra = [], extraEnv = {}) {
  const result = command(process.execPath, [path.join(runtime, "code-review.mjs"), "--project", project, "--task-id", task, "--provider", provider, "--json", ...extra], expected, { WEB_KIT_TEST_CODE_REVIEW_MODE: mode, ...extraEnv });
  for (const secret of ["DO_NOT_LEAK_PROVIDER_DETAIL", "DO_NOT_LEAK_PREFLIGHT_SECRET"]) assert(!result.stdout.includes(secret) && !result.stderr.includes(secret), "Raw provider or tool-configuration secrets leaked.");
  return JSON.parse(result.stdout);
}
function verify() {
  progress("check-run", "--task-id", task, "--script", "test");
  progress("requirement-verify", "--task-id", task, "--id", "REQ-001", "--result", "PASS", "--check-script", "test", "--evidence", "Owner cancellation unit test passed; reviewer must inspect the negative ownership case.");
}

try {
  fs.mkdirSync(project);
  write("src/feature.js", "export function canCancel() { return false; }\n");
  write("docs/change-evidence.md", "baseline-evidence-marker\n");
  write(".gitattributes", "docs/change-evidence.md diff=review-evidence\n");
  write("tests/feature.test.mjs", 'import assert from "node:assert/strict"; import { canCancel } from "../src/feature.js"; assert.equal(canCancel({id:"a"},{userId:"a"}),true);\n');
  write("package.json", JSON.stringify({ name: "review-runner-fixture", private: true, type: "module", scripts: { test: "node tests/feature.test.mjs" } }) + "\n");
  fs.mkdirSync(path.join(project, ".agent-core/rules"), { recursive: true });
  fs.copyFileSync(path.join(repo, "pack/rules/scope-guard.mjs"), path.join(project, ".agent-core/rules/scope-guard.mjs"));
  git("init", "-b", "main"); git("config", "user.name", "Review runner smoke"); git("config", "user.email", "review-runner@example.invalid");
  git("config", "diff.review-evidence.textconv", path.join(root, "textconv-must-not-run"));
  git("add", "."); git("commit", "-m", "fixture baseline"); git("switch", "-c", "feat/booking-owner");
  progress("start", "--task-id", task, "--classification", "SMALL", "--pr-bound", "--title", "Allow owners to cancel only their own bookings");
  command(process.execPath, [path.join(repo, "pack/rules/scope-guard.mjs"), "start", "--project", project, "--task-id", task, "--base", "main", "--intent", "Allow owners to cancel only their own bookings", "--allow", "src/feature.js", "--allow", "src/untracked.js", "--allow", "docs/change-evidence.md"]);
  progress("requirement-add", "--task-id", task, "--id", "REQ-001", "--description", "Booking ownership", "--acceptance", "Owners may cancel their own booking and cannot cancel another user's booking.");
  progress("check-require", "--task-id", task, "--script", "test");
  progress("update", "--task-id", task, "--status", "IMPLEMENTING", "--agent", "builder");
  write("docs/change-evidence.md", "committed-evidence-marker\n");
  git("add", "docs/change-evidence.md"); git("commit", "-m", "committed review evidence fixture");
  write("docs/change-evidence.md", "staged-evidence-marker\n");
  git("add", "docs/change-evidence.md");
  write("docs/change-evidence.md", "unstaged-evidence-marker\n");
  write("src/untracked.js", "export const untrackedEvidence = true;\n");
  write("src/feature.js", "export function canCancel(user) { return Boolean(user); }\n");
  verify();

  const broken = review("codex", "normal", 4);
  assert.equal(broken.verdict, "NOT READY");
  assert.equal(readJob().quality.code_review.status, "FAIL");
  const initialArtifact = JSON.parse(fs.readFileSync(path.join(project, broken.report_path), "utf8"));
  assert(initialArtifact.provenance.pid > 0 && initialArtifact.provenance.pid !== process.pid);
  assert.equal(initialArtifact.provenance.fresh_session, true);
  assert.equal(initialArtifact.provenance.read_only, true);
  assert.equal(initialArtifact.report.findings[0].id, "BUG-OWNERSHIP");

  const dropped = review("codex", "drop-prior", 4);
  assert.equal(dropped.verdict, "VERIFICATION BLOCKED", "Silently dropping a known defect must block approval.");

  write("src/feature.js", "export function canCancel(user, booking) { return Boolean(user) && booking.userId === user.id; }\n");
  verify();
  const fixed = review("codex");
  assert.equal(fixed.verdict, "READY TO OPEN PR");
  assert.notEqual(fixed.run_id, broken.run_id);
  const fixedArtifact = JSON.parse(fs.readFileSync(path.join(project, fixed.report_path), "utf8"));
  assert.equal(fixedArtifact.report.prior_findings[0].status, "RESOLVED", "Actual resolution evidence must survive a blocked attempt.");
  assert.equal(readJob().quality.review_attempt.status, "COMPLETE");

  assert.equal(review("claude").verdict, "READY TO OPEN PR");
  const beforeGemini = fs.readFileSync(audit, "utf8");
  const gemini = review("gemini", "normal", 4);
  assert.equal(gemini.verdict, "VERIFICATION BLOCKED");
  assert(gemini.reasons.some(reason => reason.includes("configured user policies")));
  assert.equal(readJob().quality.code_review.status, "BLOCKED", "An unsafe provider choice must invalidate earlier approval.");
  assert.equal(fs.readFileSync(audit, "utf8"), beforeGemini, "Gemini must not launch even when its executable is available.");
  assert.equal(review("auto").provider, "codex");
  assert.equal(review("codex", "empty-servers").verdict, "READY TO OPEN PR", "A valid empty MCP list needs only connector and plugin restrictions.");
  if (process.platform === "win32") {
    const shimDirectory = path.join(root, "provider $& $$");
    fs.mkdirSync(shimDirectory);
    fs.copyFileSync(fixture, path.join(shimDirectory, "fixture.mjs"));
    const shim = path.join(shimDirectory, "review.cmd");
    fs.writeFileSync(shim, '@"%dp0%node.exe" "%dp0%fixture.mjs" %*\r\n');
    assert.equal(review("codex", "normal", 0, [], { WEB_KIT_CODE_REVIEW_CODEX_BIN: shim }).verdict, "READY TO OPEN PR", "Literal dollar signs in a Windows npm shim path must survive resolution.");
  }
  assert.equal(review("codex", "empty-coverage", 4).verdict, "VERIFICATION BLOCKED");
  review("codex");
  assert.equal(review("codex", "malformed", 4).verdict, "VERIFICATION BLOCKED");
  assert.equal(readJob().quality.code_review.status, "BLOCKED", "Malformed output must invalidate earlier approval.");
  review("codex");
  assert.equal(review("codex", "normal", 4, [], { WEB_KIT_CODE_REVIEW_CODEX_BIN: path.join(root, "missing-cli") }).verdict, "VERIFICATION BLOCKED");
  assert.equal(readJob().quality.code_review.status, "BLOCKED", "Missing provider must invalidate earlier approval.");
  assert.equal(review("codex", "exit", 4).verdict, "VERIFICATION BLOCKED");
  assert.equal(review("codex", "timeout", 4, ["--timeout", "1"]).verdict, "VERIFICATION BLOCKED");
  for (const mode of ["preflight-exit", "preflight-malformed", "preflight-unsupported", "preflight-duplicate", "preflight-timeout"]) {
    const inferenceCount = readAudit().filter(entry => entry.kind === "review").length;
    const failedPreflight = review("codex", mode, 4, mode === "preflight-timeout" ? ["--timeout", "1"] : []);
    assert.equal(failedPreflight.verdict, "VERIFICATION BLOCKED");
    assert(failedPreflight.reasons.some(reason => reason.includes("read-only tool preflight")), "A failed read-only configuration check must explain its block.");
    assert.equal(readJob().quality.code_review.status, "BLOCKED");
    assert.equal(readAudit().filter(entry => entry.kind === "review").length, inferenceCount, "A failed MCP preflight must never launch reviewer inference.");
  }
  const sharedTimeout = review("codex", "shared-timeout", 4, ["--timeout", "1"]);
  assert.equal(sharedTimeout.verdict, "VERIFICATION BLOCKED");
  assert(sharedTimeout.reasons.some(reason => /timed out/i.test(reason)), "The timeout budget must include both preflight and inference.");

  const originalDocs = fs.readFileSync(path.join(project, "docs/change-evidence.md"), "utf8");
  const beforeLargeDiff = fs.readFileSync(audit, "utf8");
  write("docs/change-evidence.md", originalDocs + "large-diff-evidence\n".repeat(500000));
  const oversized = review("codex", "normal", 4);
  assert.equal(oversized.verdict, "VERIFICATION BLOCKED");
  assert(oversized.reasons.some(reason => /diff.*(limit|bound)/i.test(reason)), "Incomplete diff capture must block explicitly.");
  assert.equal(fs.readFileSync(audit, "utf8"), beforeLargeDiff, "A provider must never receive a partial diff.");
  write("docs/change-evidence.md", originalDocs);

  const original = fs.readFileSync(path.join(project, "src/feature.js"), "utf8");
  assert.equal(review("codex", "mutate", 4).verdict, "VERIFICATION BLOCKED");
  assert(fs.readFileSync(path.join(project, "src/feature.js"), "utf8").includes("Unauthorized reviewer edit"), "Runner must report mutation, not silently reset it.");
  write("src/feature.js", original); verify();
  assert.equal(review("codex", "stage", 4).verdict, "VERIFICATION BLOCKED", "Content-equivalent staging violates the read-only reviewer contract.");
  verify();
  assert.equal(review("codex").verdict, "READY TO OPEN PR");

  const records = readAudit();
  const invocations = records.filter(entry => entry.kind === "review");
  assert.equal(new Set(invocations.map(item => item.run_id)).size, invocations.length);
  assert(invocations.every(item => !fs.existsSync(item.context_file) && !fs.existsSync(item.change_evidence)), "Private review contexts and diffs must be cleaned up after success and failure.");
  assert(records.every(item => !fs.existsSync(path.dirname(item.context_file))), "Failed preflight must also remove its private context directory.");
  for (const invocation of invocations.filter(entry => entry.provider === "codex")) {
    const preflight = records.filter(entry => entry.kind === "preflight" && entry.run_id === invocation.run_id);
    assert.equal(preflight.length, 1, "Each Codex inference requires its own configuration preflight.");
    assert.notEqual(preflight[0].pid, invocation.pid, "Configuration inspection and fresh inference use separate processes.");
  }
  assert(invocations.some(item => item.provider === "claude") && !invocations.some(item => item.provider === "gemini"));
  assert(!fs.readFileSync(audit, "utf8").includes("DO_NOT_LEAK_PREFLIGHT_SECRET"));
  const reportDirectory = path.join(project, ".agent-core/state/code-reviews", task);
  for (const report of fs.readdirSync(reportDirectory)) assert(!fs.readFileSync(path.join(reportDirectory, report), "utf8").includes("DO_NOT_LEAK_PREFLIGHT_SECRET"), "Raw MCP transport configuration must not be persisted in review artifacts.");
  console.log("Code review runner smoke: PASS");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
