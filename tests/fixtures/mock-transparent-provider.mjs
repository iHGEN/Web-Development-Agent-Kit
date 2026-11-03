#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const provider = process.env.WEB_KIT_TEST_PROVIDER;
if (!new Set(["codex", "claude"]).has(provider)) process.exit(90);

const project = process.cwd();
const args = process.argv.slice(2);
const active = process.env.WEB_KIT_CONTEXT_SUPERVISOR_ACTIVE === "1";
const handoffMode = process.env.WEB_KIT_CONTEXT_SUPERVISOR_HANDOFF === "1";
const isHeadless = provider === "codex" ? args.includes("exec") : args.includes("-p") || args.includes("--print");

if (!active) {
  console.log(`${provider} passthrough`);
  process.exit(0);
}

const stateRoot = path.join(project, ".agent-core", "state", "transparent-test");
fs.mkdirSync(stateRoot, { recursive: true });
const logFile = path.join(stateRoot, `${provider}-calls.jsonl`);
fs.appendFileSync(logFile, `${JSON.stringify({ provider, args, active, handoffMode, isHeadless, pid: process.pid,
  launch_id: process.env.WEB_KIT_LAUNCH_ID || null, at: new Date().toISOString() })}\n`);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

function handoff() {
  return {
    original_request: `transparent ${provider} task`,
    summary: `${provider} completed the first safe workflow unit before rollover`,
    current_phase: "implementation",
    current_role: "backend-developer",
    completed_steps: ["step-1"],
    current_step: "step-1",
    pending_steps: ["step-2"],
    decisions: ["reuse existing service"],
    constraints: ["preserve public API"],
    files_changed: ["src/index.js"],
    validation_completed: ["step-local test"],
    validation_pending: ["handoff validation"],
    next_action: "implement step-2"
  };
}

if (isHeadless && handoffMode) {
  if (provider === "codex") {
    console.log(JSON.stringify({ type: "thread.started", thread_id: "codex-old-session" }));
    console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(handoff()) } }));
  } else {
    console.log(JSON.stringify({ type: "result", session_id: "claude-old-session", result: JSON.stringify(handoff()) }));
  }
  process.exit(0);
}

const freshPrompt = args.find((arg) => typeof arg === "string" && arg.includes("Web Kit automatically started a fresh context"));
if (freshPrompt) {
  fs.writeFileSync(path.join(stateRoot, `${provider}-fresh.txt`), freshPrompt, "utf8");
  process.exit(0);
}

if (provider === "codex") {
  let notifyValue = null;
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === "-c" && String(args[i + 1]).startsWith("notify=")) notifyValue = String(args[i + 1]).slice("notify=".length);
  }
  if (!notifyValue) process.exit(91);
  const notify = JSON.parse(notifyValue);
  const codexHome = path.resolve(process.env.CODEX_HOME || path.join(project, ".codex-test"));
  const sessionDir = path.join(codexHome, "sessions", "2026", "08", "18");
  fs.mkdirSync(sessionDir, { recursive: true });
  const session = path.join(sessionDir, "rollout-codex-old-session.jsonl");
  const emit = percent => {
    fs.writeFileSync(session, `${JSON.stringify({ type: "event_msg", payload: { type: "token_count", model_context_window: 100000, last_token_usage: { input_tokens: percent * 1000 } } })}\n`);
    const event = JSON.stringify({
      type: "agent-turn-complete",
      "thread-id": "codex-old-session",
      "input-messages": ["transparent codex task"],
      "last-assistant-message": `finished step one at ${percent}%`
    });
    const result = spawnSync(String(notify[0]), [...notify.slice(1).map(String), event], { stdio: "inherit", windowsHide: true });
    if (result.error || result.status !== 0) process.exit(92);
  };
  emit(49);
  await sleep(700);
  fs.writeFileSync(path.join(stateRoot, `${provider}-below-threshold.txt`), "still running at 49%\n");
  emit(60);
} else {
  const settingsIndex = args.indexOf("--settings");
  if (settingsIndex < 0 || !args[settingsIndex + 1]) process.exit(93);
  const settings = JSON.parse(fs.readFileSync(args[settingsIndex + 1], "utf8"));
  if (!settings.statusLine?.command || !settings.statusLine.command.includes("provider-bridge.mjs")) process.exit(94);
  const bridge = process.env.WEB_KIT_PROVIDER_BRIDGE;
  if (!bridge) process.exit(95);
  const notifyHooks = settings.hooks?.Notification || [];
  if (!notifyHooks.some(group => group.matcher === "idle_prompt" && group.hooks?.some(hook =>
    hook.type === "command" && hook.command?.includes("claude-notification")))) process.exit(97);
  const emit = (mode, payload) => {
    const result = spawnSync(process.execPath, [bridge, mode], { input: JSON.stringify(payload), encoding: "utf8", stdio: ["pipe", "ignore", "inherit"], windowsHide: true });
    if (result.error || result.status !== 0) process.exit(96);
  };
  const status = percent => emit("claude-statusline", {
    session_id: "claude-old-session",
    model: { id: "claude-test" },
    context_window: { used_percentage: percent, context_window_size: 100000, total_input_tokens: percent * 1000, total_output_tokens: 1000 }
  });
  const idle = () => emit("claude-notification", {
    hook_event_name: "Notification", notification_type: "idle_prompt", session_id: "claude-old-session"
  });
  status(49);
  idle();
  await sleep(700);
  fs.writeFileSync(path.join(stateRoot, `${provider}-below-threshold.txt`), "still running at 49%\n");
  status(60);
  await sleep(700);
  fs.writeFileSync(path.join(stateRoot, `${provider}-before-idle.txt`), "status refresh did not end the active turn\n");
  idle();
}

setInterval(() => {}, 1000);
