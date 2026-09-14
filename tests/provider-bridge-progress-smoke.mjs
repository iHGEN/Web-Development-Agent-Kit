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
assert(job.metrics.prose_only_cycles === 0, "implementation turn was incorrectly classified as prose");

fs.writeFileSync(path.join(project, "src", "new.js"), "export const newValue = 1;\n");
notify("Added a new untracked implementation file.");
job = readJson(jobFile);
assert(job.metrics.implementation_cycles === 2, "new untracked file was not classified as implementation");

fs.writeFileSync(path.join(project, "src", "new.js"), "export const newValue = 2;\n");
notify("Updated the existing untracked implementation file.");
job = readJson(jobFile);
assert(job.metrics.implementation_cycles === 3, "content change inside an already-untracked file was not detected");

notify("I am thinking about the next step.");
job = readJson(jobFile);
assert(job.metrics.prose_only_cycles === 1, "first stalled implementation turn was not counted");
assert(job.anti_slop.violation === false, "anti-slop triggered after only one stalled turn");

notify("I will think about the plan again.");
job = readJson(jobFile);
assert(job.metrics.prose_only_cycles === 2, "second stalled implementation turn was not counted");
assert(job.anti_slop.violation === true, "anti-slop did not trigger after two stalled turns");
assert(job.anti_slop.forced_next_phase === "IMPLEMENTING", "anti-slop did not force IMPLEMENTING");
assert(/Stop meta-work/.test(job.next_action), "anti-slop did not write an implementation next action");

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
  run(process.execPath, [bridge, "claude-statusline"], {
    cwd: project,
    env: claudeEnv,
    input: JSON.stringify(payload),
  });
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
assert(claudeJob.anti_slop.violation === true, "Claude anti-slop guard did not trigger");
assert(claudeJob.anti_slop.forced_next_phase === "IMPLEMENTING", "Claude anti-slop guard did not force implementation");

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
let planJob = readJson(planJobFile);
assert(planJob.metrics.planning_cycles === 1, "planning repository change was not classified as planning");
assert(planJob.metrics.implementation_cycles === 0, "plan-file edit masqueraded as implementation progress");
fs.writeFileSync(path.join(project, "PLAN.md"), "# Plan\n1. First version\n2. More planning\n");
notify("Expanded the plan again.", planEnv, "planning-smoke-thread");
planJob = readJson(planJobFile);
assert(planJob.metrics.planning_cycles === 2, "second planning turn was not counted");
assert(planJob.metrics.implementation_cycles === 0, "repeated plan-file edits were credited as implementation");
assert(planJob.anti_slop.violation === true, "plan-file churn did not trigger anti-slop");
assert(planJob.status === "PLANNING", "planning anti-slop incorrectly bypassed plan approval");
assert(planJob.anti_slop.forced_next_phase === "PLANNING_APPROVAL_THEN_IMPLEMENTING", "planning anti-slop did not preserve the approval gate");

console.log("Provider bridge automatic progress smoke: PASS");
