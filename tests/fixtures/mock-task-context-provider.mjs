#!/usr/bin/env node
// Mock native CLI for supervisor process integration. It does not perform an AI review.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const provider = process.env.WEB_KIT_TEST_PROVIDER;
const scenario = process.env.WEB_KIT_TASK_TEST_SCENARIO;
const logRoot = process.env.WEB_KIT_TASK_TEST_DIR;
const project = process.cwd();
const args = process.argv.slice(2);
const freshPrompt = args.find(arg => arg.includes("Web Kit started a fresh review session"));
const phase = freshPrompt ? "reviewer" : "builder";
const sessionId = freshPrompt ? provider + "-review-" + process.env.WEB_KIT_LAUNCH_ID : process.env.WEB_KIT_TASK_TEST_OLD_SESSION;
const helper = path.join(project, ".agent-core", "bin", "task-handoff.mjs");
const bridge = process.env.WEB_KIT_PROVIDER_BRIDGE;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (name, value) => fs.writeFileSync(path.join(logRoot, name), JSON.stringify(value, null, 2) + "\n");
const event = (name, details = {}) => fs.appendFileSync(path.join(logRoot, "events.jsonl"),
  JSON.stringify({ event: name, phase, pid: process.pid, at: Date.now(), ...details }) + "\n");

assert(["codex", "claude"].includes(provider), "mock provider identity missing");
assert(logRoot && scenario, "mock scenario missing");
fs.mkdirSync(logRoot, { recursive: true });
fs.appendFileSync(path.join(logRoot, "calls.jsonl"), JSON.stringify({
  provider, phase, pid: process.pid, args, session_id: sessionId,
  active: process.env.WEB_KIT_CONTEXT_SUPERVISOR_ACTIVE === "1",
  handoff_mode: process.env.WEB_KIT_CONTEXT_SUPERVISOR_HANDOFF === "1",
  supervisor_id: process.env.WEB_KIT_SUPERVISOR_ID,
  launch_id: process.env.WEB_KIT_LAUNCH_ID,
  review_task_id: process.env.WEB_KIT_REVIEW_TASK_ID || null,
}) + "\n");
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { event("stopped", { signal }); process.exit(0); });
setTimeout(() => { console.error("Mock task provider timed out: " + scenario + "/" + phase); process.exit(98); }, 30000);

function managed(command, extra = [], options = {}) {
  const result = spawnSync(process.execPath, [helper, command, ...extra], {
    cwd: project, env: process.env, encoding: "utf8", windowsHide: true, timeout: 10000, ...options,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, command + " failed:\n" + result.stdout + "\n" + result.stderr);
  return JSON.parse(result.stdout);
}

function bridgeCall(mode, payload, environment = process.env) {
  const argv = [bridge, mode];
  if (provider === "codex") argv.push(JSON.stringify(payload));
  const result = spawnSync(process.execPath, argv, {
    cwd: project, env: environment, input: provider === "claude" ? JSON.stringify(payload) : undefined,
    encoding: "utf8", windowsHide: true, timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, mode + " failed:\n" + result.stdout + "\n" + result.stderr);
}

function context(percent) {
  if (provider === "codex") {
    const directory = path.join(process.env.CODEX_HOME, "sessions", "2026", "11", "03");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "rollout-" + sessionId + ".jsonl"), JSON.stringify({
      type: "event_msg",
      payload: { type: "token_count", model_context_window: 100000, last_token_usage: { input_tokens: percent * 1000 } },
    }) + "\n");
  } else {
    bridgeCall("claude-statusline", {
      session_id: sessionId, model: { id: "task-test-model" },
      context_window: { used_percentage: percent, context_window_size: 100000, total_input_tokens: percent * 1000, total_output_tokens: 100 },
    });
  }
}

let boundaryCount = 0;
function boundary({ valid = true, environment = process.env, nativeSession = sessionId } = {}) {
  boundaryCount += 1;
  if (provider === "codex") {
    bridgeCall("codex-notify", {
      type: valid ? "agent-turn-complete" : "agent-turn-started",
      "thread-id": nativeSession,
      "input-messages": ["BUILDER_CONVERSATION_MUST_NOT_BE_COPIED"],
      "last-assistant-message": "BUILDER_REASONING_MUST_NOT_BE_COPIED_" + boundaryCount,
    }, environment);
  } else {
    bridgeCall("claude-notification", {
      hook_event_name: "Notification",
      notification_type: valid ? "idle_prompt" : "permission_prompt",
      session_id: nativeSession,
    }, environment);
  }
  event(valid ? "native-boundary" : "not-a-boundary", { native_session: nativeSession });
}

async function stillRunning(name, milliseconds = 700) {
  await sleep(milliseconds);
  event(name);
}

function inspectInstrumentation() {
  assert.equal(process.env.WEB_KIT_CONTEXT_SUPERVISOR_ACTIVE, "1", "provider was not supervised");
  assert(process.env.WEB_KIT_SUPERVISOR_ID && process.env.WEB_KIT_LAUNCH_ID, "launch binding missing");
  assert.equal(process.env.WEB_KIT_CONTEXT_SUPERVISOR_HANDOFF, undefined, "task request resumed builder for a handoff");
  assert(!args.includes("exec") && !args.includes("-p") && !args.includes("--print"), "task review was not a native interactive launch");
  if (provider === "codex") {
    const index = args.findIndex((arg, i) => arg === "-c" && args[i + 1]?.startsWith("notify="));
    assert(index >= 0, "Codex notification instrumentation missing");
    const notify = JSON.parse(args[index + 1].slice("notify=".length));
    assert.equal(notify[1], bridge, "Codex notification does not use the installed bridge");
  } else {
    const index = args.indexOf("--settings");
    assert(index >= 0, "Claude temporary settings missing");
    const settings = readJson(args[index + 1]);
    const original = readJson(path.join(project, "fixture-settings.json"));
    for (const [hook, groups] of Object.entries(original.hooks)) {
      assert.deepEqual(settings.hooks[hook].slice(0, groups.length), groups, "existing " + hook + " hooks changed");
    }
    assert.deepEqual(settings.permissions, original.permissions, "Claude permission settings changed");
    assert(settings.statusLine.command.includes("claude-statusline"), "Claude telemetry instrumentation missing");
    assert(settings.hooks.Notification.some(group => group.matcher === "idle_prompt" &&
      group.hooks.some(hook => hook.command?.includes("claude-notification"))), "Claude idle hook missing");
    writeJson(phase + "-settings.json", settings);
  }
}

async function rejectBadRequests(queued, pending) {
  const mutations = [
    ["malformed-json", null],
    ["unknown-schema", { schema_version: 99 }],
    ["wrong-reason", { reason: "implementation" }],
    ["cross-supervisor", { supervisor_id: "not-this-supervisor" }],
    ["stale-launch", { launch_id: "old-launch-generation" }],
    ["wrong-provider", { provider: provider === "codex" ? "claude" : "codex" }],
    ["wrong-project", { project: path.dirname(project) }],
    ["stale-time", { requested_at: "2000-01-01T00:00:00.000Z" }],
  ];
  for (const [name, fields] of mutations) {
    event("testing-invalid-request", { mutation: name });
    fs.writeFileSync(queued.pending_path, fields === null ? "{broken json\n" : JSON.stringify({ ...pending, ...fields }) + "\n");
    boundary();
    await stillRunning("rejected-" + name, 400);
  }
  fs.writeFileSync(queued.pending_path, JSON.stringify(pending) + "\n");
  const requestFile = path.join(project, ".agent-core", "state", "context-rollover", "requests", pending.supervisor_id + ".json");
  fs.mkdirSync(path.dirname(requestFile), { recursive: true });
  for (const [name, value] of [
    ["malformed-published", "{not json\n"],
    ["cross-supervisor-published", JSON.stringify({ ...pending, safe_boundary: true, supervisor_id: "another-supervisor", session_id: sessionId })],
    ["stale-launch-published", JSON.stringify({ ...pending, safe_boundary: true, launch_id: "previous-launch", session_id: sessionId })],
  ]) {
    fs.writeFileSync(requestFile, value);
    await stillRunning("rejected-" + name, 400);
    fs.rmSync(requestFile, { force: true });
  }
}

async function builder() {
  context(10);
  const queued = managed("request-review", ["--request", process.env.WEB_KIT_TASK_TEST_REQUEST, "--selection", process.env.WEB_KIT_TASK_TEST_SELECTION]);
  assert.equal(queued.status, "queued");
  assert(queued.task_id && queued.pending_path, "queued request did not expose task and pending path");
  writeJson("queued.json", queued);
  const pending = readJson(queued.pending_path);
  writeJson("builder-pending.json", pending);
  writeJson("job-queued.json", readJson(path.join(project, ".agent-core", "state", "jobs", queued.task_id + ".json")));
  event("request-queued");
  context(10); // A status refresh after queuing is still not a turn boundary.
  boundary({ valid: false });
  await stillRunning("waiting-for-real-boundary");
  if (scenario === "no-boundary") process.exit(0);
  if (scenario === "success") await rejectBadRequests(queued, pending);
  event("releasing-review");
  boundary();
  await new Promise(() => {});
}

async function waitForFailedReviewStop(taskId, cause) {
  context(60);
  boundary({ valid: false });
  await stillRunning(cause + "-waiting-for-real-boundary");
  boundary({ nativeSession: process.env.WEB_KIT_TASK_TEST_OLD_SESSION });
  await stillRunning(cause + "-old-session-ignored");
  writeJson("job-before-failure-boundary.json", readJson(path.join(project, ".agent-core", "state", "jobs", taskId + ".json")));
  event("failure-boundary-requested", { cause });
  boundary();
  // A real native TUI remains open after its final turn. Only the supervisor
  // may stop this failed review; the watchdog must never serve as a bailout.
  await new Promise(() => {});
}

async function reviewer() {
  const queued = readJson(path.join(logRoot, "queued.json"));
  assert.equal(process.env.WEB_KIT_REVIEW_TASK_ID, queued.task_id, "fresh provider has the wrong review task");
  const taskRoot = path.join(project, ".agent-core", "state", "reviews", queued.task_id);
  writeJson("review-handoff.json", readJson(path.join(taskRoot, "handoff.json")));
  writeJson("job-reviewing.json", readJson(path.join(project, ".agent-core", "state", "jobs", queued.task_id + ".json")));
  assert(freshPrompt.includes(queued.task_id), "fresh prompt does not point at this task handoff");
  if (scenario === "launch-failure") process.exit(23);

  context(60); // Review completion must not become another threshold-driven builder continuation.
  if (scenario === "success") {
    const old = readJson(path.join(logRoot, "builder-pending.json"));
    fs.writeFileSync(queued.pending_path, JSON.stringify(old) + "\n");
    boundary({ environment: { ...process.env, WEB_KIT_LAUNCH_ID: old.launch_id }, nativeSession: process.env.WEB_KIT_TASK_TEST_OLD_SESSION });
    await stillRunning("ignored-old-launch-callback");
  }
  const report = "# Mock native review report\n\n" + process.env.WEB_KIT_TASK_TEST_MARKER +
    "\n\nTEST FIXTURE ONLY: no AI source analysis or project checks ran.\n" +
    (scenario === "empty-selection" ? "\nChanges review: NO CHANGES\n" : "\nChanges review: COMPLETED\n") +
    "\nTask: " + queued.task_id + "\nSession: " + sessionId +
    "\nSelection: " + process.env.WEB_KIT_TASK_TEST_SELECTION +
    "\nChecks: not executed\nPR readiness: not assessed\n";
  fs.writeFileSync(path.join(taskRoot, "report.md"), report);
  if (scenario === "missing-receipt") {
    await waitForFailedReviewStop(queued.task_id, "missing-receipt");
    return;
  }
  const ready = managed("report-ready");
  writeJson("ready-output.json", ready);
  writeJson("job-after-receipt.json", readJson(path.join(project, ".agent-core", "state", "jobs", queued.task_id + ".json")));
  event("receipt-staged");
  if (scenario === "stale-receipt") {
    const file = path.join(taskRoot, "ready.json");
    fs.writeFileSync(file, JSON.stringify({ ...readJson(file), launch_id: "stale-review-generation" }) + "\n");
    await waitForFailedReviewStop(queued.task_id, "stale-receipt");
    return;
  }
  context(60); // A status refresh cannot deliver a staged report receipt either.
  if (scenario === "success") {
    boundary({ nativeSession: process.env.WEB_KIT_TASK_TEST_OLD_SESSION });
    await stillRunning("same-native-session-rejected");
  }
  boundary({ valid: false });
  await stillRunning("receipt-waiting-for-real-boundary");
  process.stdout.write(report + "\n");
  event("report-presented");
  boundary();
  await new Promise(() => {});
}

try {
  inspectInstrumentation();
  if (freshPrompt) await reviewer();
  else await builder();
} catch (error) {
  console.error("Mock task provider failed: " + error.stack);
  process.exit(97);
}
