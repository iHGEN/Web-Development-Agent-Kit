#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const mockProvider = path.join(repo, "tests", "fixtures", "mock-session-provider.mjs");

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
function assert(condition, message) { if (!condition) throw new Error(message); }

function prepareProject(provider) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), `web-kit-${provider}-rollover-`));
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), `${JSON.stringify({ name: `session-${provider}-smoke` }, null, 2)}\n`);
  fs.writeFileSync(path.join(project, "src", "index.js"), "export const value = 1;\n");
  run(process.execPath, [path.join(repo, "scripts", "agent-kit.mjs"), "install", project], { cwd: repo });
  assert(fs.existsSync(path.join(project, ".agent-core", "bin", "session-controller.mjs")), `${provider}: controller not installed`);
  assert(fs.existsSync(path.join(project, ".agent-core", "rules", "context-rollover.md")), `${provider}: rollover rule not installed`);
  assert(fs.existsSync(path.join(project, ".agent-core", "agents", "context-rollover-manager.md")), `${provider}: rollover agent not installed`);
  return project;
}

function verify(provider, project, expectedPercent) {
  const stateDir = path.join(project, ".agent-core", "state");
  const controller = readJson(path.join(stateDir, "session-controller.json"));
  const handoff = readJson(path.join(stateDir, "context-handoff.json"));
  const calls = fs.readFileSync(path.join(stateDir, `mock-${provider}-calls.jsonl`), "utf8").trim().split(/\r?\n/).map(JSON.parse);

  assert(controller.status === "done", `${provider}: controller status ${controller.status}`);
  assert(controller.rollovers === 1, `${provider}: expected one rollover, got ${controller.rollovers}`);
  if (provider === "codex") {
    assert(controller.provider_options?.sandbox === "workspace-write", "codex: default sandbox must be workspace-write");
    assert(controller.provider_options?.approval === "never", "codex: default approval must be never");
    assert(controller.provider_options?.sandbox !== "danger-full-access", "codex: controller silently selected danger-full-access");
  } else {
    assert(controller.provider_options?.permission_mode === "auto", "claude: default permission mode must be auto");
    assert(controller.provider_options?.permission_mode !== "bypassPermissions", "claude: controller silently selected bypassPermissions");
  }
  assert(handoff.status === "consumed", `${provider}: handoff was not consumed`);
  assert(handoff.rollover_reason === "context-threshold", `${provider}: wrong rollover reason`);
  assert(Math.round(handoff.observed_context_percent) === expectedPercent, `${provider}: expected ${expectedPercent}% context, got ${handoff.observed_context_percent}`);
  assert(handoff.from_session_id === `${provider}-session-1`, `${provider}: wrong old session`);
  assert(handoff.consumed_by_session_id === `${provider}-session-2`, `${provider}: fresh session did not consume handoff`);
  assert(calls.length === 3, `${provider}: expected 3 provider processes, got ${calls.length}`);
  assert(calls[0].isResume === false, `${provider}: first cycle should be fresh`);
  assert(calls[1].isResume === true, `${provider}: second cycle should resume same context below threshold`);
  assert(calls[2].isResume === false, `${provider}: third cycle should be a genuinely fresh context after rollover`);
  const archiveDir = path.join(stateDir, "handoffs");
  assert(fs.existsSync(archiveDir) && fs.readdirSync(archiveDir).some((name) => name.includes(`smoke-${provider}`)), `${provider}: archived handoff missing`);
}

for (const provider of ["codex", "claude"]) {
  const project = prepareProject(provider);
  const envName = provider === "codex" ? "WEB_KIT_CODEX_BIN" : "WEB_KIT_CLAUDE_BIN";
  const result = run(process.execPath, [
    path.join(project, ".agent-core", "bin", "session-controller.mjs"),
    "--project", project,
    "--provider", provider,
    "--threshold", "50",
    "--max-cycles", "6",
    "--task-id", `smoke-${provider}`,
    "--prompt", `Implement the ${provider} smoke task`
  ], {
    cwd: project,
    env: { ...process.env, [envName]: mockProvider, WEB_KIT_TEST_PROVIDER: provider }
  });
  process.stdout.write(result.stdout || "");
  verify(provider, project, provider === "codex" ? 55 : 60);
}

console.log("Automatic Session Controller smoke: PASS");

// CI-only branch trigger; not intended for merge.
