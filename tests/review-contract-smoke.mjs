#!/usr/bin/env node
// Negative readiness cases: real Git/command evidence plus malformed/competing reviews.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { captureReviewSnapshot, sameReviewSnapshot, validateReviewReport, storeReviewArtifact,
  validateReviewArtifact, reviewArtifactDigest, loadReviewArtifact } from "../pack/runtime/review-contract.mjs";
import { sourceDigest } from "../pack/runtime/quality-pipeline.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-review-contract-"));
const task = "CONTRACT";
const workFile = path.join(repo, "pack/runtime/work-progress.mjs");
const guard = path.join(repo, "pack/rules/scope-guard.mjs");
function run(bin, args, expected = 0) {
  const r = spawnSync(bin, args, { cwd: project, encoding: "utf8", timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(r.status, expected, `${args.join(" ")}\n${r.error?.message || ""}\n${r.stdout}\n${r.stderr}`);
  return r;
}
const git = (...args) => run("git", args);
const work = (...args) => JSON.parse(run(process.execPath, [workFile, ...args, "--project", project]).stdout);
const fail = (...args) => run(process.execPath, [workFile, ...args, "--project", project], 1);
const job = (taskId = task) => JSON.parse(fs.readFileSync(path.join(project, `.agent-core/state/jobs/${taskId}.json`), "utf8"));
const write = (file, data) => { fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true }); fs.writeFileSync(path.join(project, file), data); };
const snapshot = (taskId = task) => captureReviewSnapshot(project, job(taskId), sourceDigest);

function report(snap) {
  return {
    schema_version: 1, summary: "Validated the enabled flag and inspected its sole consumer.",
    files_reviewed: [...new Set([...snap.files, snap.specification?.file].filter(Boolean))],
    requirements: [{ id: "REQ-001", status: "PASS", evidence: "The executed regression asserts enabled is true." }],
    scenarios: [
      { requirement_id: "REQ-001", kind: "normal", status: "PASS", scenario: "Read enabled flag.", expected: "true", observed: "true", evidence: "Node assert in the required regression command." },
      { requirement_id: "REQ-001", kind: "negative", status: "NOT_APPLICABLE", scenario: "Invalid input.", expected: "No input accepted.", observed: "Constant export.", evidence: "Source has no argument or parser." },
      { requirement_id: "REQ-001", kind: "integration", status: "NOT_APPLICABLE", scenario: "External consumer.", expected: "None in fixture.", observed: "Only the regression test imports this module.", evidence: "Reviewed fixture import sites." },
    ],
    boundaries: [{ name: "External interfaces", status: "NOT_APPLICABLE", files: [], evidence: "Isolated constant-only fixture." }],
    findings: [], prior_findings: [], verification_gaps: [],
  };
}
function begin(taskId = task) {
  const id = randomUUID();
  work("quality-review", "--task-id", taskId, "--begin", "--run-id", id);
  return { id, snap: snapshot(taskId) };
}
function artifact(attempt, body = report(attempt.snap)) {
  const current = job(attempt.snap.task_id);
  const result = validateReviewReport(body, attempt.snap, current);
  return storeReviewArtifact(project, current, {
    schema_version: 1, task_id: current.task_id, run_id: attempt.id, snapshot: attempt.snap,
    provenance: { kind: "provider-process", provider: "codex", pid: process.pid, fresh_session: true, read_only: true,
      started_at: new Date().toISOString(), completed_at: new Date().toISOString(), exit_code: 0 },
    report: body, verdict: result.verdict,
  });
}
const importReport = (relative, taskId = task) => work("quality-review", "--task-id", taskId, "--report", relative);

function resolvedReport(attempt) {
  return { ...report(attempt.snap), prior_findings: attempt.snap.prior_findings.map(f => ({
    id: f.id, status: "RESOLVED", evidence: "Rechecked the reported fixture scenario against the current approved specification.",
  })) };
}

function formalSpecificationRegression() {
  const formal = "FORMAL";
  const specFile = `.agent-core/plans/${formal}/spec.md`;
  const verify = () => {
    assert.equal(work("check-run", "--task-id", formal, "--check", "regression").status, "PASS");
    work("requirement-verify", "--task-id", formal, "--id", "REQ-001", "--result", "PASS",
      "--check-script", "regression", "--evidence", "Required regression assertion passed.");
  };
  const approvePlan = () => work("plan-validate", "--task-id", formal, "--result", "APPROVED",
    "--validator", "plan-validator", "--evidence", "Plan covers the current specification.");
  const approveSpec = () => work("spec-validate", "--task-id", formal, "--result", "APPROVED",
    "--validator", "spec-validator", "--evidence", "The specification has a testable acceptance criterion.");

  write(specFile, "# Spec A\nREQ-001: Enable the fixture for the original scenario.\n");
  assert.equal(git("check-ignore", specFile).stdout.trim(), specFile, "Exercise the documented ignored specification location.");
  work("start", "--task-id", formal, "--classification", "LARGE", "--pr-bound");
  work("update", "--task-id", formal, "--status", "PLANNING", "--agent", "builder", "--plan-bullets", "2", "--plan-version", "1");
  run(process.execPath, [guard, "start", "--project", project, "--task-id", formal, "--base", "main",
    "--intent", "Enable the fixture against the approved specification", "--allow", "src/feature.mjs"]);
  work("spec-set", "--task-id", formal, "--file", specFile);
  work("requirement-add", "--task-id", formal, "--id", "REQ-001", "--description", "Enable fixture",
    "--acceptance", "The exported enabled value is true.");
  work("check-require", "--task-id", formal, "--id", "regression", "--command", process.execPath,
    "--arg", "--input-type=module", "--arg", "-e", "--arg", "import assert from 'node:assert/strict'; import {enabled} from './src/feature.mjs'; assert.equal(enabled,true);");
  approveSpec(); approvePlan();
  work("update", "--task-id", formal, "--status", "REVIEWING");
  verify();
  work("quality-review", "--task-id", formal, "--reviewer", "external-reviewer", "--result", "FAIL",
    "--evidence", "Check the fixture's documented acceptance scenario.");
  const knownFindings = job(formal).quality.known_findings;

  // A material plan change supersedes active work without erasing unresolved findings.
  const beforePlan = begin(formal);
  const beforePlanPath = artifact(beforePlan, resolvedReport(beforePlan));
  work("update", "--task-id", formal, "--status", "PLANNING", "--plan-version", "2");
  assert.equal(job(formal).quality.review_attempt.status, "SUPERSEDED");
  assert.deepEqual(job(formal).quality.known_findings, knownFindings);
  approvePlan();
  work("update", "--task-id", formal, "--status", "REVIEWING");
  assert.match(fail("quality-review", "--task-id", formal, "--report", beforePlanPath).stderr, /stale|superseded/i);

  // Keep the registered REQs, source, diff, check definition and check evidence identical.
  const specA = begin(formal);
  const specAPath = artifact(specA, resolvedReport(specA));
  const requirementsA = job(formal).quality.requirements;
  const checksA = job(formal).quality.checks.map(({ at, elapsed_ms, ...evidence }) => evidence);
  assert.equal(specA.snap.specification.file, specFile);
  assert.equal(specA.snap.specification.current_digest, specA.snap.specification.approved_digest);
  assert(!specA.snap.files.includes(specFile), "The ignored specification must be bound independently of Git's changed files.");
  assert.equal(validateReviewReport({ ...resolvedReport(specA), files_reviewed: specA.snap.files }, specA.snap, job(formal)).verdict,
    "VERIFICATION BLOCKED", "A reviewer must inspect the active specification, even when Git ignores it.");
  work("update", "--task-id", formal, "--status", "PLANNING");
  write(specFile, "# Spec B\nREQ-001: Enable the fixture for the revised scenario.\n");
  const unapproved = snapshot(formal);
  assert.equal(unapproved.specification.approved_digest, specA.snap.specification.approved_digest);
  assert.notEqual(unapproved.specification.current_digest, specA.snap.specification.current_digest);
  assert(!sameReviewSnapshot(specA.snap, unapproved), "An unapproved direct spec edit must invalidate the reviewer snapshot.");
  approveSpec();
  assert.equal(job(formal).quality.review_attempt.status, "SUPERSEDED", "Spec reapproval must supersede an older in-flight review.");
  assert.deepEqual(job(formal).quality.known_findings, knownFindings);
  approvePlan();
  work("update", "--task-id", formal, "--status", "REVIEWING");
  verify();
  const specB = snapshot(formal);
  assert.equal(specB.source_digest, specA.snap.source_digest);
  assert.equal(specB.change_digest, specA.snap.change_digest);
  assert.deepEqual(job(formal).quality.requirements.map(({ verification: { at, ...verification }, ...requirement }) => ({ ...requirement, verification })),
    requirementsA.map(({ verification: { at, ...verification }, ...requirement }) => ({ ...requirement, verification })));
  assert.deepEqual(job(formal).quality.checks.slice(-1).map(({ at, elapsed_ms, ...evidence }) => evidence), checksA.slice(-1));
  assert.notEqual(specB.specification.approved_digest, specA.snap.specification.approved_digest);
  assert(!sameReviewSnapshot(specA.snap, specB));
  assert.throws(() => validateReviewArtifact(project, specAPath, job(formal), specB), /stale/);
  assert.match(fail("quality-review", "--task-id", formal, "--report", specAPath).stderr, /stale|superseded/i);
  fail("update", "--task-id", formal, "--status", "DONE", "--final-validation", "PASS");

  // Switching to an identically worded specification also changes its authoritative identity.
  const beforeMove = begin(formal);
  const beforeMovePath = artifact(beforeMove, resolvedReport(beforeMove));
  const movedSpecFile = `.agent-core/plans/${formal}/replacement-spec.md`;
  write(movedSpecFile, fs.readFileSync(path.join(project, specFile), "utf8"));
  work("update", "--task-id", formal, "--status", "PLANNING");
  work("spec-set", "--task-id", formal, "--file", movedSpecFile);
  assert.equal(job(formal).quality.review_attempt.status, "SUPERSEDED");
  approveSpec(); approvePlan();
  work("update", "--task-id", formal, "--status", "REVIEWING");
  verify();
  const moved = snapshot(formal);
  assert.equal(moved.specification.current_digest, specB.specification.current_digest);
  assert.notEqual(moved.specification.file, specB.specification.file);
  assert(!sameReviewSnapshot(beforeMove.snap, moved));
  assert.match(fail("quality-review", "--task-id", formal, "--report", beforeMovePath).stderr, /stale|superseded/i);
  assert.deepEqual(job(formal).quality.known_findings, knownFindings);

  const fresh = begin(formal);
  importReport(artifact(fresh, resolvedReport(fresh)), formal);
  assert.equal(work("report", "--task-id", formal).engineering_quality.gate, "PASS", "A fresh review of specification B must pass.");
  assert.deepEqual(job(formal).quality.known_findings, []);
  work("update", "--task-id", formal, "--status", "DONE", "--final-validation", "PASS");
  assert.equal(job(formal).status, "DONE");
}

try {
  write("src/feature.mjs", "export const enabled = false;\n");
  write("notes.md", "Original docs\n");
  write(".gitignore", ".agent-core/plans/\n");
  write("package.json", JSON.stringify({ private: true, type: "module", scripts: { unrelated: "node -e \"process.exit(0)\"" } }) + "\n");
  fs.mkdirSync(path.join(project, ".agent-core/rules"), { recursive: true });
  fs.copyFileSync(guard, path.join(project, ".agent-core/rules/scope-guard.mjs"));
  fs.copyFileSync(path.join(repo, "pack/rules/project-paths.mjs"), path.join(project, ".agent-core/rules/project-paths.mjs"));
  git("init", "-b", "main"); git("config", "user.name", "Review Contract"); git("config", "user.email", "contract@example.invalid");
  git("add", "."); git("commit", "-m", "baseline"); git("switch", "-c", "feat/review");

  assert.equal(work("start", "--task-id", task, "--classification", "SMALL").pr_bound, true, "Feature branch must activate PR protection without the optional flag.");
  work("start", "--task-id", "LOCAL", "--classification", "SMALL", "--local-only");
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, ".agent-core/state/jobs/LOCAL.json"))).pr_bound, false);
  fail("start", "--task-id", "CONFLICT", "--classification", "SMALL", "--pr-bound", "--local-only");
  fail("start", "--task-id", task, "--classification", "SMALL", "--force", "--local-only");
  run(process.execPath, [guard, "start", "--project", project, "--task-id", task, "--base", "main", "--intent", "Enable fixture", "--allow", "src/feature.mjs", "--allow", "notes.md"]);
  write("src/feature.mjs", "export const enabled = true;\n");
  work("update", "--task-id", task, "--status", "IMPLEMENTING", "--agent", "builder");
  assert(work("report", "--task-id", task).engineering_quality.blockers.some(x => x.includes("No acceptance criteria")));
  work("requirement-add", "--task-id", task, "--id", "REQ-001", "--description", "Enable fixture", "--acceptance", "The exported enabled value is true.");
  work("check-require", "--task-id", task, "--id", "regression", "--command", process.execPath,
    "--arg", "--input-type=module", "--arg", "-e", "--arg", "import assert from 'node:assert/strict'; import {enabled} from './src/feature.mjs'; assert.equal(enabled,true);");
  work("check-run", "--task-id", task, "--script", "unrelated");
  assert(work("report", "--task-id", task).engineering_quality.blockers.some(x => x.includes("Required check") && x.includes("regression")), "Unrelated pass must not satisfy the declared regression check.");
  fail("quality-review", "--task-id", task, "--reviewer", "different-name", "--result", "PASS", "--evidence", "Looks good");
  assert.equal(work("check-run", "--task-id", task, "--check", "regression").status, "PASS");
  work("check-require", "--task-id", task, "--id", "blank-inputs", "--command", process.execPath,
    "--arg", "-e", "--arg", "require('node:assert/strict').deepEqual(process.argv.slice(1), ['', ' ', '--help', '--project', '--script']);",
    "--arg", "--", "--arg=", "--arg", " ", "--arg", "--help", "--arg", "--project", "--arg", "--script");
  assert.equal(work("check-run", "--task-id", task, "--check", "blank-inputs").status, "PASS", "Registered CLI edge-case arguments must reach the process unchanged.");
  assert.deepEqual(job().quality.required_checks.find(c => c.id === "blank-inputs").args.slice(-5), ["", " ", "--help", "--project", "--script"]);
  run(process.execPath, [workFile, "check-require", "--task-id", task, "--id", "missing-arg", "--command", process.execPath, "--project", project, "--arg"], 1);
  work("requirement-verify", "--task-id", task, "--id", "REQ-001", "--result", "PASS", "--check-script", "regression", "--evidence", "Required regression assertion passed.");

  const snap = snapshot();
  const clean = report(snap);
  assert.equal(validateReviewReport(clean, snap, job()).verdict, "READY TO OPEN PR");
  for (const field of ["files_reviewed", "requirements", "scenarios", "boundaries"]) {
    assert.equal(validateReviewReport({ ...clean, [field]: [] }, snap, job()).verdict, "VERIFICATION BLOCKED", `${field} omission must not approve.`);
  }
  assert.throws(() => validateReviewReport({ ...clean, files_reviewed: ["../escape"] }, snap, job()), /unsafe/);
  assert.throws(() => validateReviewReport({ ...clean, requirements: [...clean.requirements, ...clean.requirements] }, snap, job()), /duplicate/);
  assert.equal(validateReviewReport({ ...clean, verification_gaps: ["Could not inspect the consumer."] }, snap, job()).verdict, "VERIFICATION BLOCKED");

  // A stale clean completion cannot overwrite a newer finding on identical code.
  const a = begin(); const pathA = artifact(a);
  const b = begin();
  const bad = report(b.snap);
  bad.findings = [{ id: "BUG-001", severity: "P1", file: "src/feature.mjs", line: 1, symbol: "enabled",
    title: "Fixture blocking finding", trigger: "Specific fixture scenario", evidence: "Explicit finding for ordering test",
    impact: "The later review must remain authoritative", recommendation: "Resolve with evidence" }];
  const pathB = artifact(b, bad); importReport(pathB);
  fail("quality-review", "--task-id", task, "--report", pathA);
  fail("quality-review", "--task-id", task, "--result", "BLOCKED", "--run-id", a.id, "--evidence", "Late timeout");
  assert.equal(job().quality.code_review.status, "FAIL");
  const c = begin();
  work("quality-review", "--task-id", task, "--result", "BLOCKED", "--run-id", c.id, "--evidence", "Provider unavailable");
  assert.equal(job().quality.known_findings[0].id, "BUG-001", "A provider failure must preserve earlier confirmed findings.");
  const d = begin(); const solved = report(d.snap);
  solved.prior_findings = [{ id: "BUG-001", status: "RESOLVED", evidence: "Fixture resolution established independently." }];
  const pathD = artifact(d, solved); importReport(pathD);
  assert.deepEqual(job().quality.known_findings, []);
  assert.equal(work("report", "--task-id", task).engineering_quality.gate, "PASS");

  // A human/external failure arriving mid-run is newer evidence as well.
  const pending = begin(); const pendingPath = artifact(pending);
  work("quality-review", "--task-id", task, "--reviewer", "external-reviewer", "--result", "FAIL", "--evidence", "Newly reported failing behavior must be investigated.");
  assert.equal(job().quality.review_attempt.status, "SUPERSEDED");
  fail("quality-review", "--task-id", task, "--report", pendingPath);
  assert.equal(job().quality.code_review.status, "FAIL");
  assert.equal(job().quality.known_findings[0].kind, "external-observation");
  const unresolved = begin();
  const unresolvedReport = report(unresolved.snap);
  unresolvedReport.prior_findings = unresolved.snap.prior_findings.map(f => ({ id: f.id, status: "OPEN", evidence: "The reporter's reproduction details are still needed." }));
  assert.equal(validateReviewReport(unresolvedReport, unresolved.snap, job()).verdict, "VERIFICATION BLOCKED", "An unverified observation must stay open without inventing a defect.");
  const unresolvedPath = artifact(unresolved, unresolvedReport);
  importReport(unresolvedPath);
  assert.equal(job().quality.code_review.status, "BLOCKED");
  assert.equal(job().quality.code_review.report_path, unresolvedPath, "Preserve the inconclusive review's actual evidence.");
  assert.equal(job().quality.known_findings[0].kind, "external-observation");
  const reconsidered = begin();
  const reconsideredReport = report(reconsidered.snap);
  assert.equal(validateReviewReport(reconsideredReport, reconsidered.snap, job()).verdict, "VERIFICATION BLOCKED", "The next reviewer must address the external objection.");
  reconsideredReport.prior_findings = reconsidered.snap.prior_findings.map(f => ({ id: f.id, status: "RESOLVED", evidence: "Investigated the reported scenario and recorded its actual behavior." }));
  importReport(artifact(reconsidered, reconsideredReport));
  assert.equal(work("report", "--task-id", task).engineering_quality.gate, "PASS");

  const savedHash = reviewArtifactDigest(project, pathD);
  const original = fs.readFileSync(path.join(project, pathD), "utf8");
  fs.appendFileSync(path.join(project, pathD), " ");
  assert.throws(() => validateReviewArtifact(project, pathD, job(), snapshot(), savedHash), /modified/);
  fs.writeFileSync(path.join(project, pathD), original);
  assert.throws(() => validateReviewArtifact(project, pathD, { ...job(), task_id: "OTHER" }, snapshot()), /match/);
  assert.throws(() => loadReviewArtifact(project, "../outside.json"), /canonical/);
  if (process.platform !== "win32") {
    const linked = `.agent-core/state/code-reviews/${task}/linked.json`;
    fs.symlinkSync(path.join(project, pathD), path.join(project, linked));
    assert.throws(() => loadReviewArtifact(project, linked), /symlink/);
    fs.unlinkSync(path.join(project, linked));
  }

  // Content-equivalent Git operations preserve an approval, but fail read-only-run checks.
  const beforeStage = snapshot();
  git("add", "src/feature.mjs");
  const staged = snapshot();
  assert(sameReviewSnapshot(beforeStage, staged));
  assert(!sameReviewSnapshot(beforeStage, staged, true));
  git("commit", "-m", "enable fixture");
  assert(sameReviewSnapshot(beforeStage, snapshot()));
  assert.equal(work("report", "--task-id", task).engineering_quality.gate, "PASS");

  // A base tip can move without changing the merge-base: the old review must expire.
  const base = git("rev-parse", "main").stdout.trim();
  const tree = git("rev-parse", "main^{tree}").stdout.trim();
  const newBase = git("commit-tree", tree, "-p", base, "-m", "advance baseline").stdout.trim();
  git("update-ref", "refs/heads/main", newBase, base);
  assert(!sameReviewSnapshot(beforeStage, snapshot()));
  assert.equal(work("report", "--task-id", task).engineering_quality.gate, "BLOCKED");
  git("update-ref", "refs/heads/main", base, newBase); // Restore only the disposable fixture ref.

  formalSpecificationRegression();

  // Markdown and acceptance changes cannot retain an earlier approval.
  write("notes.md", "Changed after review\n");
  fail("update", "--task-id", task, "--status", "DONE", "--final-validation", "PASS");
  write("notes.md", "Original docs\n");
  work("check-require", "--task-id", task, "--id", "regression", "--command", process.execPath, "--arg", "-e", "--arg", "process.exit(0)");
  assert(work("report", "--task-id", task).engineering_quality.blockers.some(x => x.includes("Required check")));
  console.log("Review contract smoke: PASS");
} finally {
  fs.rmSync(project, { recursive: true, force: true });
}
