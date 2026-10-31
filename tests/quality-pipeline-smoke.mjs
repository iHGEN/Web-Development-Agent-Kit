#!/usr/bin/env node
// Runs against an installed Web Kit, not just source-tree imports.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-quality-pipeline-"));
function call(command, args, expectFailure = false, cwd = project) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true });
  if ((!expectFailure && (result.error || result.status !== 0)) || (expectFailure && !result.error && result.status === 0)) {
    throw new Error("Unexpected result for " + command + " " + args.join(" ") + "\n" + result.stdout + "\n" + result.stderr);
  }
  if (expectFailure) return result;
  try { return JSON.parse(result.stdout); } catch { return result.stdout; }
}
function assert(ok, message) { if (!ok) throw new Error(message); }

const sample = path.join(project, "sample.mjs");
const pkg = path.join(project, "package.json");
fs.writeFileSync(sample, 'console.log("working");\n');
fs.writeFileSync(pkg, JSON.stringify({
  name: "web-kit-quality-smoke", private: true,
  scripts: { test: "node sample.mjs", fail: "node -e \"process.exit(4)\"", "--version": "node -e \"process.exit(41)\"" },
}, null, 2));
call(process.execPath, [path.join(repo, "scripts", "agent-kit.mjs"), "install", project], false, repo);
const bin = path.join(project, ".agent-core", "bin", "work-progress.mjs");
assert(fs.existsSync(path.join(project, ".agent-core", "agents", "spec-writer.md")), "Spec Writer missing after install");
assert(fs.existsSync(path.join(project, ".agent-core", "agents", "spec-validator.md")), "Spec Validator missing after install");
assert(fs.existsSync(path.join(project, ".agent-core", "bin", "quality-pipeline.mjs")), "Quality runtime missing after install");
const run = (...args) => call(process.execPath, [bin, ...args, "--project", project]);
const fail = (...args) => call(process.execPath, [bin, ...args, "--project", project], true);
const readJob = (id) => JSON.parse(fs.readFileSync(path.join(project, ".agent-core", "state", "jobs", id + ".json"), "utf8"));

// SMALL stays fast and needs no formal spec.
run("start", "--task-id", "SMALL", "--classification", "SMALL", "--title", "Small fix");
run("update", "--task-id", "SMALL", "--status", "IMPLEMENTING", "--agent", "frontend-developer", "--files-changed", "1");
run("requirement-add", "--task-id", "SMALL", "--id", "REQ-001", "--description", "Update label", "--acceptance", "Label matches request");
run("requirement-verify", "--task-id", "SMALL", "--id", "REQ-001", "--result", "PASS", "--manual", "--evidence", "Manual UI screenshot confirmed");
run("update", "--task-id", "SMALL", "--final-validation", "PASS", "--status", "DONE", "--evidence", "Validated trivial request");
assert(readJob("SMALL").status === "DONE", "SMALL was unnecessarily blocked by a formal spec gate");

// A prior implementer must not become an independent reviewer merely because
// another agent authored the final fix. An unrelated reviewer is still allowed.
run("start", "--task-id", "MULTI-AUTHOR", "--classification", "SMALL");
run("update", "--task-id", "MULTI-AUTHOR", "--status", "IMPLEMENTING", "--agent", "developer-a");
run("update", "--task-id", "MULTI-AUTHOR", "--status", "FIXING", "--agent", "developer-b");
run("update", "--task-id", "MULTI-AUTHOR", "--status", "FIXING", "--agent", "developer-b");
assert(JSON.stringify(readJob("MULTI-AUTHOR").implementation.authors) === JSON.stringify(["developer-a", "developer-b"]),
  "Implementation history must retain all unique contributors");
run("update", "--task-id", "MULTI-AUTHOR", "--status", "REVIEWING", "--agent", "developer-a");
fail("quality-review", "--task-id", "MULTI-AUTHOR", "--reviewer", "developer-a",
  "--result", "PASS", "--evidence", "An earlier implementer cannot approve the feature");
assert(readJob("MULTI-AUTHOR").quality.code_review.status === "PENDING",
  "Rejected self-review unexpectedly wrote approval evidence");
run("update", "--task-id", "MULTI-AUTHOR", "--status", "REVIEWING", "--agent", "reviewer-c");
run("quality-review", "--task-id", "MULTI-AUTHOR", "--reviewer", "reviewer-c",
  "--result", "PASS", "--evidence", "Third agent independently reviewed the complete diff");
assert(readJob("MULTI-AUTHOR").quality.code_review.source === "reviewer-c",
  "Independent third reviewer was not recorded");
assert(!readJob("MULTI-AUTHOR").implementation.authors.includes("reviewer-c"),
  "Reviewer role was incorrectly recorded as an implementation contributor");

// Older saved jobs have last_author but no authors array. A later fix must
// migrate the original author rather than erasing their reviewer prohibition.
run("start", "--task-id", "LEGACY-AUTHOR", "--classification", "SMALL");
run("update", "--task-id", "LEGACY-AUTHOR", "--status", "IMPLEMENTING", "--agent", "original-author");
const legacyFile = path.join(project, ".agent-core", "state", "jobs", "LEGACY-AUTHOR.json");
const legacyJob = readJob("LEGACY-AUTHOR");
delete legacyJob.implementation.authors;
fs.writeFileSync(legacyFile, JSON.stringify(legacyJob, null, 2) + "\n");
run("update", "--task-id", "LEGACY-AUTHOR", "--status", "FIXING", "--agent", "later-fixer");
assert(JSON.stringify(readJob("LEGACY-AUTHOR").implementation.authors) === JSON.stringify(["original-author", "later-fixer"]),
  "Upgrading a legacy job lost the previous implementation author");
fail("quality-review", "--task-id", "LEGACY-AUTHOR", "--reviewer", "original-author",
  "--result", "PASS", "--evidence", "Legacy author must remain prohibited");

// Implementation cycles also record the active author when implementation is
// entered automatically, not just explicit IMPLEMENTING/FIXING updates.
run("start", "--task-id", "CYCLE-AUTHOR", "--classification", "SMALL");
run("update", "--task-id", "CYCLE-AUTHOR", "--status", "DISCOVERING", "--agent", "cycle-author");
run("cycle", "--task-id", "CYCLE-AUTHOR", "--kind", "implementation", "--evidence", "Observed implementation work");
assert(readJob("CYCLE-AUTHOR").implementation.authors.includes("cycle-author"),
  "Automatic implementation cycle failed to retain its actor");
run("update", "--task-id", "CYCLE-AUTHOR", "--status", "REVIEWING", "--agent", "reviewer-c");
fail("quality-review", "--task-id", "CYCLE-AUTHOR", "--reviewer", "cycle-author",
  "--result", "PASS", "--evidence", "Cycle author must not self-review");

// An npm option-like script name must run the configured script, not npm's CLI option.
run("start", "--task-id", "SCRIPT-OPTIONS", "--classification", "SMALL");
const optionScript = run("check-run", "--task-id", "SCRIPT-OPTIONS", "--script", "--version");
assert(optionScript.status === "FAIL" && optionScript.exit_code === 41, "npm --version printed npm's version instead of executing the failing script");

// Formal task rejects missing spec, self-validation, and unverified requirements.
run("start", "--task-id", "FORMAL", "--classification", "LARGE", "--title", "Complex feature");
run("update", "--task-id", "FORMAL", "--status", "PLANNING", "--agent", "spec-writer", "--plan-bullets", "2");
fail("plan-validate", "--task-id", "FORMAL", "--result", "APPROVED", "--validator", "plan-validator", "--evidence", "No spec");
const specFile = path.join(project, "feature-spec.md");
fs.writeFileSync(specFile, "# Feature spec\nREQ-101: Reliable behavior.\n");
run("spec-set", "--task-id", "FORMAL", "--file", "feature-spec.md");
run("requirement-add", "--task-id", "FORMAL", "--id", "REQ-101", "--description", "Reliable behavior", "--acceptance", "Executable test passes");
fail("spec-validate", "--task-id", "FORMAL", "--result", "APPROVED", "--validator", "spec-writer", "--evidence", "Self approval");
run("spec-validate", "--task-id", "FORMAL", "--result", "APPROVED", "--validator", "spec-validator", "--evidence", "Requirement is testable");
run("plan-validate", "--task-id", "FORMAL", "--result", "APPROVED", "--validator", "plan-validator", "--evidence", "Architecture approved");
// Regression: editing the spec file without spec-set, then reapproving it, must not reuse the old plan.
const priorPlanSpec = readJob("FORMAL").plan.validator.spec_digest;
fs.appendFileSync(specFile, "\nAcceptance conditions clarified after review.\n");
fail("update", "--task-id", "FORMAL", "--status", "IMPLEMENTING");
run("spec-validate", "--task-id", "FORMAL", "--result", "APPROVED", "--validator", "spec-validator", "--evidence", "Changed spec re-reviewed");
assert(readJob("FORMAL").plan.validator.status === "PENDING", "Direct spec edit/reapproval retained stale plan approval");
assert(readJob("FORMAL").quality.spec.validator.digest !== priorPlanSpec, "Spec digest failed to change");
fail("update", "--task-id", "FORMAL", "--status", "IMPLEMENTING");
run("plan-validate", "--task-id", "FORMAL", "--result", "APPROVED", "--validator", "plan-validator", "--evidence", "Updated spec separately approved by Plan Validator");
run("update", "--task-id", "FORMAL", "--status", "IMPLEMENTING", "--agent", "backend-developer", "--files-changed", "2");
fail("update", "--task-id", "FORMAL", "--status", "DONE", "--final-validation", "PASS", "--evidence", "No tests");
const passedCheck = run("check-run", "--task-id", "FORMAL", "--script", "test");
assert(passedCheck.status === "PASS" && passedCheck.exit_code === 0, "Actual npm test did not run successfully");
const failedCheck = run("check-run", "--task-id", "FORMAL", "--script", "fail");
assert(failedCheck.status === "FAIL" && failedCheck.exit_code === 4, "Nonzero npm exit status incorrectly passed");
fail("check-run", "--task-id", "FORMAL", "--script", "unlisted");
run("requirement-verify", "--task-id", "FORMAL", "--id", "REQ-101", "--result", "PASS", "--check-script", "test", "--evidence", "Real npm test executed");
const fidelityBeforeReview = run("report", "--task-id", "FORMAL");
assert(fidelityBeforeReview.requirements_fidelity.passed === true,
  "Passing requirements must not depend on the independent code-review gate");
assert(fidelityBeforeReview.requirements_fidelity.requirements_verified === 1,
  "Requirements evidence should show the verified criterion");
assert(fidelityBeforeReview.engineering_quality.gate === "BLOCKED"
  && fidelityBeforeReview.engineering_quality.independent_review === "PENDING",
  "Engineering quality should independently show an incomplete review");
fail("quality-review", "--task-id", "FORMAL", "--reviewer", "backend-developer", "--result", "PASS", "--evidence", "Self approval");
run("quality-review", "--task-id", "FORMAL", "--reviewer", "code-reviewer", "--result", "PASS", "--evidence", "Diff and behavior independently reviewed");
fail("update", "--task-id", "FORMAL", "--status", "DONE", "--final-validation", "PASS", "--evidence", "Failed check unresolved");
// Remove the failing script and make the current source fingerprint fresh; the original failed check remains recorded.
const oldCode = fs.readFileSync(sample, "utf8");
fs.writeFileSync(sample, 'console.log("changed source");\n');
fail("update", "--task-id", "FORMAL", "--status", "DONE", "--final-validation", "PASS", "--evidence", "Stale source checks");
const preFix = run("report", "--task-id", "FORMAL");
assert(preFix.engineering_quality.gate === "BLOCKED", "Changed source should make recorded quality evidence stale");
assert(preFix.requirements_fidelity.requirements_total === 1, "Requirements report missing original criterion");
fs.writeFileSync(sample, oldCode);
run("check-run", "--task-id", "FORMAL", "--script", "test");
run("requirement-verify", "--task-id", "FORMAL", "--id", "REQ-101", "--result", "PASS", "--check-script", "test", "--evidence", "Re-ran test after source change");
run("quality-review", "--task-id", "FORMAL", "--reviewer", "code-reviewer", "--result", "PASS", "--evidence", "Re-reviewed current diff");
let report = run("report", "--task-id", "FORMAL");
assert(report.engineering_quality.gate === "BLOCKED", "Failed executed checks must not be silently ignored");
run("update", "--task-id", "FORMAL", "--status", "PLANNING", "--plan-version", "2");
// A material plan/spec change invalidates prior plan approval.
fs.writeFileSync(specFile, "# Revised feature spec\nREQ-101: Reliable behavior with new constraints.\n");
fail("update", "--task-id", "FORMAL", "--status", "IMPLEMENTING");
run("spec-set", "--task-id", "FORMAL", "--file", "feature-spec.md");
assert(readJob("FORMAL").plan.validator.status === "PENDING", "Spec change failed to invalidate plan approval");
assert(readJob("FORMAL").quality.code_review.status === "PENDING", "Spec change reused an obsolete code review");
run("spec-validate", "--task-id", "FORMAL", "--result", "APPROVED", "--validator", "spec-validator", "--evidence", "Revised criterion reviewed");
run("plan-validate", "--task-id", "FORMAL", "--result", "APPROVED", "--validator", "plan-validator", "--evidence", "Reapproved changed plan");
run("update", "--task-id", "FORMAL", "--status", "IMPLEMENTING");
// Resolve the failed check and demonstrate a successful formal DONE with current evidence.
fs.writeFileSync(pkg, JSON.stringify({
  name: "web-kit-quality-smoke", private: true,
  scripts: { test: "node sample.mjs", fail: "node sample.mjs" },
}, null, 2));
// These inputs affect the application/deployment even though their extensions are nonstandard.
const sourceInputs = [
  ["app/page.mdx", "# UI v1"],
  ["schema.graphql", "type Query { value: String }"],
  ["api/service.proto", "syntax = \"proto3\";"],
  ["assets/logo.svg", "<svg></svg>"],
  ["Dockerfile", "FROM node:22"],
];
for (const [relative, content] of sourceInputs) {
  const file = path.join(project, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
assert(run("check-run", "--task-id", "FORMAL", "--script", "test").status === "PASS", "Test rerun should pass");
assert(run("check-run", "--task-id", "FORMAL", "--script", "fail").status === "PASS", "Repaired check should pass");
run("requirement-verify", "--task-id", "FORMAL", "--id", "REQ-101", "--result", "PASS", "--check-script", "test", "--evidence", "Tested current source and acceptance");
run("quality-review", "--task-id", "FORMAL", "--reviewer", "code-reviewer", "--result", "PASS", "--evidence", "Reviewed post-fix code and test results");
// Every MDX/schema/proto/SVG/Dockerfile edit must invalidate the passing check and reviewer snapshot.
for (const [relative, original] of sourceInputs) {
  const file = path.join(project, relative);
  fs.writeFileSync(file, original + "\nchanged");
  const stale = run("report", "--task-id", "FORMAL");
  assert(stale.engineering_quality.gate === "BLOCKED", relative + " edit failed to invalidate quality evidence");
  fs.writeFileSync(file, original);
  assert(run("report", "--task-id", "FORMAL").engineering_quality.gate === "PASS",
    relative + " restoration did not restore matching snapshot");
}
run("update", "--task-id", "FORMAL", "--final-validation", "PASS", "--status", "DONE", "--evidence", "Requirements and quality evidence approved");
assert(readJob("FORMAL").status === "DONE", "Current verified formal task should complete");
assert(run("report", "--task-id", "FORMAL").engineering_quality.gate === "PASS", "Passing formal report missing");

// Benchmark refuses incomplete/unmeasured tasks and different classifications.
fail("benchmark", "--task-id", "FORMAL", "--against", "SMALL");
// Fixture telemetry is explicitly supplied here to exercise the comparison; production must only report observed values.
for (const [id, elapsed] of [["BENCH-A", "1000"], ["BENCH-B", "1500"]]) {
  if (id === "BENCH-B") fs.appendFileSync(sample, "\nconsole.log('subsequent legitimate feature');\n");
  run("start", "--task-id", id, "--classification", "SMALL");
  run("requirement-add", "--task-id", id, "--id", "REQ-001", "--description", "Simple behavior", "--acceptance", "Manual proof");
  run("cycle", "--task-id", id, "--kind", "implementation", "--elapsed-ms", elapsed, "--evidence", "Fixture cycle timing");
  run("requirement-verify", "--task-id", id, "--id", "REQ-001", "--result", "PASS", "--manual", "--evidence", "Fixture acceptance verified");
  run("update", "--task-id", id, "--status", "DONE", "--final-validation", "PASS", "--evidence", "Fixture complete");
}
const benchmark = run("benchmark", "--task-id", "BENCH-A", "--against", "BENCH-B");
assert(benchmark.elapsed_difference_ms === -500, "Benchmark should compare observed elapsed milliseconds");
assert(readJob("BENCH-A").completion.source_digest !== readJob("BENCH-B").completion.source_digest,
  "Benchmark fixtures must represent different completion-time source states");
const historical = run("report", "--task-id", "BENCH-A");
assert(historical.engineering_quality.gate === "PASS", "Historical completion was wrongly downgraded");
assert(historical.engineering_quality.current_source_freshness === "STALE", "Report did not distinguish historical success from new source state");
// Policy audit must distinguish real provider telemetry from missing metrics.
const audit = run("audit", "--task-id", "FORMAL");
assert(audit.telemetry_available === false, "Unreported elapsed time should never be fabricated");
assert(Number.isInteger(audit.policy_conformance_percent), "Efficiency conformance percentage missing");

// A slow npm check must not discard the progress/next-action written while it was running.
fs.writeFileSync(path.join(project, "slow-check.mjs"),
  'import fs from "node:fs";\nfs.writeFileSync("slow-started.txt", "ready");\nawait new Promise(resolve => setTimeout(resolve, 1700));\n');
const racePkg = JSON.parse(fs.readFileSync(pkg, "utf8"));
racePkg.scripts.slow = "node slow-check.mjs";
fs.writeFileSync(pkg, JSON.stringify(racePkg, null, 2));
run("start", "--task-id", "RACE", "--classification", "SMALL");
const runner = spawn(process.execPath, [bin, "check-run", "--task-id", "RACE", "--script", "slow", "--project", project], {
  cwd: project, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
});
let runnerStdout = "";
let runnerStderr = "";
runner.stdout.on("data", chunk => { runnerStdout += chunk.toString(); });
runner.stderr.on("data", chunk => { runnerStderr += chunk.toString(); });
for (let tries = 0; tries < 160 && !fs.existsSync(path.join(project, "slow-started.txt")); tries += 1) {
  await new Promise(resolve => setTimeout(resolve, 50));
}
assert(fs.existsSync(path.join(project, "slow-started.txt")), "Timed out waiting for background npm check");
run("cycle", "--task-id", "RACE", "--kind", "implementation", "--evidence", "Separate process advanced implementation", "--elapsed-ms", "275");
run("update", "--task-id", "RACE", "--status", "IMPLEMENTING", "--next", "Preserve newer task action",
  "--implementation-total", "2", "--implementation-completed", "1", "--evidence", "Concurrent state updated");
const runnerExit = await new Promise(resolve => runner.once("close", resolve));
assert(runnerExit === 0, "Long-running check failed: " + runnerStderr + runnerStdout);
const raced = readJob("RACE");
assert(raced.next_action === "Preserve newer task action", "Long check overwrote a newer next action");
assert(raced.metrics.implementation_cycles === 1 && raced.metrics.reported_elapsed_ms === 275,
  "Long check discarded concurrent telemetry and implementation cycle");
assert(raced.quality.checks.some(c => c.script === "slow" && c.status === "PASS"),
  "Long check failed to persist its own result after merging newer state");
assert(raced.implementation.completed === 1, "Long check lost a concurrent progress update");

// Exercise the Git-aware fingerprint path separately from the standalone-project fallback.
if (spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0) {
  const gitProject = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-source-git-"));
  const gitInit = spawnSync("git", ["init", "-q"], { cwd: gitProject, encoding: "utf8" });
  assert(gitInit.status === 0, "Could not create disposable Git test repository");
  const { sourceDigest } = await import(pathToFileURL(path.join(project, ".agent-core", "bin", "quality-pipeline.mjs")).href);
  fs.writeFileSync(path.join(gitProject, "package.json"), '{"name":"digest-smoke"}');
  const original = sourceDigest(gitProject);
  fs.mkdirSync(path.join(gitProject, "app"), { recursive: true });
  fs.writeFileSync(path.join(gitProject, "app", "page.mdx"), "# Runtime MDX");
  assert(sourceDigest(gitProject) !== original, "Git-aware listing missed untracked MDX");
  const gitAdd = spawnSync("git", ["add", "."], { cwd: gitProject, encoding: "utf8" });
  assert(gitAdd.status === 0, "Could not stage disposable MDX fixture");
  const staged = sourceDigest(gitProject);
  fs.appendFileSync(path.join(gitProject, "app", "page.mdx"), "\nchanged after staging");
  assert(sourceDigest(gitProject) !== staged, "Git-aware listing ignored dirty tracked MDX");
  const afterEdit = sourceDigest(gitProject);
  fs.writeFileSync(path.join(gitProject, "Dockerfile"), "FROM node:22");
  assert(sourceDigest(gitProject) !== afterEdit, "Git-aware listing missed untracked Dockerfile");
}

// A planning cycle is already represented by planning_cycles AND prose_only_cycles.
run("start", "--task-id", "META-COUNT", "--classification", "SMALL");
run("update", "--task-id", "META-COUNT", "--status", "IMPLEMENTING");
run("cycle", "--task-id", "META-COUNT", "--kind", "planning");
for (let i = 0; i < 3; i += 1) {
  run("cycle", "--task-id", "META-COUNT", "--kind", "implementation", "--evidence", "Real work step " + i);
}
const metaReport = run("report", "--task-id", "META-COUNT");
assert(readJob("META-COUNT").metrics.prose_only_cycles === 1, "Expected overlap fixture was not recorded");
assert(metaReport.execution_efficiency.meta_work_percent === 25,
  "One meta cycle and three implementation cycles must equal 25%, not 50%");
assert(metaReport.execution_efficiency.policy_checks.find(x => x.name === "proportional_meta_work").pass === true,
  "A 25% meta-work ratio must pass the SMALL task threshold");
run("start", "--task-id", "META-MIX", "--classification", "SMALL");
run("update", "--task-id", "META-MIX", "--status", "IMPLEMENTING");
for (const kind of ["planning", "implementation", "routing", "implementation", "prose", "implementation"]) {
  run("cycle", "--task-id", "META-MIX", "--kind", kind, "--evidence", kind === "implementation" ? "Changed code" : "");
}
const mixedReport = run("report", "--task-id", "META-MIX");
assert(mixedReport.execution_efficiency.meta_work_percent === 50
  && mixedReport.execution_efficiency.cycle_breakdown.meta_work === 3,
  "Mixed planning/routing/prose must count three distinct meta cycles");

// Recover only an owner that is demonstrably dead; never delete an active lock.
function lockPath(id) { return path.join(project, ".agent-core", "state", "jobs", id + ".json.lock"); }
function seedLock(id, pid) {
  const dir = lockPath(id);
  const token = randomUUID();
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "owner.json"),
    JSON.stringify({ pid, host: os.hostname(), token, created_at: new Date().toISOString() }));
  return { dir, token };
}
run("start", "--task-id", "RECOVER", "--classification", "SMALL");
const exited = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"],
  { encoding: "utf8", windowsHide: true });
assert(exited.status === 0, "Could not create exited lock-owner fixture");
const abandoned = seedLock("RECOVER", Number(exited.stdout.trim()));
run("cycle", "--task-id", "RECOVER", "--kind", "implementation", "--evidence", "Recovered abandoned lock");
assert(readJob("RECOVER").metrics.implementation_cycles === 1, "Orphaned lock did not recover task progress");
assert(!fs.existsSync(abandoned.dir), "Recovered lock directory was not released");
assert(fs.existsSync(abandoned.dir + ".abandoned." + abandoned.token),
  "Recovery should preserve a deterministic tombstone against competing reapers");

run("start", "--task-id", "LIVE-LOCK", "--classification", "SMALL");
const live = seedLock("LIVE-LOCK", process.pid);
const liveOwner = fs.readFileSync(path.join(live.dir, "owner.json"), "utf8");
fail("cycle", "--task-id", "LIVE-LOCK", "--kind", "implementation", "--evidence", "Must not steal live lock");
assert(fs.readFileSync(path.join(live.dir, "owner.json"), "utf8") === liveOwner,
  "Active owner lock was removed or replaced");
assert(!fs.existsSync(live.dir + ".abandoned." + live.token),
  "Active lock must never be classified as abandoned");
fs.unlinkSync(path.join(live.dir, "owner.json"));
fs.rmdirSync(live.dir);
run("cycle", "--task-id", "LIVE-LOCK", "--kind", "implementation", "--evidence", "Live owner released lock");

// Release is atomic: even if cleanup crashes after rename, the primary path
// is available and a later writer must not interact with the old release copy.
run("start", "--task-id", "ATOMIC-RELEASE", "--classification", "SMALL");
assert(!fs.existsSync(lockPath("ATOMIC-RELEASE")), "Completed write left an active lock");
const abandonedReleaseToken = randomUUID();
const orphanedRelease = lockPath("ATOMIC-RELEASE") + ".released." + abandonedReleaseToken;
fs.mkdirSync(orphanedRelease);
fs.writeFileSync(path.join(orphanedRelease, "owner.json"),
  JSON.stringify({pid: process.pid, host: os.hostname(), token: abandonedReleaseToken}));
run("cycle", "--task-id", "ATOMIC-RELEASE", "--kind", "implementation", "--evidence", "Operation after interrupted cleanup");
assert(readJob("ATOMIC-RELEASE").metrics.implementation_cycles === 1,
  "Abandoned post-release cleanup artifact blocked the next writer");
assert(fs.existsSync(orphanedRelease) && !fs.existsSync(lockPath("ATOMIC-RELEASE")),
  "New writer altered previous release artifact or left its primary lock");
fs.rmSync(orphanedRelease, { recursive: true, force: true });

console.log("Evidence-backed quality pipeline smoke: PASS");
