#!/usr/bin/env node
// Mock only: a separate Codex CLI process, not actual model inference.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const mode = process.env.WEB_KIT_TEST_STANDALONE_MODE || "success";
const reportFile = process.env.WEB_KIT_TEST_STANDALONE_OBSERVATION;
const project = process.cwd();
assert.equal(args[0], "exec");
assert(args.includes("--json"), "missing JSON events");
assert(args.includes("--ephemeral"), "reviewer not ephemeral");
assert.equal(args[args.indexOf("--sandbox") + 1], "read-only", "reviewer not read-only");
assert.equal(args[args.indexOf("-C") + 1], project, "reviewer did not receive project root");
assert(!args.includes("resume") && !args.includes("--resume") && !args.includes("--continue"));
assert.equal(process.env.WEB_KIT_STANDALONE_REVIEW_ACTIVE, "1");
assert.equal(process.env.WEB_KIT_CONTEXT_SUPERVISOR_ACTIVE, undefined);
const prompt = args.at(-1);
const taskId = prompt.match(/Task: (changes-review-[a-f0-9-]{36})/)?.[1];
assert(taskId, "review prompt omitted task identity");
const changes = spawnSync("git", ["status", "--short", "--untracked-files=all"], { cwd: project, encoding: "utf8" });
assert.equal(changes.status, 0);
assert(changes.stdout.includes("src/example.js") && changes.stdout.includes("src/untracked.js"),
  "reviewer could not see the selected staged/unstaged/untracked changes");
fs.writeFileSync(reportFile, JSON.stringify({ mode, args, taskId, pid: process.pid,
  changes: changes.stdout, original_task: process.env.WEB_KIT_REVIEW_TASK_ID || null }, null, 2) + "\n");
if (mode === "crash") process.exit(11);
const id = randomUUID();
if (mode !== "no-thread") console.log(JSON.stringify({ type: "thread.started", thread_id: id }));
console.log(JSON.stringify({ type: "turn.started" }));
let report = "Changes review: COMPLETED\nTask: " + taskId +
  "\nExecution: independent fresh Codex CLI session\nSession: " + id +
  "\nSelection: current staged, unstaged and relevant untracked changes" +
  "\nFindings: TEST-ONLY marker, not an actual engineering assessment" +
  "\nCoverage: mock changed files and their simulated callers" +
  "\nChecks: no project checks executed\nGaps: mock provider; no real model inference" +
  "\nPR readiness: not assessed\n";
if (mode === "invalid") report = "All clear, no findings.";
if (mode === "wrong-task") report = report.replace(taskId, "changes-review-" + randomUUID());
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: report } }));
if (mode !== "no-completion") console.log(JSON.stringify({ type: "turn.completed" }));
