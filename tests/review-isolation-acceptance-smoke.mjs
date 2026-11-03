#!/usr/bin/env node
// These mocked records test verifier logic only. They are never native evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { suites, parseArgs, createOutputDirectory, runCommand, installedManifest,
  nativeEnvironmentProblems, assessSuites, assertCheckEvidence, assessReviewEvidence } from "../scripts/verify-review-isolation.mjs";
import { validateReviewReport } from "../pack/runtime/review-contract.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-acceptance-smoke-")));
const script = path.join(repo, "scripts/verify-review-isolation.mjs");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const invoke = args => spawnSync(process.execPath, [script, ...args], { cwd: repo, env: process.env, encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024 });

try {
  assert.deepEqual(parseArgs(["--portable"]), { portable: true });
  assert.equal(parseArgs(["--project", "project with spaces", "--task-id", "TASK-1", "--output", "new directory"]).taskId, "TASK-1");
  assert.deepEqual(parseArgs(["--help"]), { help: true });
  for (const args of [[], ["--portable", "--task-id", "TASK"], ["--project", "."], ["--task-id", "TASK"],
    ["--portable", "--portable"], ["--portable", "--output"], ["--portable", "--platform", "darwin"],
    ["--help", "--portable"], ["--project", ".", "--task-id", "../TASK"], ["--project", ".", "--task-id", ".."],
    ["--project", ".", "--task-id", "a\nb"], ["--portable", "--output", ""], ["--portable", "unexpected"]]) {
    assert.throws(() => parseArgs(args), undefined, JSON.stringify(args));
  }
  const invalid = invoke(["--portable", "--verified"]);
  assert.equal(invalid.status, 2, invalid.stderr);
  assert.equal(JSON.parse(invalid.stdout).status, "INVALID");
  const help = invoke(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /not native proof/);

  const directory = createOutputDirectory(path.join(root, "preserved evidence"), [repo]);
  const report = { commands: [] };
  const stdout = "first line\nsecond line\n";
  const stderr = "diagnostic line\n";
  const command = runCommand(report, directory, "capture", process.execPath,
    ["-e", "process.stdout.write('first line\\nsecond line\\n'); process.stderr.write('diagnostic line\\n'); process.exitCode=7"], { cwd: root });
  assert.equal(command.exit_code, 7);
  assert.equal(command.status, "FAIL");
  assert.equal(command.output_complete, true);
  assert.equal(fs.readFileSync(path.join(directory, command.stdout_file), "utf8"), stdout);
  assert.equal(fs.readFileSync(path.join(directory, command.stderr_file), "utf8"), stderr);
  const before = fs.readFileSync(path.join(directory, command.stdout_file));
  assert.throws(() => createOutputDirectory(directory), /exist/i);
  assert.deepEqual(fs.readFileSync(path.join(directory, command.stdout_file)), before);
  assert.throws(() => createOutputDirectory(path.join(repo, "must-not-create-evidence"), [repo]), /outside/);
  assert.equal(fs.existsSync(path.join(repo, "must-not-create-evidence")), false);
  if (process.platform !== "win32") {
    const previous = process.env.TMPDIR;
    try {
      process.env.TMPDIR = root;
      assert.throws(() => createOutputDirectory(undefined, [root]), /temporary directory is inside/);
    } finally {
      if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous;
    }
  }
  const unavailable = runCommand(report, directory, "missing-command", path.join(root, "unavailable"), [], { cwd: root });
  assert.equal(unavailable.status, "FAIL");
  assert.equal(unavailable.output_complete, false);
  assert.equal(unavailable.error, "ENOENT");
  const timed = runCommand(report, directory, "timeout", process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd: root, timeout: 100 });
  assert.equal(timed.status, "FAIL");
  assert.equal(timed.output_complete, false);
  assert.equal(timed.error, "ETIMEDOUT");

  const mockResults = suites.map(suite => ({ id: suite.id, status: "PASS", output_complete: true, stdout: "Portable fixture assertions passed.\n" }));
  const portable = assessSuites(mockResults, false);
  assert.equal(portable.status, "PORTABLE_PASS");
  assert.equal(portable.native_acceptance, false);
  assert.equal(assessSuites(mockResults, true).status, "BLOCKED", "Exit zero without real/native coverage must fail closed.");
  const nativeMarkers = mockResults.map((result, i) => ({ ...result, stdout: suites[i].native.join("\n") }));
  assert.equal(assessSuites(nativeMarkers, true).status, "SUITES_PASS");
  assert.equal(assessSuites(nativeMarkers, true).native_acceptance, false, "Even complete suite records cannot establish full native acceptance without target execution.");
  assert.equal(assessSuites(nativeMarkers.slice(0, 3), false).status, "FAIL", "The verifier's own suite must remain in the routed check.");
  for (const mutation of [result => { result.status = "FAIL"; }, result => { result.output_complete = false; }]) {
    const changed = clone(mockResults); mutation(changed[1]);
    assert.equal(assessSuites(changed, false).exit_code, 1);
  }
  assert.deepEqual(nativeEnvironmentProblems({ PATH: "/bin", CODEX_HOME: "/real-home", OPENAI_API_KEY: "not-recorded" }), []);
  for (const name of ["WEB_KIT_CODE_REVIEW_CODEX_BIN", "WEB_KIT_TEST_CODE_REVIEW_MODE", "WEB_KIT_CODE_REVIEW_SANDBOX_VERIFIED", "NODE_OPTIONS", "NODE_PATH", "SANDBOX_EXEC"]) {
    assert.deepEqual(nativeEnvironmentProblems({ [name]: "fixture" }), [name]);
  }

  const source = path.join(root, "mock source");
  const target = path.join(root, "mock installed target");
  const entries = [
    ["pack/runtime/code-review.mjs", ".agent-core/bin/code-review.mjs"],
    ["pack/runtime/review-contract.mjs", ".agent-core/bin/review-contract.mjs"],
    ["pack/agents/code-reviewer.md", ".agent-core/agents/code-reviewer.md"],
    ...["project-paths.mjs", "scope-guard.mjs", "pre-pr-review.md"].map(name => ["pack/rules/" + name, ".agent-core/rules/" + name]),
  ];
  for (const [from, to] of entries) { write(path.join(source, from), "fixture bytes: " + from); write(path.join(target, to), "fixture bytes: " + from); }
  assert(installedManifest(source, target).every(file => file.status === "MATCH"));
  write(path.join(target, ".agent-kit.json"), JSON.stringify({ version: "1.5.0", source: { ref: "same-version-is-not-proof" } }));
  write(path.join(target, ".agent-core/bin/code-review.mjs"), "old runtime with the same advertised version");
  assert.equal(installedManifest(source, target).find(file => file.installed.endsWith("/code-review.mjs")).status, "MISMATCH");
  fs.rmSync(path.join(target, ".agent-core/rules/pre-pr-review.md"));
  assert.equal(installedManifest(source, target).find(file => file.installed.endsWith("/pre-pr-review.md")).status, "MISSING_OR_UNSAFE");
  if (process.platform !== "win32") {
    fs.symlinkSync(path.join(source, "pack/rules/pre-pr-review.md"), path.join(target, ".agent-core/rules/pre-pr-review.md"));
    assert.equal(installedManifest(source, target).find(file => file.installed.endsWith("/pre-pr-review.md")).status, "MISSING_OR_UNSAFE");
  }

  const definition = { id: "test", script: "test" };
  const snapshot = { task_id: "TASK", source_digest: "a".repeat(64), change_digest: "b".repeat(64), files: ["src/example.mjs"], prior_findings: [] };
  const job = { task_id: "TASK", status: "IMPLEMENTING", pr_bound: true, quality: {
    required_checks: [definition], checks: [{ script: "test", status: "PASS", exit_code: 0, source_digest: snapshot.source_digest, change_digest: snapshot.change_digest, definition_digest: hash(JSON.stringify(definition)) }],
    requirements: [{ id: "REQ-1", verification: { status: "PASS", evidence: ["Recorded fixture check"], method: "check", check_script: "test", source_digest: snapshot.source_digest, change_digest: snapshot.change_digest } }],
  } };
  assert.doesNotThrow(() => assertCheckEvidence(job, snapshot));
  for (const change of [item => { item.quality.checks = []; }, item => { item.quality.checks[0].source_digest = "old"; },
    item => { item.quality.checks[0].exit_code = 1; }, item => { item.quality.required_checks[0].script = "different"; },
    item => { item.quality.requirements[0].verification.change_digest = "old"; }, item => { item.status = "DONE"; },
    item => { item.quality.checks.push({ script: "optional", status: "FAIL" }); }]) {
    const changed = clone(job); change(changed); assert.throws(() => assertCheckEvidence(changed, snapshot));
  }

  const mockReport = { schema_version: 1, summary: "Mock verifier unit record, not a real review.", files_reviewed: snapshot.files,
    requirements: [{ id: "REQ-1", status: "PASS", evidence: "Fixture source trace" }],
    scenarios: ["normal", "negative", "integration"].map(kind => ({ requirement_id: "REQ-1", kind, status: "PASS", scenario: "Fixture case", expected: "Fixture expectation", observed: "Fixture trace", evidence: "Fixture source trace" })),
    boundaries: [{ name: "Fixture boundary", status: "NOT_APPLICABLE", files: [], evidence: "Unit record only" }], findings: [], prior_findings: [], verification_gaps: [] };
  const now = Date.now();
  const input = { result: { task_id: "TASK", run_id: "new-run", provider: "codex", verdict: "READY TO OPEN PR", review_verdict: "READY TO OPEN PR", reasons: [], report_path: ".agent-core/state/code-reviews/TASK/new-run.json" },
    validation: { ...validateReviewReport(mockReport, snapshot, job), digest: "d".repeat(64), envelope: { task_id: "TASK", run_id: "new-run", verdict: "READY TO OPEN PR", report: mockReport, provenance: {
      kind: "provider-process", provider: "codex", pid: 123456789, fresh_session: true, read_only: true, exit_code: 0,
      started_at: new Date(now + 100).toISOString(), completed_at: new Date(now + 200).toISOString(), outer_sandbox: {
        schema_version: 1, backend: "macos-seatbelt", verified: true, protected_filesystem_read_only: true, inherited_by_children: true,
        host_socket_probes_denied: true, network: "bounded-model-connect-proxy", profile_sha256: "c".repeat(64),
      } } } },
    job: { ...clone(job), quality: { ...clone(job.quality), review_attempt: { status: "COMPLETE", run_id: "new-run" }, code_review: { status: "PASS", report_path: ".agent-core/state/code-reviews/TASK/new-run.json", artifact_digest: "d".repeat(64) } } },
    command: { started_at: new Date(now).toISOString(), completed_at: new Date(now + 300).toISOString(), exit_code: 0, output_complete: true, error: null }, previousRuns: ["old-run"] };
  assert.equal(assessReviewEvidence(input).acceptable, true, "Only the pure mock record validator is exercised here.");
  for (const change of [item => { item.previousRuns.push("new-run"); }, item => { item.result.run_id = "old-run"; },
    item => { item.validation.envelope.provenance.started_at = new Date(now - 1).toISOString(); },
    item => { item.validation.envelope.provenance.fresh_session = false; }, item => { item.validation.envelope.provenance.exit_code = 1; },
    item => { delete item.validation.envelope.provenance.outer_sandbox; }, item => { item.validation.envelope.provenance.outer_sandbox.verified = false; },
    item => { item.job.quality.review_attempt.status = "RUNNING"; }, item => { item.result.reasons.push("Missing native evidence"); },
    item => { item.validation.reasons.push("Missing scenario evidence"); }, item => { item.command.output_complete = false; }]) {
    const changed = clone(input); change(changed); assert.throws(() => assessReviewEvidence(changed));
  }
  const notReady = clone(input);
  notReady.validation.envelope.report.requirements[0].status = "FAIL";
  notReady.validation.envelope.report.scenarios = []; // Confirmed failure must not conceal missing coverage.
  Object.assign(notReady.validation, validateReviewReport(notReady.validation.envelope.report, snapshot, job));
  notReady.validation.envelope.verdict = notReady.validation.verdict;
  notReady.result.verdict = notReady.validation.verdict;
  notReady.result.review_verdict = notReady.validation.verdict;
  notReady.result.reasons = notReady.validation.reasons;
  notReady.command.exit_code = 4;
  notReady.job.quality.code_review.status = "FAIL";
  assert.equal(notReady.validation.verdict, "NOT READY");
  assert(notReady.validation.reasons.length > 1);
  assert.equal(assessReviewEvidence(notReady).acceptable, false);
  assert.equal(assessReviewEvidence(notReady).review_execution, "COMPLETED");

  // A real CLI attempt must block before inference on this host/invalid target.
  const blockedDir = path.join(root, "native-blocked");
  const native = invoke(["--project", path.join(root, "missing-installed-target"), "--task-id", "TASK", "--output", blockedDir]);
  assert.equal(native.status, 4, native.stdout + native.stderr);
  const summary = JSON.parse(native.stdout);
  const evidence = JSON.parse(fs.readFileSync(summary.report_path, "utf8"));
  assert.equal(summary.mode, "native");
  assert.equal(summary.status, "BLOCKED");
  assert.equal(summary.native_acceptance, false);
  assert.equal(evidence.review_execution, "NOT_RUN");
  assert(!evidence.commands.some(item => item.id === "target-review"));
  assert(evidence.commands.every(item => fs.existsSync(path.join(blockedDir, item.stdout_file)) && fs.existsSync(path.join(blockedDir, item.stderr_file))));
  if (process.platform !== "darwin") assert(evidence.reasons.some(reason => reason.includes("requires actual macOS")));
  const saved = fs.readFileSync(summary.report_path);
  const repeated = invoke(["--project", target, "--task-id", "TASK", "--output", blockedDir]);
  assert.equal(repeated.status, 2);
  assert.deepEqual(fs.readFileSync(summary.report_path), saved);
  console.log("Review isolation acceptance verifier smoke passed: arguments, preserved output, installed hashes, current checks, fresh review evidence, and fail-closed native/portable labels.");
  console.log("Mock verifier records are unit coverage only; this suite does not prove native macOS enforcement or real Codex full review.");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
