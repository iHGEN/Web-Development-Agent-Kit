#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const provider = process.env.WEB_KIT_TEST_PROVIDER;
if (!new Set(["codex", "claude"]).has(provider)) {
  console.error("WEB_KIT_TEST_PROVIDER must be codex or claude");
  process.exit(90);
}

const project = process.cwd();
const stateDir = path.join(project, ".agent-core", "state");
fs.mkdirSync(stateDir, { recursive: true });
const countFile = path.join(stateDir, `mock-${provider}-count.txt`);
const count = Number(fs.existsSync(countFile) ? fs.readFileSync(countFile, "utf8") : "0") + 1;
fs.writeFileSync(countFile, String(count));

const controller = JSON.parse(fs.readFileSync(path.join(stateDir, "session-controller.json"), "utf8"));
const args = process.argv.slice(2);
const isResume = provider === "codex" ? args.includes("resume") : args.includes("--resume");
fs.appendFileSync(path.join(stateDir, `mock-${provider}-calls.jsonl`), `${JSON.stringify({ count, args, isResume })}\n`);

if (count === 1 && isResume) process.exit(91);
if (count === 2 && !isResume) process.exit(92);
if (count === 3 && isResume) process.exit(93);

const done = count === 3;
fs.writeFileSync(path.join(stateDir, "session-progress.json"), `${JSON.stringify({
  schema_version: 1,
  task_id: controller.task_id,
  status: done ? "done" : "continue",
  phase: done ? "final-pass" : "implementation",
  role: done ? "final-integration-validator" : provider === "codex" ? "backend-developer" : "frontend-developer",
  summary: `${provider} mock cycle ${count}`,
  completed_steps: count > 1 ? ["step-1"] : [],
  current_step: `cycle-${count}`,
  pending_steps: done ? [] : ["next-step"],
  files_changed: [],
  validation_completed: done ? ["final validation pass"] : [],
  validation_pending: done ? [] : ["continue workflow"],
  decisions: [],
  constraints: ["preserve request"],
  next_action: done ? "" : `continue after ${provider} cycle ${count}`,
  updated_at: new Date().toISOString()
}, null, 2)}\n`);

const sessionId = count === 3 ? `${provider}-session-2` : `${provider}-session-1`;
const inputTokens = provider === "codex"
  ? (count === 1 ? 25000 : count === 2 ? 55000 : 10000)
  : (count === 1 ? 30000 : count === 2 ? 60000 : 10000);

if (provider === "codex") {
  console.log(JSON.stringify({ type: "thread.started", thread_id: sessionId }));
  console.log(JSON.stringify({ type: "token_count", model_context_window: 100000, last_token_usage: { input_tokens: inputTokens } }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: `mock codex ${count}` } }));
} else {
  console.log(JSON.stringify({
    type: "stream_event",
    event: {
      type: "message_start",
      message: {
        model: "claude-test",
        usage: { input_tokens: inputTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      }
    }
  }));
  console.log(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: `mock claude ${count}` } } }));
  console.log(JSON.stringify({ type: "result", session_id: sessionId, result: `mock claude ${count}`, modelUsage: { "claude-test": { contextWindow: 100000 } } }));
}
