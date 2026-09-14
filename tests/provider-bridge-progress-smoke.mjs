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
const jobFile = path.join(project, ".agent-core", "state", "jobs", "TASK-BRIDGE.json");
assert(fs.existsSync(progress), "work-progress runtime missing");
assert(fs.existsSync(bridge), "provider bridge missing");

run(process.execPath, [
  progress, "start", "--task-id", "TASK-BRIDGE", "--classification", "SMALL",
  "--title", "Automatic bridge progress", "--project", project,
], { cwd: project });
run(process.execPath, [
  progress, "update", "--task-id", "TASK-BRIDGE", "--status", "IMPLEMENTING",
  "--agent", "backend-developer", "--implementation-total", "2", "--implementation-completed", "0",
  "--next", "implement the requested change", "--project", project,
], { cwd: project });

const env = {
  ...process.env,
  WEB_KIT_PROJECT_ROOT: project,
  WEB_KIT_SUPERVISOR_ID: "bridge-progress-smoke",
  CODEX_HOME: path.join(project, ".codex-empty"),
};
function notify(message) {
  const event = {
    "thread-id": "bridge-smoke-thread",
    "input-messages": ["implement the task"],
    "last-assistant-message": message,
  };
  run(process.execPath, [bridge, "codex-notify", JSON.stringify(event)], { cwd: project, env });
}

// First callback establishes a repository baseline and is not charged as a cycle.
notify("I inspected the target and am starting implementation.");
let job = readJson(jobFile);
assert(job.metrics.ai_cycles === 0, `baseline callback should not count as a cycle, got ${job.metrics.ai_cycles}`);

// A real source edit between safe turns is automatically implementation evidence.
fs.writeFileSync(path.join(project, "src", "index.js"), "export const value = 2;\n");
notify("Implemented the source change.");
job = readJson(jobFile);
assert(job.metrics.ai_cycles === 1, `expected one automatic cycle, got ${job.metrics.ai_cycles}`);
assert(job.metrics.implementation_cycles === 1, "repository delta was not classified as implementation");
assert(job.metrics.prose_only_cycles === 0, "implementation turn was incorrectly classified as prose");

// No repository delta during IMPLEMENTING is meta-only evidence.
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

// Provider bridge callbacks can repeat; identical callback payload must not double-count.
const cyclesBeforeDuplicate = job.metrics.ai_cycles;
notify("I will think about the plan again.");
job = readJson(jobFile);
assert(job.metrics.ai_cycles === cyclesBeforeDuplicate, "duplicate provider callback was double-counted");

// Web-Kit state writes themselves must not look like application implementation.
run(process.execPath, [
  progress, "update", "--task-id", "TASK-BRIDGE", "--status", "IMPLEMENTING",
  "--next", "implement now", "--evidence", "state-only update", "--project", project,
], { cwd: project });
notify("State was updated but application code was not changed.");
job = readJson(jobFile);
assert(job.metrics.implementation_cycles === 1, "Web-Kit state files were misclassified as repository implementation");

console.log("Provider bridge automatic progress smoke: PASS");
