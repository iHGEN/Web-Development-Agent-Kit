#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, ...options });
  if (result.error || result.status !== 0) {
    console.error(result.stdout || "");
    console.error(result.stderr || "");
    throw result.error || new Error(`${command} exited ${result.status}`);
  }
  return result;
}
function runFail(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, ...options });
  if (!result.error && result.status === 0) throw new Error(`Expected failure: ${command} ${args.join(" ")}`);
  return result;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const project = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-work-progress-"));
fs.writeFileSync(path.join(project, "package.json"), `${JSON.stringify({ name: "work-progress-smoke" }, null, 2)}\n`);
run(process.execPath, [path.join(repo, "scripts", "agent-kit.mjs"), "install", project], { cwd: repo });

const progressBin = path.join(project, ".agent-core", "bin", "work-progress.mjs");
assert(fs.existsSync(progressBin), "work-progress runtime was not installed");
assert(fs.existsSync(path.join(project, ".agent-core", "rules", "implementation-first.md")), "implementation-first rule was not installed");

const cmd = (...args) => run(process.execPath, [progressBin, ...args, "--project", project], { cwd: project });
const failCmd = (...args) => runFail(process.execPath, [progressBin, ...args, "--project", project], { cwd: project });
const jobFile = (id) => path.join(project, ".agent-core", "state", "jobs", `${id}.json`);

// Task IDs are strict so different user values cannot silently collide on one state file.
failCmd("start", "--task-id", "feature/auth", "--classification", "SMALL");

// SMALL: no planning gate, implementation carries most progress.
cmd("start", "--task-id", "TASK-SMALL", "--classification", "SMALL", "--title", "Small implementation");
let small = readJson(jobFile("TASK-SMALL"));
assert(small.governance.plan_required === false, "SMALL unexpectedly requires planning");
assert(small.governance.plan_validator_required === false, "SMALL unexpectedly requires Plan Validator");
failCmd("update", "--task-id", "TASK-SMALL", "--status", "PLANNING");

cmd(
  "update", "--task-id", "TASK-SMALL", "--status", "IMPLEMENTING", "--agent", "backend-developer",
  "--implementation-total", "4", "--implementation-completed", "2", "--files-changed", "3",
  "--next", "finish remaining implementation", "--evidence", "3 files changed with half of implementation complete"
);
cmd("cycle", "--task-id", "TASK-SMALL", "--kind", "implementation", "--evidence", "repository diff exists");
small = readJson(jobFile("TASK-SMALL"));
assert(small.progress >= 35 && small.progress < 70, `SMALL implementation progress is not evidence-weighted: ${small.progress}`);
assert(small.metrics.implementation_cycles === 1, "implementation cycle was not counted");

cmd("cycle", "--task-id", "TASK-SMALL", "--kind", "planning");
cmd("cycle", "--task-id", "TASK-SMALL", "--kind", "routing");
small = readJson(jobFile("TASK-SMALL"));
assert(small.anti_slop.violation === true, "anti-slop guard did not trigger");
assert(small.anti_slop.forced_next_phase === "IMPLEMENTING", "anti-slop guard did not force IMPLEMENTING");
assert(small.metrics.prose_only_cycles === 2, "meta-only cycles were not counted");

cmd("cycle", "--task-id", "TASK-SMALL", "--kind", "testing", "--evidence", "4/4 targeted tests pass");
cmd(
  "update", "--task-id", "TASK-SMALL", "--status", "TESTING",
  "--implementation-total", "4", "--implementation-completed", "4", "--files-changed", "5",
  "--tests-added", "2", "--tests-total", "4", "--tests-passing", "4", "--build", "PASS",
  "--evidence", "implementation complete and targeted suite passes"
);
cmd("cycle", "--task-id", "TASK-SMALL", "--kind", "review", "--evidence", "diff review passed");
cmd("update", "--task-id", "TASK-SMALL", "--status", "REVIEWING", "--review", "PASS", "--evidence", "review passed");
cmd("cycle", "--task-id", "TASK-SMALL", "--kind", "validation", "--evidence", "final behavior verified");
cmd("update", "--task-id", "TASK-SMALL", "--status", "DONE", "--final-validation", "PASS", "--evidence", "final validation passed and original request satisfied");
small = readJson(jobFile("TASK-SMALL"));
assert(small.status === "DONE" && small.progress === 100, "SMALL job did not reach evidence-backed DONE");

// DONE is durable: later validation/review mutation cannot leave DONE at 100 with failed validation.
failCmd("update", "--task-id", "TASK-SMALL", "--final-validation", "FAIL");
failCmd("update", "--task-id", "TASK-SMALL", "--review", "FAIL");
failCmd("cycle", "--task-id", "TASK-SMALL", "--kind", "validation", "--evidence", "must reopen first");
small = readJson(jobFile("TASK-SMALL"));
assert(small.status === "DONE", "failed terminal mutation changed DONE status");
assert(small.final_validation.status === "PASS", "failed terminal mutation changed final validation");
assert(small.progress === 100, "failed terminal mutation changed completed progress");

// Automatic implementation evidence must move a fresh SMALL job into IMPLEMENTING.
cmd("start", "--task-id", "TASK-AUTO", "--classification", "SMALL", "--title", "Automatic phase transition");
let auto = readJson(jobFile("TASK-AUTO"));
assert(auto.status === "QUEUED", "fresh automatic job should start QUEUED");
cmd("cycle", "--task-id", "TASK-AUTO", "--kind", "implementation", "--evidence", "automatic repository delta detected");
auto = readJson(jobFile("TASK-AUTO"));
assert(auto.status === "IMPLEMENTING" && auto.current_phase === "IMPLEMENTING", "implementation cycle did not move fresh SMALL job into IMPLEMENTING");

// Discovery evidence also advances a fresh job without requiring a separate manual status update.
cmd("start", "--task-id", "TASK-DISCOVERY", "--classification", "SMALL", "--title", "Automatic discovery transition");
cmd("cycle", "--task-id", "TASK-DISCOVERY", "--kind", "discovery", "--evidence", "target implementation owner found");
let discovery = readJson(jobFile("TASK-DISCOVERY"));
assert(discovery.status === "DISCOVERING", "discovery cycle did not move fresh job into DISCOVERING");

// MEDIUM: exactly 3-6 bullets; direct approval is allowed only after the minimum is met.
cmd("start", "--task-id", "TASK-MEDIUM", "--classification", "MEDIUM", "--title", "Medium implementation");
let medium = readJson(jobFile("TASK-MEDIUM"));
assert(medium.governance.min_plan_bullets === 3, "MEDIUM minimum plan bullets should be three");
assert(medium.governance.max_plan_bullets === 6, "MEDIUM maximum plan bullets should be six");
cmd("update", "--task-id", "TASK-MEDIUM", "--status", "PLANNING", "--plan-bullets", "2", "--evidence", "drafting short plan");
failCmd("update", "--task-id", "TASK-MEDIUM", "--plan-status", "APPROVED");
failCmd("update", "--task-id", "TASK-MEDIUM", "--status", "IMPLEMENTING");
cmd("update", "--task-id", "TASK-MEDIUM", "--plan-bullets", "3", "--plan-status", "APPROVED", "--evidence", "minimum executable short plan ready");
failCmd("update", "--task-id", "TASK-MEDIUM", "--plan-bullets", "7");
cmd("update", "--task-id", "TASK-MEDIUM", "--status", "IMPLEMENTING", "--evidence", "short plan approved; implementation begins");
medium = readJson(jobFile("TASK-MEDIUM"));
assert(medium.status === "IMPLEMENTING", "approved MEDIUM plan did not permit implementation");

// LARGE: direct self-approval is rejected; independent validator provenance is required for the current plan version.
cmd("start", "--task-id", "TASK-LARGE", "--classification", "LARGE", "--title", "Large implementation");
let large = readJson(jobFile("TASK-LARGE"));
assert(large.governance.plan_validator_required === true, "LARGE should require Plan Validator");
cmd("update", "--task-id", "TASK-LARGE", "--status", "PLANNING", "--plan-bullets", "2", "--plan-version", "1", "--evidence", "formal plan drafted");
failCmd("update", "--task-id", "TASK-LARGE", "--plan-status", "APPROVED");
failCmd("update", "--task-id", "TASK-LARGE", "--status", "IMPLEMENTING");
failCmd("plan-validate", "--task-id", "TASK-LARGE", "--result", "APPROVED", "--validator", "plan-validator");
cmd("plan-validate", "--task-id", "TASK-LARGE", "--result", "APPROVED", "--validator", "plan-validator", "--evidence", "all required formal plan steps independently approved");
large = readJson(jobFile("TASK-LARGE"));
assert(large.plan.status === "APPROVED", "independent validator did not approve plan");
assert(large.plan.validator.status === "APPROVED", "validator status missing");
assert(large.plan.validator.source === "plan-validator", "validator provenance missing");
assert(large.plan.validator.plan_version === 1, "validator approval is not tied to current plan version");
cmd("update", "--task-id", "TASK-LARGE", "--status", "IMPLEMENTING", "--evidence", "independent plan gate passed");
large = readJson(jobFile("TASK-LARGE"));
assert(large.status === "IMPLEMENTING", "independently approved LARGE plan did not permit implementation");

// Changing a formal plan after approval invalidates validator approval for the new version/content.
cmd("update", "--task-id", "TASK-LARGE", "--reopen", "--status", "PLANNING", "--plan-version", "2", "--evidence", "material plan delta");
large = readJson(jobFile("TASK-LARGE"));
assert(large.plan.status === "PENDING" && large.plan.validator.status === "PENDING", "plan delta did not invalidate independent approval");
failCmd("update", "--task-id", "TASK-LARGE", "--status", "IMPLEMENTING");

// SMALL/high-risk also requires formal independent approval despite SMALL classification.
cmd("start", "--task-id", "TASK-RISK", "--classification", "SMALL", "--high-risk", "--title", "Small but high risk");
let risk = readJson(jobFile("TASK-RISK"));
assert(risk.governance.plan_mode === "formal", "high-risk SMALL task should escalate governance");
cmd("update", "--task-id", "TASK-RISK", "--status", "PLANNING", "--plan-bullets", "1", "--evidence", "minimal formal high-risk plan");
failCmd("update", "--task-id", "TASK-RISK", "--plan-status", "APPROVED");
cmd("plan-validate", "--task-id", "TASK-RISK", "--result", "APPROVED", "--validator", "independent-plan-validator", "--evidence", "high-risk plan independently approved");
cmd("update", "--task-id", "TASK-RISK", "--status", "IMPLEMENTING", "--evidence", "high-risk validator gate passed");
risk = readJson(jobFile("TASK-RISK"));
assert(risk.status === "IMPLEMENTING", "high-risk independent approval did not permit implementation");

// Whole-project/application status stays separate and requires evidence.
cmd("project-update", "--area", "backend", "--progress", "80", "--status", "ACTIVE", "--evidence", "TASK-SMALL done; targeted tests pass");
cmd("project-update", "--area", "frontend", "--progress", "40", "--status", "ACTIVE", "--weight", "1", "--evidence", "two of five screens complete");
const projectStatus = readJson(path.join(project, ".agent-core", "state", "project-status.json"));
assert(projectStatus.overall_progress === 60, `unexpected project overall progress ${projectStatus.overall_progress}`);
failCmd("project-update", "--area", "database", "--progress", "100");

const status = JSON.parse(cmd("show").stdout);
assert(Array.isArray(status.jobs) && status.jobs.length === 6, "status output should summarize tracked jobs");
assert(status.jobs.some((item) => item.task_id === "TASK-SMALL" && item.progress === 100), "status output is missing completed SMALL job");
assert(status.jobs.some((item) => item.task_id === "TASK-RISK" && item.plan.validator_source === "independent-plan-validator"), "status output is missing validator provenance");

const efficiency = readJson(path.join(project, ".agent-core", "state", "metrics", "workflow-efficiency.json"));
assert(efficiency.jobs === 6, `expected six tracked jobs, got ${efficiency.jobs}`);

console.log("Implementation-first work progress smoke: PASS");
