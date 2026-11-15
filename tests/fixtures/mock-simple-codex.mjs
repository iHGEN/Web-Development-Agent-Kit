#!/usr/bin/env node
// Test-only stand-in for a fresh Codex CLI. Never invokes a model.
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const cwdIndex = args.indexOf("-C");
const invocation = {
  args,
  project: args[cwdIndex + 1],
  prompt: args.at(-1),
};
if (process.env.WEB_KIT_REVIEW_TEST_CAPTURE) {
  fs.writeFileSync(process.env.WEB_KIT_REVIEW_TEST_CAPTURE, JSON.stringify(invocation));
}
if (process.env.WEB_KIT_REVIEW_TEST_MODE === "error") {
  console.error("Mock Codex provider failed");
  process.exit(7);
}
const emit = value => console.log(JSON.stringify(value));
emit({ type: "thread.started", thread_id: randomUUID() });
if (process.env.WEB_KIT_REVIEW_TEST_MODE === "descendant-stall") {
  // Both processes ignore graceful termination, and the descendant inherits
  // stdout. Killing only the direct CLI leaves the review waiting forever.
  const grandchild = spawn(process.execPath, ["-e",
    'process.on("SIGTERM", () => {}); process.on("SIGINT", () => {}); setInterval(() => {}, 1000);'],
  { stdio: ["ignore", "inherit", "ignore"], windowsHide: true });
  fs.writeFileSync(process.env.WEB_KIT_REVIEW_TEST_DESCENDANT_PID_CAPTURE, String(grandchild.pid));
  process.on("SIGTERM", () => {});
  process.on("SIGINT", () => {});
  setInterval(() => {}, 1000);
} else if (process.env.WEB_KIT_REVIEW_TEST_MODE === "stall") {
  setInterval(() => {}, 1000);
} else {
emit({ type: "item.completed", item: { type: "agent_message", text: "# Changes review\n\nFindings: no confirmed defects in the mock fixture.\nCoverage: selected source.\nGaps: this is a mock, not a real AI review." } });
if (process.env.WEB_KIT_REVIEW_TEST_MODE !== "incomplete") {
  emit({ type: "turn.completed" });
}
if (process.env.WEB_KIT_REVIEW_TEST_MODE === "linger") setInterval(() => {}, 1000);
}
