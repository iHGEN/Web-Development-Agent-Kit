#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const planSourceJobFile = path.join(jobsDir, "TASK-PLAN-SOURCE.json");
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

// Recognized planning-artifact churn remains planning and never earns implementation credit.
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

// Source-code edits while explicitly PLANNING and unapproved are governance violations, not planning progress.
run(process.execPath, [
  progress, "start", "--task-id", "TASK-PLAN-SOURCE", "--classification", "MEDIUM",
  "--title", "Planning source-delta guard", "--project", project,
], { cwd: project });
run(process.execPath, [
  progress, "update", "--task-id", "TASK-PLAN-SOURCE", "--status", "PLANNING",
  "--agent", "web-orchestrator", "--plan-bullets", "3", "--next", "complete approval before code changes",
  "--project", project,
], { cwd: project });
const planSourceEnv = {
  ...process.env,
  WEB_KIT_PROJECT_ROOT: project,
  WEB_KIT_SUPERVISOR_ID: "planning-source-bridge-progress-smoke",
  CODEX_HOME: path.join(project, ".codex-empty"),
};
const planSourceTurnFile = path.join(project, ".agent-core", "state", "context-rollover", "turns", "planning-source-bridge-progress-smoke.json");
notify("Planning is active; no source edits yet.", planSourceEnv, "planning-source-smoke-thread");
let planSourceState = readJson(planSourceTurnFile);
const planningAuthorizedBaseline = planSourceState.repository_fingerprint;
fs.writeFileSync(path.join(project, "src", "planning-source.js"), "export const planningSource = true;\n");
notify("Changed application source while planning was still unapproved.", planSourceEnv, "planning-source-smoke-thread");
planSourceState = readJson(planSourceTurnFile);
let planSourceJob = readJson(planSourceJobFile);
assert(planSourceState.governance_violation?.type === "PRE_APPROVAL_REPOSITORY_DELTA", "PLANNING source edit did not record a pre-approval governance violation");
assert(planSourceState.repository_fingerprint === planningAuthorizedBaseline, "PLANNING source edit advanced the authorized repository fingerprint");
assert(planSourceState.pending_changed_paths?.includes("src/planning-source.js"), "PLANNING source edit was not identified in pending changed paths");
assert(planSourceJob.metrics.planning_cycles === 0, "source edit during PLANNING was incorrectly credited as planning");
assert(planSourceJob.metrics.implementation_cycles === 0, "source edit during PLANNING received implementation credit before approval");

notify("Still waiting for approval with the same source delta present.", planSourceEnv, "planning-source-smoke-thread");
planSourceState = readJson(planSourceTurnFile);
assert(planSourceState.repository_fingerprint === planningAuthorizedBaseline, "repeated PLANNING source delta advanced the baseline");
assert(planSourceState.governance_violation?.type === "PRE_APPROVAL_REPOSITORY_DELTA", "PLANNING source violation disappeared before approval");

run(process.execPath, [
  progress, "update", "--task-id", "TASK-PLAN-SOURCE", "--status", "PLANNING",
  "--plan-bullets", "3", "--plan-status", "APPROVED", "--evidence", "short plan approved after source-delta violation",
  "--project", project,
], { cwd: project });
notify("Approval is now present; account for the pending source delta.", planSourceEnv, "planning-source-smoke-thread");
planSourceState = readJson(planSourceTurnFile);
planSourceJob = readJson(planSourceJobFile);
assert(planSourceJob.metrics.implementation_cycles === 1, "pending PLANNING source delta was not recorded after approval");
assert(planSourceJob.status === "IMPLEMENTING", "approved pending source delta did not transition into implementation");
assert(planSourceState.repository_fingerprint !== planningAuthorizedBaseline, "resolved PLANNING source delta did not advance the fingerprint");
assert(planSourceState.governance_violation === null, "resolved PLANNING source violation was not cleared");

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

// New supervisors bind callbacks to a live launch. Exercise real Git deltas so
// a stale callback or corrupt review artifact would otherwise credit old work.
const guardedState = path.join(project, ".agent-core", "state", "context-rollover");
const guardedCodexHome = path.join(project, ".agent-core", "state", "bridge-codex-fixture");
function guardedCallback(provider, env, percent, sessionId, message) {
  if (provider === "codex") {
    const sessions = path.join(guardedCodexHome, "sessions", "2026", "11", "03");
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(path.join(sessions, "rollout-" + sessionId + ".jsonl"), JSON.stringify({
      type: "event_msg",
      payload: { type: "token_count", model_context_window: 100000, last_token_usage: { input_tokens: percent * 1000 } },
    }) + "\n");
    run(process.execPath, [bridge, "codex-notify", JSON.stringify({
      type: "agent-turn-complete", "thread-id": sessionId,
      "input-messages": ["implement the guarded task"], "last-assistant-message": message,
    })], { cwd: project, env });
    return;
  }
  run(process.execPath, [bridge, "claude-statusline"], { cwd: project, env, input: JSON.stringify({
    session_id: sessionId, model: { id: "claude-guard-smoke" },
    context_window: { used_percentage: percent, context_window_size: 100000, total_input_tokens: percent * 1000, total_output_tokens: 100 },
  }) });
  run(process.execPath, [bridge, "claude-notification"], { cwd: project, env, input: JSON.stringify({
    hook_event_name: "Notification", notification_type: "idle_prompt", session_id: sessionId,
  }) });
}
function snapshot(files) { return files.map(file => [file, fs.readFileSync(file)]); }
function assertUnchanged(files, reason) {
  for (const [file, content] of files) assert(fs.readFileSync(file).equals(content),
    reason + ": changed " + path.relative(project, file));
}
let guardedValue = 100;
for (const provider of ["codex", "claude"]) {
  const taskId = "TASK-GUARDED-" + provider.toUpperCase();
  run(process.execPath, [progress, "start", "--task-id", taskId, "--classification", "SMALL",
    "--local-only", "--title", provider + " launch ownership", "--project", project], { cwd: project });
  run(process.execPath, [progress, "update", "--task-id", taskId, "--status", "IMPLEMENTING",
    "--agent", "backend-developer", "--next", "continue the existing implementation", "--project", project], { cwd: project });
  const guardedJob = path.join(jobsDir, taskId + ".json");
  const supervisorId = randomUUID();
  const initialLaunch = randomUUID();
  const controllerFile = path.join(guardedState, "supervisors", supervisorId + ".json");
  const turnFile = path.join(guardedState, "turns", supervisorId + ".json");
  const telemetryFile = path.join(guardedState, "telemetry", supervisorId + ".json");
  const requestFile = path.join(guardedState, "requests", supervisorId + ".json");
  let controller = {
    schema_version: 2, task_handoff_version: 1, pid: process.pid, status: "running",
    project, provider, supervisor_id: supervisorId, launch_id: initialLaunch,
    launch_started_at: new Date().toISOString(), active_review_task_id: null,
  };
  fs.mkdirSync(path.dirname(controllerFile), { recursive: true });
  const saveController = () => fs.writeFileSync(controllerFile, JSON.stringify(controller) + "\n");
  saveController();
  const initialEnv = {
    ...process.env, WEB_KIT_CONTEXT_SUPERVISOR_ACTIVE: "1",
    WEB_KIT_PROJECT_ROOT: project, WEB_KIT_SUPERVISOR_ID: supervisorId, WEB_KIT_LAUNCH_ID: initialLaunch,
    WEB_KIT_REVIEW_TASK_ID: "", WEB_KIT_CONTEXT_THRESHOLD: "50", CODEX_HOME: guardedCodexHome,
    WEB_KIT_ORIGINAL_CODEX_NOTIFY_B64: "", WEB_KIT_ORIGINAL_CLAUDE_STATUSLINE_B64: "",
  };
  const oldSession = provider + "-guarded-builder";
  guardedCallback(provider, initialEnv, 10, oldSession, "Pin the real implementation baseline.");
  assert(readJson(turnFile).task_id === taskId, provider + ": normal callback did not pin the actual implementation task");
  assert(readJson(turnFile).repository_fingerprint, provider + ": Git baseline fingerprint was not established");
  assert(readJson(telemetryFile).launch_id === initialLaunch, provider + ": normal current telemetry was not recorded");
  assert(readJson(guardedJob).metrics.implementation_cycles === 0, provider + ": baseline callback earned implementation credit");
  const oldState = snapshot([guardedJob, turnFile, telemetryFile]);

  const currentLaunch = randomUUID();
  controller = { ...controller, launch_id: currentLaunch, launch_started_at: new Date().toISOString() };
  saveController();
  fs.writeFileSync(path.join(project, "src", "index.js"), "export const value = " + guardedValue++ + ";\n");
  guardedCallback(provider, initialEnv, 60, oldSession, "Late old-launch callback after a real source edit.");
  assertUnchanged(oldState, provider + ": stale launch callback");
  assert(!fs.existsSync(requestFile), provider + ": stale launch callback requested threshold rollover");

  // A current callback must still recognize that exact delta; suppression above
  // cannot pass just because the fixture failed to expose meaningful Git state.
  const currentEnv = { ...initialEnv, WEB_KIT_LAUNCH_ID: currentLaunch };
  const currentSession = provider + "-guarded-current";
  guardedCallback(provider, currentEnv, 10, currentSession, "Account for the source delta under the current launch.");
  assert(readJson(guardedJob).metrics.implementation_cycles === 1, provider + ": current launch lost legitimate automatic progress");
  const implementationState = snapshot([guardedJob, turnFile]);

  const reviewId = "changes-review-" + randomUUID();
  const reviewDir = path.join(project, ".agent-core", "state", "reviews", reviewId);
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(path.join(reviewDir, "request.json"), JSON.stringify({
    schema_version: 1, kind: "changes-review", task_id: reviewId, request_id: randomUUID(),
    project, provider, supervisor_id: supervisorId, launch_id: currentLaunch,
    requested_at: new Date().toISOString(), original_request: "review these changes",
    selection: "src/index.js", report_path: path.join(reviewDir, "report.md"),
  }) + "\n");
  const reviewLaunch = randomUUID();
  controller = { ...controller, launch_id: reviewLaunch, launch_started_at: new Date().toISOString(), active_review_task_id: reviewId };
  saveController();
  const reviewEnv = { ...currentEnv, WEB_KIT_LAUNCH_ID: reviewLaunch, WEB_KIT_REVIEW_TASK_ID: reviewId };
  for (const artifact of ["missing", "corrupt"]) {
    if (artifact === "corrupt") fs.writeFileSync(path.join(reviewDir, "handoff.json"), "{broken handoff\n");
    fs.writeFileSync(path.join(project, "src", "index.js"), "export const value = " + guardedValue++ + ";\n");
    guardedCallback(provider, reviewEnv, 60, provider + "-guarded-review", "Review handoff is " + artifact + ".");
    assertUnchanged(implementationState, provider + ": " + artifact + " review handoff fell through to implementation");
    const telemetry = readJson(telemetryFile);
    assert(telemetry.launch_id === reviewLaunch && telemetry.used_percentage === 60,
      provider + ": " + artifact + " review test did not reach the valid current telemetry path");
    assert(!fs.existsSync(requestFile), provider + ": " + artifact + " review handoff triggered threshold continuation");
  }
}

// An old callback may still be running the user's original notification when
// the next turn queues a review or stages its report. Keep the launch and native
// session identical: generation-only guards cannot distinguish these turns.
const taskHandoff = path.join(project, ".agent-core", "bin", "task-handoff.mjs");
const { readReviewTransition, startReviewTransition, finishReviewTransition } = await import(pathToFileURL(taskHandoff).href);
const delayedSupervisor = randomUUID();
const delayedBuilderLaunch = randomUUID();
const delayedControllerFile = path.join(guardedState, "supervisors", delayedSupervisor + ".json");
const delayedRequestFile = path.join(guardedState, "requests", delayedSupervisor + ".json");
const delayedHookDir = path.join(guardedState, "delayed-notify", delayedSupervisor);
fs.mkdirSync(delayedHookDir, { recursive: true });
const delayedHookFile = path.join(delayedHookDir, "original-notify.mjs");
fs.writeFileSync(delayedHookFile, [
  'import fs from "node:fs";',
  'const [started, release] = process.argv.slice(2);',
  'fs.writeFileSync(started, new Date().toISOString());',
  'const deadline = Date.now() + 15000;',
  'const timer = setInterval(() => {',
  '  if (fs.existsSync(release)) { fs.writeFileSync(release + ".observed", "released"); clearInterval(timer); process.exit(0); }',
  '  if (Date.now() >= deadline) { clearInterval(timer); process.exit(1); }',
  '}, 10);',
].join("\n") + "\n");
let delayedController = {
  schema_version: 2, task_handoff_version: 1, pid: process.pid, status: "running",
  project, provider: "codex", supervisor_id: delayedSupervisor, launch_id: delayedBuilderLaunch,
  launch_started_at: new Date().toISOString(), active_review_task_id: null,
};
const saveDelayedController = () => fs.writeFileSync(delayedControllerFile, JSON.stringify(delayedController) + "\n");
saveDelayedController();
const delayedBuilderEnv = {
  ...process.env, WEB_KIT_CONTEXT_SUPERVISOR_ACTIVE: "1",
  WEB_KIT_PROJECT_ROOT: project, WEB_KIT_SUPERVISOR_ID: delayedSupervisor, WEB_KIT_LAUNCH_ID: delayedBuilderLaunch,
  WEB_KIT_REVIEW_TASK_ID: "", CODEX_HOME: path.join(project, ".codex-empty"),
  WEB_KIT_ORIGINAL_CODEX_NOTIFY_B64: "", WEB_KIT_ORIGINAL_CLAUDE_STATUSLINE_B64: "",
};
const delayedBuilderSession = "delayed-builder-" + randomUUID();
const delayedReviewerSession = "delayed-reviewer-" + randomUUID();
function completedTurn(sessionId, message) {
  return JSON.stringify({ type: "agent-turn-complete", "thread-id": sessionId,
    "input-messages": ["review these changes"], "last-assistant-message": message });
}
function handoffCommand(env, ...args) {
  return JSON.parse(run(process.execPath, [taskHandoff, ...args], { cwd: project, env }).stdout);
}
async function delayedBoundary(label, env, sessionId, stageNextTurn) {
  const started = path.join(delayedHookDir, label + ".started");
  const release = path.join(delayedHookDir, label + ".release");
  const original = [process.execPath, delayedHookFile, started, release];
  const child = spawn(process.execPath, [bridge, "codex-notify", completedTurn(sessionId, "Earlier turn before " + label)], {
    cwd: project, env: { ...env, WEB_KIT_ORIGINAL_CODEX_NOTIFY_B64: Buffer.from(JSON.stringify(original)).toString("base64") },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 20000,
  });
  let output = "";
  let exit;
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const closed = new Promise(resolve => {
    child.once("error", error => { exit = { error }; resolve(); });
    child.once("close", (code, signal) => { exit = { ...exit, code, signal }; resolve(); });
  });
  try {
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(started) && !exit && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert(fs.existsSync(started) && !exit, label + ": original notification did not block: " + output);
    return stageNextTurn();
  } finally {
    // Release even on a staging assertion failure so the test leaves no bridge
    // or original-notification process waiting in the background.
    fs.writeFileSync(release, "release\n");
    await closed;
    assert(!exit.error && exit.code === 0, label + ": bridge failed: " + (exit.error?.message || output || exit.signal));
    assert(fs.existsSync(release + ".observed"), label + ": original notification timed out before the test released it");
  }
}
const delayedFailures = [];
function rejectDelayedTransition(label) {
  if (!fs.existsSync(delayedRequestFile)) return;
  const request = readJson(delayedRequestFile);
  delayedFailures.push(label + ": earlier same-launch callback published " + request.reason + " for state staged during its original notification");
  // Keep both race cases observable on a broken runtime. The assertions below
  // still fail, but a fresh genuine boundary can establish the next phase.
  fs.unlinkSync(delayedRequestFile);
}

const queuedReview = await delayedBoundary("queued-review", delayedBuilderEnv, delayedBuilderSession, () =>
  handoffCommand(delayedBuilderEnv, "request-review", "--request", "review these changes", "--selection", "src/index.js"));
assert(queuedReview.registered === true, "delayed-callback regression requires a real registered review task");
rejectDelayedTransition("queued review");
const delayedJobFile = path.join(jobsDir, queuedReview.task_id + ".json");
assert(fs.existsSync(queuedReview.pending_path), "old callback consumed the queued review");
assert(readJson(delayedJobFile).status === "QUEUED", "old callback changed the queued review job");

run(process.execPath, [bridge, "codex-notify", completedTurn(delayedBuilderSession, "The new review request is now queued.")],
  { cwd: project, env: delayedBuilderEnv });
const delayedBuilderOwner = { project, supervisorId: delayedSupervisor, provider: "codex", launchId: delayedBuilderLaunch };
const queuedTransition = readReviewTransition(readJson(delayedRequestFile), delayedBuilderOwner);
assert(queuedTransition?.reason === "review-task", "fresh builder boundary did not accept the queued review");
const delayedReviewLaunch = randomUUID();
startReviewTransition(queuedTransition, delayedReviewLaunch);
fs.unlinkSync(delayedRequestFile);
delayedController = { ...delayedController, launch_id: delayedReviewLaunch,
  launch_started_at: new Date().toISOString(), active_review_task_id: queuedReview.task_id };
saveDelayedController();
const delayedReviewEnv = { ...delayedBuilderEnv, WEB_KIT_LAUNCH_ID: delayedReviewLaunch, WEB_KIT_REVIEW_TASK_ID: queuedReview.task_id };
const delayedResultFile = path.join(path.dirname(queuedReview.report_path), "result.json");
await delayedBoundary("staged-report", delayedReviewEnv, delayedReviewerSession, () => {
  fs.writeFileSync(queuedReview.report_path, "# Review report\n\nStaged during an earlier turn's notification; final response has not been sent.\n\nPR readiness: not assessed\n");
  const receipt = handoffCommand(delayedReviewEnv, "report-ready");
  assert(receipt.status === "report-ready", "review report did not produce a real receipt");
});
rejectDelayedTransition("staged report");
assert(!fs.existsSync(delayedResultFile), "old callback falsely recorded report delivery");
const stagedJob = readJson(delayedJobFile);
assert(stagedJob.status === "REVIEWING" && stagedJob.final_validation.status === "PENDING",
  "old callback prematurely completed the review job");

run(process.execPath, [bridge, "codex-notify", completedTurn(delayedReviewerSession, fs.readFileSync(queuedReview.report_path, "utf8"))],
  { cwd: project, env: delayedReviewEnv });
const delayedReviewOwner = { ...delayedBuilderOwner, launchId: delayedReviewLaunch };
const reportTransition = readReviewTransition(readJson(delayedRequestFile), delayedReviewOwner);
assert(reportTransition?.reason === "review-complete", "fresh reviewer boundary did not accept the report receipt");
const deliveredReview = finishReviewTransition(reportTransition);
assert(deliveredReview.status === "delivered" && readJson(delayedJobFile).status === "DONE",
  "fresh reviewer boundary did not record legitimate report delivery");
assert(delayedFailures.length === 0, delayedFailures.join("\n"));

console.log("Provider bridge automatic progress smoke: PASS");
