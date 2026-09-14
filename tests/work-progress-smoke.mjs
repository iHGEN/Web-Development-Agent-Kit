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

// Two post-discovery meta-only cycles force implementation for a plan-free task.
cmd("cycle", "--task-id", "TASK-SMALL", "--kind", "planning");
cmd("cycle", "--task-id", "TASK-SMALL", "--kind", "routing");
small = readJson(jobFile("TASK-SMALL"));
assert(small.anti_slop.violation === true, "anti-slop guard did not trigger");
assert(small.anti_slop.forced_next_phase === "IMPLEMENTING", "anti-slop guard did not force IMPLEMENTING");
assert(small.metrics.prose_only_cycles === 2, "meta-only cycles were not counted");
assert(/Stop meta-work/.test(small.next_action), "anti-slop next action is missing");

// Concrete work clears the anti-slop violation.
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
assert(small.anti_slop.violation === false, "concrete work did not clear anti-slop state");

// MEDIUM: short plan, capped at six bullets, no mandatory Plan Validator, but implementation waits for plan approval.
cmd("start", "--task-id", "TASK-MEDIUM", "--classification", "MEDIUM", "--title", "Medium implementation");
let medium = readJson(jobFile("TASK-MEDIUM"));
assert(medium.governance.plan_required === true, "MEDIUM should have a short plan");
assert(medium.governance.plan_mode === "short", "MEDIUM plan mode should be short");
assert(medium.governance.max_plan_bullets === 6, "MEDIUM plan must be capped at six bullets");
assert(medium.governance.plan_validator_required === false, "MEDIUM should not require Plan Validator by default");
failCmd("update", "--task-id", "TASK-MEDIUM", "--status", "IMPLEMENTING");
cmd("update", "--task-id", "TASK-MEDIUM", "--status", "PLANNING", "--plan-bullets", "6", "--plan-status", "APPROVED", "--evidence", "six executable bullets");
failCmd("update", "--task-id", "TASK-MEDIUM", "--plan-bullets", "7");
cmd("update", "--task-id", "TASK-MEDIUM", "--status", "IMPLEMENTING", "--evidence", "short plan approved; implementation begins");
medium = readJson(jobFile("TASK-MEDIUM"));
assert(medium.status === "IMPLEMENTING", "approved MEDIUM plan did not permit implementation");

// LARGE/high-risk keeps formal governance and cannot bypass its plan gate.
cmd("start", "--task-id", "TASK-LARGE", "--classification", "LARGE", "--title", "Large implementation");
let large = readJson(jobFile("TASK-LARGE"));
assert(large.governance.plan_mode === "formal", "LARGE should use formal planning");
assert(large.governance.plan_validator_required === true, "LARGE should require Plan Validator");
failCmd("update", "--task-id", "TASK-LARGE", "--status", "IMPLEMENTING");
cmd("cycle", "--task-id", "TASK-LARGE", "--kind", "planning");
cmd("cycle", "--task-id", "TASK-LARGE", "--kind", "routing");
large = readJson(jobFile("TASK-LARGE"));
assert(large.anti_slop.violation === true, "formal planning loop was not detected");
assert(large.status === "PLANNING", "formal planning anti-slop guard bypassed plan approval");
assert(large.anti_slop.forced_next_phase === "PLANNING_APPROVAL_THEN_IMPLEMENTING", "formal planning guard did not preserve approval gate");

cmd("start", "--task-id", "TASK-RISK", "--classification", "SMALL", "--high-risk", "--title", "Small but high risk");
const risk = readJson(jobFile("TASK-RISK"));
assert(risk.governance.plan_mode === "formal", "high-risk SMALL task should escalate governance");
assert(risk.governance.plan_validator_required === true, "high-risk SMALL task should require Plan Validator");
failCmd("update", "--task-id", "TASK-RISK", "--status", "IMPLEMENTING");

// Whole-project/application status stays separate and requires evidence.
cmd("project-update", "--area", "backend", "--progress", "80", "--status", "ACTIVE", "--evidence", "TASK-SMALL done; targeted tests pass");
cmd("project-update", "--area", "frontend", "--progress", "40", "--status", "ACTIVE", "--weight", "1", "--evidence", "two of five screens complete");
const projectStatus = readJson(path.join(project, ".agent-core", "state", "project-status.json"));
assert(projectStatus.areas.backend.progress === 80, "backend project status missing");
assert(projectStatus.areas.frontend.progress === 40, "frontend project status missing");
assert(projectStatus.overall_progress === 60, `unexpected project overall progress ${projectStatus.overall_progress}`);
failCmd("project-update", "--area", "database", "--progress", "100");

const efficiency = readJson(path.join(project, ".agent-core", "state", "metrics", "workflow-efficiency.json"));
assert(efficiency.jobs === 4, `expected four tracked jobs, got ${efficiency.jobs}`);
assert(efficiency.totals.ai_cycles >= 7, "workflow efficiency metrics were not aggregated");

const workflow = fs.readFileSync(path.join(project, ".agent-core", "rules", "workflow.md"), "utf8");
assert(workflow.includes("two consecutive cycles"), "canonical workflow is missing anti-slop guard");
assert(workflow.includes("3-6 execution bullets"), "canonical workflow is missing MEDIUM plan cap");
assert(workflow.includes("run security-review"), "canonical workflow is missing Security Review integration");

console.log("Implementation-first work progress smoke: PASS");
