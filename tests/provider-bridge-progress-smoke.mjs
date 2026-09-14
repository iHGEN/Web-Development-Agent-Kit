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
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function assert(value, message) { if (!value) throw new Error(message); }

const project = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-bridge-progress-"));
fs.mkdirSync(path.join(project, "src"), { recursive: true });
fs.writeFileSync(path.join(project, "package.json"), `${JSON.stringify({ name: "provider-bridge-progress-smoke" }, null, 2)}\n`);
fs.writeFileSync(path.join(project, "src", "index.js"), "export const value = 1;\n");

run("git", ["init", "-b", "main"], { cwd: project });
run("git", ["config", "user.email", "web-kit-smoke@example.invalid"], { cwd: project });
run("git", ["config", "user.name", "Web Kit Smoke"], { cwd: project });
run(process.execPath, [path.join(repo, "scripts", "agent-kit.mjs"), "install", project], { cwd: repo });
run("git", ["add", "."], { cwd: project });
run("git", ["commit", "-m", "baseline"], { cwd: project });

const progress = path.join(project, ".agent-core", "bin", "work-progress.mjs");
const bridge = path.join(project, ".agent-core", "bin", "provider-bridge.mjs");
const jobsDir = path.join(project, ".agent-core", "state", "jobs");
const jobFile = path.join(jobsDir, "TASK-BRIDGE.json");
const otherJobFile = path.join(jobsDir, "TASK-OTHER.json");
const claudeJobFile = path.join(jobsDir, "TASK-CLAUDE.json");
const planJobFile = path.join(jobsDir, "TASK-PLAN.json");
const gateJobFile = path.join(jobsDir, "TASK-GATE.json");
assert(fs.existsSync(progress), "work-progress runtime missing");
assert(fs.existsSync(bridge), "provider bridge missing");

run(process.execPath, [
  progress, "start", "--task-id", "TASK-BRIDGE", "--classification", "SMALL",
  "--title", "Automatic bridge progress", "--project", project,
], { cwd: project });
run(process.execPath, [
  progress, "update", "--task-id", "TASK-BRIDGE", "--status", "IMPLEMENTING",
  "--agent", "backend-developer", "--implementation-total", "4", "--implementation-completed", "0",
  "--next", "implement the requested change", "--project", project,
], { cwd: project });

const codexEnv = {
  ...process.env,
  WEB_KIT_PROJECT_ROOT: project,
  WEB_KIT_SUPERVISOR_ID: "bridge-progress-smoke",
  CODEX_HOME: path.join(project, ".codex-empty"),
};
function notify(message, env = codexEnv, threadId = "bridge-smoke-thread") {
  const event = {
    "thread-id": threadId,
    "input-messages": ["implement the task"],
    "last-assistant-message": message,
  };
  run(process.execPath, [bridge, "codex-notify", JSON.stringify(event)], { cwd: project, env });
}

notify("I inspected the target and am starting implementation.");
let job = readJson(jobFile);
assert(job.metrics.ai_cycles === 0, `baseline callback should not count as a cycle, got ${job.metrics.ai_cycles}`);

run(process.execPath, [
  progress, "start", "--task-id", "TASK-OTHER", "--classification", "SMALL",
  "--title", "Concurrent other task", "--project", project,
], { cwd: project });
run(process.execPath, [
  progress, "update", "--task-id", "TASK-OTHER", "--status", "IMPLEMENTING",
  "--agent", "frontend-developer", "--next", "unrelated concurrent work", "--project", project,
], { cwd: project });

fs.writeFileSync(path.join(project, "src", "index.js"), "export const value = 2;\n");
notify("Implemented the tracked source change.");
job = readJson(jobFile);
let other = readJson(otherJobFile);
assert(job.metrics.ai_cycles === 1, `expected one automatic cycle, got ${job.metrics.ai_cycles}`);
assert(job.metrics.implementation_cycles === 1, "tracked repository delta was not classified as implementation");
assert(other.metrics.ai_cycles === 0, "provider bridge drifted to a newer unrelated active job");

fs.writeFileSync(path.join(project, "src", "new.js"), "export const newValue = 1;\n");
notify("Added a new untracked implementation file.");
job = readJson(jobFile);
assert(job.metrics.implementation_cycles === 2, "new untracked file was not classified as implementation");

fs.writeFileSync(path.join(project, "src", "new.js"), "export const newValue = 2;\n");
notify("Updated the existing untracked implementation file.");
job = readJson(jobFile);
assert(job.metrics.implementation_cycles === 3, "content change inside an already-untracked file was not detected");

notify("I am thinking about the next step.");
notify("I will think about the plan again.");
job = readJson(jobFile);
assert(job.metrics.prose_only_cycles === 2, "stalled implementation turns were not counted");
assert(job.anti_slop.violation === true, "anti-slop did not trigger after two stalled turns");

const cyclesBeforeDuplicate = job.metrics.ai_cycles;
notify("I will think about the plan again.");
job = readJson(jobFile);
assert(job.metrics.ai_cycles === cyclesBeforeDuplicate, "duplicate provider callback was double-counted");

run(process.execPath, [
  progress, "update", "--task-id", "TASK-BRIDGE", "--status", "IMPLEMENTING",
  "--next", "implement now", "--evidence", "state-only update", "--project", project,
], { cwd: project });
notify("State was updated but application code was not changed.");
job = readJson(jobFile);
assert(job.metrics.implementation_cycles === 3, "Web-Kit state files were misclassified as repository implementation");
other = readJson(otherJobFile);
assert(other.metrics.ai_cycles === 0, "unrelated active job received cycles from the pinned provider session");

// Claude status-line bridge follows the same automatic implementation/prose behavior.
run(process.execPath, [
  progress, "start", "--task-id", "TASK-CLAUDE", "--classification", "SMALL",
  "--title", "Claude automatic bridge progress", "--project", project,
], { cwd: project });
run(process.execPath, [
  progress, "update", "--task-id", "TASK-CLAUDE", "--status", "IMPLEMENTING",
  "--agent", "backend-developer", "--implementation-total", "2", "--implementation-completed", "0",
  "--next", "implement Claude-routed change", "--project", project,
], { cwd: project });

const claudeEnv = {
  ...process.env,
  WEB_KIT_PROJECT_ROOT: project,
  WEB_KIT_SUPERVISOR_ID: "claude-bridge-progress-smoke",
};
function claudeStatus(inputTokens, outputTokens, usedPercentage) {
  const payload = {
    session_id: "claude-bridge-session",
    model: { id: "claude-smoke" },
    context_window: {
      used_percentage: usedPercentage,
      context_window_size: 200000,
      total_input_tokens: inputTokens,
      total_output_tokens: outputTokens,
    },
  };
  run(process.execPath, [bridge, "claude-statusline"], { cwd: project, env: claudeEnv, input: JSON.stringify(payload) });
}

claudeStatus(1000, 100, 5);
let claudeJob = readJson(claudeJobFile);
assert(claudeJob.metrics.ai_cycles === 0, "Claude baseline callback should not count as a cycle");
fs.writeFileSync(path.join(project, "src", "claude.js"), "export const claudeValue = 1;\n");
claudeStatus(2000, 200, 10);
claudeJob = readJson(claudeJobFile);
assert(claudeJob.metrics.implementation_cycles === 1, "Claude repository delta was not classified as implementation");
const claudeCyclesBeforeDuplicate = claudeJob.metrics.ai_cycles;
claudeStatus(2000, 200, 10);
claudeJob = readJson(claudeJobFile);
assert(claudeJob.metrics.ai_cycles === claudeCyclesBeforeDuplicate, "duplicate Claude status callback was double-counted");
claudeStatus(3000, 300, 15);
claudeStatus(4000, 400, 20);
claudeJob = readJson(claudeJobFile);
assert(claudeJob.metrics.prose_only_cycles === 2, "Claude stalled turns did not feed the anti-slop guard");

// Plan-file churn remains planning and never earns implementation credit.
run(process.execPath, [
  progress, "start", "--task-id", "TASK-PLAN", "--classification", "MEDIUM",
  "--title", "Planning churn classification", "--project", project,
], { cwd: project });
run(process.execPath, [
  progress, "update", "--task-id", "TASK-PLAN", "--status", "PLANNING",
  "--agent", "web-orchestrator", "--plan-bullets", "3", "--next", "finish the short plan",
  "--project", project,
], { cwd: project });
const planEnv = {
  ...process.env,
  WEB_KIT_PROJECT_ROOT: project,
  WEB_KIT_SUPERVISOR_ID: "planning-bridge-progress-smoke",
  CODEX_HOME: path.join(project, ".codex-empty"),
};
notify("Starting the short plan.", planEnv, "planning-smoke-thread");
fs.writeFileSync(path.join(project, "PLAN.md"), "# Plan\n1. First version\n");
notify("Expanded the plan file.", planEnv, "planning-smoke-thread");
fs.writeFileSync(path.join(project, "PLAN.md"), "# Plan\n1. First version\n2. More planning\n");
notify("Expanded the plan again.", planEnv, "planning-smoke-thread");
let planJob = readJson(planJobFile);
assert(planJob.metrics.planning_cycles === 2, "planning turns were not counted");
assert(planJob.metrics.implementation_cycles === 0, "plan-file edits masqueraded as implementation progress");
assert(planJob.anti_slop.violation === true, "plan-file churn did not trigger anti-slop");

// A repository change before required plan approval remains pending instead of becoming the new baseline.
run(process.execPath, [
  progress, "start", "--task-id", "TASK-GATE", "--classification", "MEDIUM",
  "--title", "Pre-approval delta retention", "--project", project,
], { cwd: project });
const gateEnv = {
  ...process.env,
  WEB_KIT_PROJECT_ROOT: project,
  WEB_KIT_SUPERVISOR_ID: "gate-bridge-progress-smoke",
  CODEX_HOME: path.join(project, ".codex-empty"),
};
const gateTurnFile = path.join(project, ".agent-core", "state", "context-rollover", "turns", "gate-bridge-progress-smoke.json");
notify("Inspecting before the plan is approved.", gateEnv, "gate-smoke-thread");
let gateState = readJson(gateTurnFile);
const authorizedBaseline = gateState.repository_fingerprint;
fs.writeFileSync(path.join(project, "src", "gated.js"), "export const gated = true;\n");
notify("Changed code before approval.", gateEnv, "gate-smoke-thread");
gateState = readJson(gateTurnFile);
let gateJob = readJson(gateJobFile);
assert(gateState.governance_violation?.type === "PRE_APPROVAL_REPOSITORY_DELTA", "pre-approval delta did not record governance violation");
assert(gateState.repository_fingerprint === authorizedBaseline, "rejected pre-approval delta advanced repository fingerprint");
assert(gateState.pending_repository_fingerprint && gateState.pending_repository_fingerprint !== authorizedBaseline, "pending unauthorized fingerprint was not preserved");
assert(gateJob.metrics.implementation_cycles === 0, "pre-approval delta received implementation credit");

notify("Still blocked on plan approval.", gateEnv, "gate-smoke-thread");
gateState = readJson(gateTurnFile);
assert(gateState.repository_fingerprint === authorizedBaseline, "repeated blocked delta advanced the baseline");
assert(gateState.governance_violation?.type === "PRE_APPROVAL_REPOSITORY_DELTA", "governance violation disappeared before resolution");

// Once governance clears, the exact same pending delta must be recorded as implementation before the fingerprint advances.
run(process.execPath, [
  progress, "update", "--task-id", "TASK-GATE", "--status", "PLANNING",
  "--plan-bullets", "3", "--plan-status", "APPROVED", "--evidence", "three-bullet short plan approved",
  "--project", project,
], { cwd: project });
notify("Plan approved; account for the previously blocked delta.", gateEnv, "gate-smoke-thread");
gateState = readJson(gateTurnFile);
gateJob = readJson(gateJobFile);
assert(gateJob.metrics.implementation_cycles === 1, "pending delta was not recorded after governance cleared");
assert(gateJob.status === "IMPLEMENTING", "pending delta did not advance the job into implementation after approval");
assert(gateState.repository_fingerprint !== authorizedBaseline, "resolved pending delta did not advance repository fingerprint");
assert(gateState.pending_repository_fingerprint === null, "resolved pending fingerprint was not cleared");
assert(gateState.governance_violation === null, "resolved governance violation was not cleared");

console.log("Provider bridge automatic progress smoke: PASS");
