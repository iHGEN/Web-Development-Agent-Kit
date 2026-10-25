#!/usr/bin/env node
// Runs against an installed Web Kit, not just source-tree imports.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
  run("start", "--task-id", id, "--classification", "SMALL");
  run("requirement-add", "--task-id", id, "--id", "REQ-001", "--description", "Simple behavior", "--acceptance", "Manual proof");
  run("cycle", "--task-id", id, "--kind", "implementation", "--elapsed-ms", elapsed, "--evidence", "Fixture cycle timing");
  run("requirement-verify", "--task-id", id, "--id", "REQ-001", "--result", "PASS", "--manual", "--evidence", "Fixture acceptance verified");
  run("update", "--task-id", id, "--status", "DONE", "--final-validation", "PASS", "--evidence", "Fixture complete");
}
const benchmark = run("benchmark", "--task-id", "BENCH-A", "--against", "BENCH-B");
assert(benchmark.elapsed_difference_ms === -500, "Benchmark should compare observed elapsed milliseconds");
// Policy audit must distinguish real provider telemetry from missing metrics.
const audit = run("audit", "--task-id", "FORMAL");
assert(audit.telemetry_available === false, "Unreported elapsed time should never be fabricated");
assert(Number.isInteger(audit.policy_conformance_percent), "Efficiency conformance percentage missing");

console.log("Evidence-backed quality pipeline smoke: PASS");
