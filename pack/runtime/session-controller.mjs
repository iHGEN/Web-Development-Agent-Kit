#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";

const DEFAULT_THRESHOLD = 50;
const DEFAULT_MAX_CYCLES = 100;
const DEFAULT_TELEMETRY_FALLBACK_CYCLES = 2;
const SUPPORTED_PROVIDERS = new Set(["codex", "claude"]);

function nowIso() { return new Date().toISOString(); }
function posix(value) { return value.split(path.sep).join("/"); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}
function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
function getArg(args, name) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name) return args[i + 1] ?? null;
    if (args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
  }
  return null;
}
function hasArg(args, name) { return args.some((arg) => arg === name || arg.startsWith(`${name}=`)); }
function promptFromArgs(args) {
  const explicit = getArg(args, "--prompt");
  if (explicit !== null) return explicit;
  const promptFile = getArg(args, "--prompt-file");
  if (promptFile) return fs.readFileSync(path.resolve(promptFile), "utf8");
  const marker = args.indexOf("--");
  if (marker >= 0 && marker < args.length - 1) return args.slice(marker + 1).join(" ");
  return "";
}
function sha12(text) { return crypto.createHash("sha256").update(text).digest("hex").slice(0, 12); }
function taskIdFor(prompt) {
  const stamp = nowIso().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `ctx-${stamp}-${sha12(prompt)}`;
}
function commandExists(command) {
  const tool = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(tool, [command], { stdio: "ignore", windowsHide: true });
  return !result.error && result.status === 0;
}
function npmGlobalRoot() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["root", "-g"], { encoding: "utf8", windowsHide: true });
  return !result.error && result.status === 0 ? String(result.stdout || "").trim() : "";
}
function packagePath(root, packageName) {
  return path.join(root, ...packageName.split("/"));
}
function resolvePackageBin(project, packageName, binName) {
  const roots = [path.join(project, "node_modules")];
  const globalRoot = npmGlobalRoot();
  if (globalRoot) roots.push(globalRoot);
  if (process.platform === "win32" && process.env.APPDATA) roots.push(path.join(process.env.APPDATA, "npm", "node_modules"));

  for (const root of [...new Set(roots)]) {
    const pkgDir = packagePath(root, packageName);
    const manifestPath = path.join(pkgDir, "package.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath, {});
    let rel = null;
    if (typeof manifest.bin === "string") rel = manifest.bin;
    else if (manifest.bin && typeof manifest.bin === "object") rel = manifest.bin[binName] || Object.values(manifest.bin)[0];
    if (!rel) continue;
    const entry = path.resolve(pkgDir, rel);
    if (fs.existsSync(entry)) return { command: process.execPath, prefixArgs: [entry], source: `${packageName} npm package` };
  }
  return null;
}
function resolveProvider(provider, project) {
  const defs = {
    codex: { packageName: "@openai/codex", binName: "codex", env: "WEB_KIT_CODEX_BIN" },
    claude: { packageName: "@anthropic-ai/claude-code", binName: "claude", env: "WEB_KIT_CLAUDE_BIN" },
  };
  const def = defs[provider];
  const override = process.env[def.env];
  if (override) {
    const resolved = path.resolve(override);
    if (/\.(?:mjs|cjs|js)$/i.test(resolved)) return { command: process.execPath, prefixArgs: [resolved], source: def.env };
    return { command: override, prefixArgs: [], source: def.env };
  }

  const packageBin = resolvePackageBin(project, def.packageName, def.binName);
  if (packageBin) return packageBin;

  const candidates = process.platform === "win32" ? [`${def.binName}.exe`, def.binName] : [def.binName];
  for (const candidate of candidates) if (commandExists(candidate)) return { command: candidate, prefixArgs: [], source: "PATH" };
  return null;
}

function walkObject(value, visitor, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) walkObject(item, visitor, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  visitor(value);
  for (const child of Object.values(value)) walkObject(child, visitor, depth + 1);
}
function numeric(obj, ...keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}
function usageInputTokens(usage) {
  if (!usage || typeof usage !== "object") return null;
  const direct = numeric(usage, "input_tokens", "inputTokens");
  const cacheRead = numeric(usage, "cache_read_input_tokens", "cacheReadInputTokens") || 0;
  const cacheCreate = numeric(usage, "cache_creation_input_tokens", "cacheCreationInputTokens") || 0;
  if (direct === null) return null;
  return direct + cacheRead + cacheCreate;
}
function boundedPercent(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

function createTelemetry(provider) {
  return {
    provider,
    sessionId: null,
    finalText: "",
    contextPercent: null,
    contextWindow: null,
    contextInputTokens: null,
    contextSource: null,
    lastClaudeInputTokens: null,
    lastClaudeModel: null,
    claudeModelWindows: new Map(),
  };
}
function updateTelemetry(telemetry, event) {
  if (!event || typeof event !== "object") return;
  if (typeof event.thread_id === "string") telemetry.sessionId = event.thread_id;
  if (typeof event.session_id === "string") telemetry.sessionId = event.session_id;
  if (event.type === "result" && typeof event.result === "string") telemetry.finalText = event.result;

  if (telemetry.provider === "codex") {
    if (event.type === "item.completed" && event.item && typeof event.item === "object") {
      const item = event.item;
      if (["agent_message", "assistant_message", "message"].includes(item.type) && typeof item.text === "string") telemetry.finalText = item.text;
    }
    walkObject(event, (obj) => {
      const pct = numeric(obj?.context_window, "used_percentage") ?? numeric(obj, "context_used_percent", "context_used_percentage");
      if (pct !== null) {
        telemetry.contextPercent = boundedPercent(pct);
        telemetry.contextSource = "codex-provider-percent";
      }
      const window = numeric(obj, "model_context_window", "context_window_size", "contextWindow");
      const usage = obj.last_token_usage || obj.lastTokenUsage || obj.current_usage;
      const input = usageInputTokens(usage);
      if (window && input !== null) {
        telemetry.contextWindow = window;
        telemetry.contextInputTokens = input;
        telemetry.contextPercent = boundedPercent((input / window) * 100);
        telemetry.contextSource = "codex-last-token-usage";
      }
    });
  }

  if (telemetry.provider === "claude") {
    if (event.type === "stream_event" && event.event?.type === "message_start") {
      const msg = event.event.message || {};
      const input = usageInputTokens(msg.usage);
      if (input !== null) telemetry.lastClaudeInputTokens = input;
      if (typeof msg.model === "string") telemetry.lastClaudeModel = msg.model;
    }
    if (event.type === "result" && event.modelUsage && typeof event.modelUsage === "object") {
      for (const [model, usage] of Object.entries(event.modelUsage)) {
        const window = numeric(usage, "contextWindow", "context_window");
        if (window) telemetry.claudeModelWindows.set(model, window);
      }
    }
    walkObject(event, (obj) => {
      const pct = numeric(obj?.context_window, "used_percentage");
      if (pct !== null) {
        telemetry.contextPercent = boundedPercent(pct);
        telemetry.contextSource = "claude-provider-percent";
      }
    });
    const window = telemetry.claudeModelWindows.get(telemetry.lastClaudeModel)
      || (telemetry.claudeModelWindows.size === 1 ? [...telemetry.claudeModelWindows.values()][0] : null);
    if (window && telemetry.lastClaudeInputTokens !== null) {
      telemetry.contextWindow = window;
      telemetry.contextInputTokens = telemetry.lastClaudeInputTokens;
      telemetry.contextPercent = boundedPercent((telemetry.lastClaudeInputTokens / window) * 100);
      telemetry.contextSource = "claude-message-start+modelUsage";
    }
  }
}
function printableEvent(provider, event) {
  if (provider === "codex" && event?.type === "item.completed" && event.item && ["agent_message", "assistant_message", "message"].includes(event.item.type)) {
    return typeof event.item.text === "string" ? event.item.text : "";
  }
  if (provider === "claude" && event?.type === "stream_event" && event.event?.type === "content_block_delta" && event.event.delta?.type === "text_delta") {
    return typeof event.event.delta.text === "string" ? event.event.delta.text : "";
  }
  return "";
}

function providerArgs(provider, project, prompt, sessionId) {
  if (provider === "codex") {
    return sessionId
      ? ["exec", "resume", sessionId, "--json", "-C", project, prompt]
      : ["exec", "--json", "-C", project, prompt];
  }
  return sessionId
    ? ["-p", "--resume", sessionId, prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "auto"]
    : ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "auto"];
}

async function runProvider(provider, executable, project, prompt, sessionId, verbose) {
  const telemetry = createTelemetry(provider);
  const args = [...executable.prefixArgs, ...providerArgs(provider, project, prompt, sessionId)];
  const child = spawn(executable.command, args, {
    cwd: project,
    env: { ...process.env, WEB_KIT_SESSION_CONTROLLER: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderr = "";
  let printedClaudeDelta = false;
  const stdoutRl = readline.createInterface({ input: child.stdout });
  stdoutRl.on("line", (line) => {
    let event = null;
    try { event = JSON.parse(line); }
    catch {
      if (verbose) process.stdout.write(`${line}\n`);
      return;
    }
    updateTelemetry(telemetry, event);
    const text = printableEvent(provider, event);
    if (text) {
      if (provider === "claude") {
        process.stdout.write(text);
        printedClaudeDelta = true;
      } else process.stdout.write(`\n${text}\n`);
    } else if (verbose) process.stdout.write(`[${provider}] ${line}\n`);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    if (verbose) process.stderr.write(text);
  });

  const exitCode = await new Promise((resolve) => {
    child.once("error", () => resolve(127));
    child.once("close", (code) => resolve(code ?? 1));
  });
  if (printedClaudeDelta) process.stdout.write("\n");
  return { exitCode, stderr, telemetry };
}

function findFileByNameFragment(root, fragment, limit = 10000) {
  if (!root || !fs.existsSync(root)) return null;
  const stack = [root];
  let seen = 0;
  while (stack.length && seen < limit) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      seen += 1;
      if (seen >= limit) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.includes(fragment) && entry.name.endsWith(".jsonl")) return full;
    }
  }
  return null;
}
function tailText(file, maxBytes = 2 * 1024 * 1024) {
  const stat = fs.statSync(file);
  const length = Math.min(maxBytes, stat.size);
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, stat.size - length);
    return buffer.toString("utf8");
  } finally { fs.closeSync(fd); }
}
function codexRolloutTelemetry(sessionId) {
  if (!sessionId) return null;
  const codexHome = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), ".codex");
  const file = findFileByNameFragment(path.join(codexHome, "sessions"), sessionId);
  if (!file) return null;
  const lines = tailText(file).split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); }
    catch { continue; }
    let found = null;
    walkObject(event, (obj) => {
      if (found) return;
      const window = numeric(obj, "model_context_window", "context_window_size", "contextWindow");
      const usage = obj.last_token_usage || obj.lastTokenUsage;
      const input = usageInputTokens(usage);
      if (window && input !== null) found = { percent: boundedPercent((input / window) * 100), window, input, source: "codex-rollout-token-count" };
    });
    if (found) return found;
  }
  return null;
}

function gitSnapshot(project) {
  const run = (args) => {
    const result = spawnSync("git", args, { cwd: project, encoding: "utf8", windowsHide: true });
    return !result.error && result.status === 0 ? String(result.stdout || "").trim() : "";
  };
  const inside = run(["rev-parse", "--is-inside-work-tree"]) === "true";
  if (!inside) return { is_git_repo: false, status: [], changed_files: [], diff_stat: "" };
  return {
    is_git_repo: true,
    head: run(["rev-parse", "HEAD"]),
    branch: run(["branch", "--show-current"]),
    status: run(["status", "--short"]).split(/\r?\n/).filter(Boolean).slice(0, 200),
    changed_files: run(["diff", "--name-only"]).split(/\r?\n/).filter(Boolean).slice(0, 200),
    diff_stat: run(["diff", "--stat"]).slice(0, 12000),
  };
}

function progressTemplate(taskId, originalPrompt, finalText = "") {
  return {
    schema_version: 1,
    task_id: taskId,
    status: "continue",
    phase: "recovery",
    role: "context-rollover-manager",
    summary: finalText ? finalText.slice(-5000) : "Provider did not write session-progress.json; reconstruct progress from current repository state.",
    completed_steps: [],
    current_step: "Reconstruct the current Web-Kit workflow position from source, diff, tests, and existing state.",
    pending_steps: [],
    files_changed: [],
    validation_completed: [],
    validation_pending: ["Verify actual repository state before continuing."],
    decisions: [],
    constraints: ["Preserve the original request.", "Repository source/diff/tests/runtime are authoritative."],
    next_action: "Inspect current repository state, restore workflow progress, then continue the original request one safe unit at a time.",
    original_request_hash: sha12(originalPrompt),
    updated_at: nowIso(),
    recovered_by_controller: true,
  };
}
function validateProgress(progress, taskId) {
  const errors = [];
  if (!progress || typeof progress !== "object") return ["progress is not an object"];
  if (progress.task_id !== taskId) errors.push(`task_id must be ${taskId}`);
  if (!new Set(["continue", "done", "blocked"]).has(progress.status)) errors.push("status must be continue, done, or blocked");
  if (typeof progress.summary !== "string" || !progress.summary.trim()) errors.push("summary is required");
  if (progress.status === "continue" && (typeof progress.next_action !== "string" || !progress.next_action.trim())) errors.push("next_action is required while status=continue");
  return errors;
}
function buildHandoff({ taskId, provider, sessionId, threshold, observedPercent, contextSource, originalPrompt, progress, project, cycle, reason }) {
  return {
    schema_version: 1,
    status: "pending",
    task_id: taskId,
    provider,
    from_session_id: sessionId || null,
    rollover_reason: reason,
    threshold_percent: threshold,
    observed_context_percent: observedPercent,
    context_telemetry_source: contextSource || null,
    cycle,
    original_request: originalPrompt,
    progress,
    repository: gitSnapshot(project),
    next_action: progress.next_action || "Verify repository state and continue the original request.",
    authority: "Current repository source, diff, tests/build, and runtime evidence override this handoff summary.",
    created_at: nowIso(),
  };
}
function validateHandoff(handoff) {
  const errors = [];
  for (const key of ["task_id", "provider", "rollover_reason", "original_request", "progress", "repository", "next_action", "created_at"]) {
    if (handoff[key] === undefined || handoff[key] === null || handoff[key] === "") errors.push(`missing ${key}`);
  }
  if (handoff.status !== "pending") errors.push("handoff status must be pending");
  if (handoff.progress?.status !== "continue") errors.push("handoff progress must be continue");
  return errors;
}
function writeHandoff(project, handoff) {
  const stateDir = path.join(project, ".agent-core", "state");
  const current = path.join(stateDir, "context-handoff.json");
  const archive = path.join(stateDir, "handoffs", `${handoff.task_id}-${String(handoff.cycle).padStart(3, "0")}.json`);
  atomicWriteJson(current, handoff);
  atomicWriteJson(archive, handoff);
  return { current, archive };
}
function markHandoffConsumed(file, sessionId) {
  const handoff = readJson(file, null);
  if (!handoff || handoff.status !== "pending") return;
  handoff.status = "consumed";
  handoff.consumed_by_session_id = sessionId || null;
  handoff.consumed_at = nowIso();
  atomicWriteJson(file, handoff);
}

function progressProtocol(taskId) {
  return `Before your final response in every controller cycle, atomically write \`.agent-core/state/session-progress.json\` as JSON with this shape:\n\n{\n  "schema_version": 1,\n  "task_id": "${taskId}",\n  "status": "continue | done | blocked",\n  "phase": "current Web-Kit phase",\n  "role": "current routed role",\n  "summary": "compact evidence-backed summary of what this cycle completed",\n  "completed_steps": [],\n  "current_step": "current/just-completed step",\n  "pending_steps": [],\n  "files_changed": [],\n  "validation_completed": [],\n  "validation_pending": [],\n  "decisions": [],\n  "constraints": [],\n  "next_action": "exact next safe action, required when status=continue",\n  "updated_at": "ISO-8601 timestamp"\n}\n\nUse status=done only when the original user request has passed the required Web-Kit final validation. Use status=blocked only when progress genuinely requires user input/permission. Otherwise use status=continue.`;
}
function initialPrompt(taskId, originalPrompt) {
  return `You are operating under the iHGEN Web Kit automatic Session Controller.\n\nOriginal user request:\n${originalPrompt}\n\nFollow the repository's existing AGENTS/CLAUDE instructions and the canonical \`.agent-core/rules/workflow.md\`. Execute exactly ONE safe Web-Kit workflow unit in this controller cycle: one discovery/planning/validation phase, or one approved implementation step plus its required local checks/Graph Refresh Gate/handoff. A small request may finish in one unit if that unit legitimately reaches final validation. Do not batch multiple independent implementation steps merely to finish in one process.\n\n${progressProtocol(taskId)}\n\nThe Session Controller owns context rollover. Do not run /clear, /new, or /compact to manage this controlled session. When the controller reaches its context threshold it will persist a handoff and start a fresh provider process automatically.`;
}
function continuePrompt(taskId) {
  return `Continue the same original task under the Web Kit Session Controller. Read \`.agent-core/state/session-progress.json\`, verify any material claims against current repository source/diff/tests, and execute exactly the NEXT single safe Web-Kit workflow unit.\n\n${progressProtocol(taskId)}\n\nDo not run /clear, /new, or /compact; the controller owns context rollover.`;
}
function rolloverPrompt(taskId, handoff) {
  return `A Web Kit Session Controller context rollover just created this fresh provider session.\n\nRead \`.agent-core/state/context-handoff.json\` first. The handoff below is routing evidence, not source of truth. Verify current source/diff/tests/runtime before relying on it. Resume the exact original task at the recorded next action and execute exactly ONE safe workflow unit.\n\nHANDOFF:\n${JSON.stringify(handoff, null, 2)}\n\n${progressProtocol(taskId)}\n\nDo not reconstruct unrelated history. Do not run /clear, /new, or /compact; the controller owns future rollovers.`;
}

async function main() {
  const args = process.argv.slice(2);
  if (hasArg(args, "--help") || hasArg(args, "-h")) {
    console.log(`Usage:\n  node .agent-core/bin/session-controller.mjs --provider <codex|claude> --prompt "<task>" [options]\n\nOptions:\n  --project <path>                    Project root (default: .)\n  --provider <codex|claude>           AI CLI provider\n  --prompt <text>                     Original task\n  --prompt-file <path>                Read original task from file\n  --threshold <percent>               Rollover threshold (default: 50)\n  --max-cycles <n>                    Safety cap (default: 100)\n  --telemetry-fallback-cycles <n>     Force a conservative rollover after N telemetry-missing cycles (default: 2)\n  --task-id <id>                      Override generated task id\n  --verbose                           Show raw provider JSON/stderr\n\nThe controller uses provider headless/structured mode. It resumes the provider session below threshold and launches a fresh provider process after a validated context handoff at/above the threshold.`);
    return 0;
  }

  const project = path.resolve(getArg(args, "--project") || ".");
  const provider = String(getArg(args, "--provider") || args.find((arg) => SUPPORTED_PROVIDERS.has(arg)) || "").toLowerCase();
  const originalPrompt = promptFromArgs(args).trim();
  const threshold = clampNumber(getArg(args, "--threshold"), DEFAULT_THRESHOLD, 10, 90);
  const maxCycles = Math.floor(clampNumber(getArg(args, "--max-cycles"), DEFAULT_MAX_CYCLES, 1, 1000));
  const telemetryFallbackCycles = Math.floor(clampNumber(getArg(args, "--telemetry-fallback-cycles"), DEFAULT_TELEMETRY_FALLBACK_CYCLES, 1, 100));
  const verbose = hasArg(args, "--verbose");

  if (!SUPPORTED_PROVIDERS.has(provider)) throw new Error(`Unsupported provider: ${provider || "(missing)"}. Supported: codex, claude.`);
  if (!originalPrompt) throw new Error("Missing task prompt. Use --prompt, --prompt-file, or place the prompt after --.");
  if (!fs.existsSync(path.join(project, ".agent-core", "rules", "workflow.md"))) throw new Error("Web Kit is not installed in this project. Run `npx @ihgen/web-kit` first.");

  const executable = resolveProvider(provider, project);
  if (!executable) throw new Error(`${provider} CLI was not found. Install/authenticate that AI CLI first, then retry.`);

  const taskId = getArg(args, "--task-id") || taskIdFor(originalPrompt);
  const stateDir = path.join(project, ".agent-core", "state");
  const controllerStateFile = path.join(stateDir, "session-controller.json");
  const progressFile = path.join(stateDir, "session-progress.json");
  const handoffFile = path.join(stateDir, "context-handoff.json");
  fs.mkdirSync(stateDir, { recursive: true });

  let sessionId = null;
  let nextPrompt = initialPrompt(taskId, originalPrompt);
  let cycle = 0;
  let rollovers = 0;
  let telemetryMissingStreak = 0;
  let activePendingHandoff = false;

  atomicWriteJson(controllerStateFile, {
    schema_version: 1,
    task_id: taskId,
    provider,
    status: "running",
    threshold_percent: threshold,
    max_cycles: maxCycles,
    cycle: 0,
    rollovers: 0,
    provider_session_id: null,
    original_request_hash: sha12(originalPrompt),
    provider_executable_source: executable.source,
    started_at: nowIso(),
    updated_at: nowIso(),
  });

  console.log(`\nWeb Kit Automatic Session Controller\nProvider: ${provider}\nTask: ${taskId}\nContext rollover threshold: ${threshold}%\nProvider resolution: ${executable.source}\n`);

  while (cycle < maxCycles) {
    cycle += 1;
    console.log(`\n── Controller cycle ${cycle}${sessionId ? ` · resume ${sessionId}` : " · fresh context"} ──\n`);
    const run = await runProvider(provider, executable, project, nextPrompt, sessionId, verbose);
    if (run.exitCode !== 0) {
      const state = readJson(controllerStateFile, {});
      Object.assign(state, { status: "provider_error", cycle, provider_session_id: sessionId, provider_exit_code: run.exitCode, provider_stderr: run.stderr.slice(-8000), updated_at: nowIso() });
      atomicWriteJson(controllerStateFile, state);
      console.error(`\n${provider} exited with code ${run.exitCode}. Controller state was saved.`);
      return run.exitCode || 1;
    }

    const telemetry = run.telemetry;
    if (!telemetry.contextPercent && provider === "codex") {
      const fallback = codexRolloutTelemetry(telemetry.sessionId || sessionId);
      if (fallback) {
        telemetry.contextPercent = fallback.percent;
        telemetry.contextWindow = fallback.window;
        telemetry.contextInputTokens = fallback.input;
        telemetry.contextSource = fallback.source;
      }
    }
    if (telemetry.sessionId) sessionId = telemetry.sessionId;

    let progress = readJson(progressFile, null);
    let progressErrors = validateProgress(progress, taskId);
    if (progressErrors.length) {
      console.warn(`Session progress protocol recovery: ${progressErrors.join("; ")}`);
      progress = progressTemplate(taskId, originalPrompt, telemetry.finalText);
      atomicWriteJson(progressFile, progress);
      progressErrors = validateProgress(progress, taskId);
      if (progressErrors.length) throw new Error(`Unable to recover session progress: ${progressErrors.join("; ")}`);
    }

    if (activePendingHandoff) {
      markHandoffConsumed(handoffFile, sessionId);
      activePendingHandoff = false;
    }

    const pct = telemetry.contextPercent;
    if (pct === null || pct === undefined) telemetryMissingStreak += 1;
    else telemetryMissingStreak = 0;

    const state = readJson(controllerStateFile, {});
    Object.assign(state, {
      status: progress.status === "done" ? "done" : progress.status === "blocked" ? "blocked" : "running",
      cycle,
      rollovers,
      provider_session_id: sessionId,
      last_context_percent: pct ?? null,
      last_context_window: telemetry.contextWindow ?? null,
      last_context_input_tokens: telemetry.contextInputTokens ?? null,
      context_telemetry_source: telemetry.contextSource ?? null,
      current_phase: progress.phase || null,
      current_role: progress.role || null,
      next_action: progress.next_action || null,
      updated_at: nowIso(),
    });
    atomicWriteJson(controllerStateFile, state);

    console.log(`\nCycle ${cycle} result: ${progress.status}`);
    console.log(`Context: ${pct === null || pct === undefined ? "telemetry unavailable" : `${pct.toFixed(1)}%`} ${telemetry.contextSource ? `(${telemetry.contextSource})` : ""}`);
    if (progress.summary) console.log(`Summary: ${progress.summary.slice(0, 1200)}`);

    if (progress.status === "done") {
      console.log(`\n✓ Original task completed. Total context rollovers: ${rollovers}.`);
      return 0;
    }
    if (progress.status === "blocked") {
      console.log("\nController stopped because the active AI reported a genuine user/permission dependency. State is preserved for resume.");
      return 4;
    }

    const thresholdReached = pct !== null && pct !== undefined && pct >= threshold;
    const telemetrySafetyRollover = (pct === null || pct === undefined) && telemetryMissingStreak >= telemetryFallbackCycles;
    if (thresholdReached || telemetrySafetyRollover) {
      const reason = thresholdReached ? "context-threshold" : "telemetry-unavailable-safety";
      const handoff = buildHandoff({ taskId, provider, sessionId, threshold, observedPercent: pct ?? null, contextSource: telemetry.contextSource, originalPrompt, progress, project, cycle, reason });
      const handoffErrors = validateHandoff(handoff);
      if (handoffErrors.length) throw new Error(`Context handoff validation failed: ${handoffErrors.join("; ")}`);
      const paths = writeHandoff(project, handoff);
      rollovers += 1;
      telemetryMissingStreak = 0;
      console.log(`\n↻ Context rollover ${rollovers}: ${reason}.`);
      console.log(`Validated handoff: ${posix(path.relative(project, paths.current))}`);
      console.log("Starting a fresh AI process automatically; no /clear or /new input is required.");
      sessionId = null;
      nextPrompt = rolloverPrompt(taskId, handoff);
      activePendingHandoff = true;
      const nextState = readJson(controllerStateFile, {});
      Object.assign(nextState, { rollovers, provider_session_id: null, last_rollover_reason: reason, last_handoff: posix(path.relative(project, paths.current)), updated_at: nowIso() });
      atomicWriteJson(controllerStateFile, nextState);
      await sleep(150);
      continue;
    }

    nextPrompt = continuePrompt(taskId);
  }

  const state = readJson(controllerStateFile, {});
  Object.assign(state, { status: "max_cycles_reached", cycle, rollovers, updated_at: nowIso() });
  atomicWriteJson(controllerStateFile, state);
  console.error(`Maximum controller cycles (${maxCycles}) reached before status=done.`);
  return 5;
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(`Session Controller error: ${error.message}`);
  process.exitCode = 1;
});
