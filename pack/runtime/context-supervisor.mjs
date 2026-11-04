#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readReviewTransition, startReviewTransition, finishReviewTransition, failReviewTransition } from "./task-handoff.mjs";

const SUPPORTED = new Set(["codex", "claude"]);
const PASS_THROUGH_CODEX = new Set(["exec", "login", "logout", "mcp", "completion", "debug", "apply", "cloud", "app-server", "features", "sandbox", "help"]);
const PASS_THROUGH_CLAUDE = new Set(["update", "mcp", "doctor", "install", "setup-token"]);
const CODEX_VALUE_FLAGS = new Set(["-m", "--model", "-c", "--config", "-p", "--profile", "-C", "--cd", "-s", "--sandbox", "-a", "--ask-for-approval", "-i", "--image", "--add-dir", "--local-provider", "--enable", "--disable", "--remote", "--remote-auth-token-env", "-P", "--permission-profile"]);
const CLAUDE_VALUE_FLAGS = new Set([
  "--model", "--permission-mode", "--settings", "--add-dir", "--allowedTools", "--disallowedTools",
  "--mcp-config", "--agent", "--agents", "--system-prompt", "--system-prompt-file", "--append-system-prompt",
  "--append-system-prompt-file", "--plugin-dir", "--plugin-url", "--tools", "--output-format", "--input-format",
  "--max-turns", "--session-id", "--teammate-mode",
  "--effort", "--setting-sources", "--fallback-model", "--permission-prompt-tool", "--allowed-tools", "--disallowed-tools",
]);

function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}
function encodeJson(value) { return Buffer.from(JSON.stringify(value), "utf8").toString("base64"); }
function shellLikeExecutable(file) { return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(file); }
function webKitHome() { return path.resolve(process.env.WEB_KIT_HOME || path.join(os.homedir(), ".web-kit")); }
function shimBin() { return path.join(webKitHome(), "bin"); }
function bridgeFile() { return path.join(webKitHome(), "provider-bridge.mjs"); }

function findProjectRoot(start) {
  let current = path.resolve(start);
  while (true) {
    const cfg = path.join(current, ".agent-kit.json");
    if (fs.existsSync(cfg)) {
      const data = readJson(cfg, {});
      if (data.kit === "web-dev-agent-kit") return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function candidateExtensions(name) {
  if (process.platform !== "win32") return [name];
  const ext = path.extname(name);
  if (ext) return [name];
  const pathext = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  return [name, ...pathext.map((suffix) => `${name}${suffix.toLowerCase()}`), ...pathext.map((suffix) => `${name}${suffix.toUpperCase()}`)];
}

function resolveRealProvider(provider) {
  const override = process.env[provider === "codex" ? "WEB_KIT_REAL_CODEX_BIN" : "WEB_KIT_REAL_CLAUDE_BIN"];
  if (override) return path.resolve(override);
  const excluded = path.resolve(shimBin()).toLowerCase();
  for (const dir of String(process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    let resolvedDir;
    try { resolvedDir = path.resolve(dir); } catch { continue; }
    if (resolvedDir.toLowerCase() === excluded) continue;
    for (const name of candidateExtensions(provider)) {
      const candidate = path.join(resolvedDir, name);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  }
  return null;
}

function firstCommandToken(args, valueFlags) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") return args[i + 1] || null;
    if (arg.startsWith("-")) {
      if (valueFlags.has(arg) && i + 1 < args.length) i += 1;
      continue;
    }
    return arg;
  }
  return null;
}

function shouldPassThrough(provider, args) {
  if (args.some((arg) => ["--help", "-h", "--version", "-V"].includes(arg))) return true;
  if (provider === "claude" && args.some((arg) => ["-p", "--print"].includes(arg))) return true;
  const first = firstCommandToken(args, provider === "codex" ? CODEX_VALUE_FLAGS : CLAUDE_VALUE_FLAGS);
  if (!first) return false;
  if (provider === "codex") return PASS_THROUGH_CODEX.has(first);
  return PASS_THROUGH_CLAUDE.has(first);
}

function resolveNodeScriptFromCmd(file) {
  if (process.platform !== "win32" || !/\.cmd$/i.test(file)) return null;
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); }
  catch { return null; }
  const matches = [...text.matchAll(/"([^"\r\n]+\.(?:mjs|cjs|js))"/gi)];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    let candidate = matches[i][1];
    const base = `${path.dirname(file)}${path.sep}`;
    candidate = candidate.replace(/%~?dp0%?/ig, base);
    if (!path.isAbsolute(candidate)) candidate = path.resolve(path.dirname(file), candidate);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

function providerLaunch(file, args) {
  if (/\.(?:mjs|cjs|js)$/i.test(file)) {
    return { command: process.execPath, args: [file, ...args], shell: false };
  }
  const nodeScript = resolveNodeScriptFromCmd(file);
  if (nodeScript) {
    return { command: process.execPath, args: [nodeScript, ...args], shell: false };
  }
  return { command: file, args, shell: shellLikeExecutable(file) };
}

function spawnProvider(file, args, options = {}) {
  const launch = providerLaunch(file, args);
  return spawn(launch.command, launch.args, {
    windowsHide: true,
    shell: launch.shell,
    ...options,
  });
}

function spawnProviderSync(file, args, options = {}) {
  const launch = providerLaunch(file, args);
  return spawnSync(launch.command, launch.args, {
    windowsHide: true,
    shell: launch.shell,
    ...options,
  });
}

async function passThrough(real, args) {
  const child = spawnProvider(real, args, { stdio: "inherit", env: { ...process.env, WEB_KIT_CONTEXT_SUPERVISOR_BYPASS: "1" } });
  return await new Promise((resolve) => {
    child.once("error", () => resolve(127));
    child.once("close", (code) => resolve(code ?? 1));
  });
}

function parseCodexNotifyArray(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) && parsed.length ? parsed.map(String) : null;
  } catch { return null; }
}

function readCodexConfigNotify() {
  const home = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), ".codex");
  const file = path.join(home, "config.toml");
  if (!fs.existsSync(file)) return null;
  try {
    const text = fs.readFileSync(file, "utf8");
    const match = text.match(/^\s*notify\s*=\s*(\[[^\r\n]*\])\s*$/m);
    return match ? parseCodexNotifyArray(match[1]) : null;
  } catch { return null; }
}

function extractCodexNotify(args) {
  let original = null;
  const clean = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === "-c" || arg === "--config") && i + 1 < args.length) {
      const value = args[i + 1];
      if (String(value).startsWith("notify=")) {
        original = parseCodexNotifyArray(String(value).slice("notify=".length)) || original;
        i += 1;
        continue;
      }
      clean.push(arg, value);
      i += 1;
      continue;
    }
    if ((arg.startsWith("-c=") || arg.startsWith("--config=")) && arg.includes("notify=")) {
      const value = arg.slice(arg.indexOf("notify=") + "notify=".length);
      original = parseCodexNotifyArray(value) || original;
      continue;
    }
    clean.push(arg);
  }
  return { clean, original: original || readCodexConfigNotify() };
}

function sanitizeCodexFreshArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") break;
    // Identity selectors and builder attachments belong to the old conversation.
    if (["--last", "--all", "--fork", "--continue"].includes(arg)) continue;
    if (["--session-id", "-i", "--image"].includes(arg)) { i += 1; continue; }
    if (/^--(?:session-id|image)=/.test(arg)) continue;
    if (arg.startsWith("-")) {
      out.push(arg);
      if (CODEX_VALUE_FLAGS.has(arg) && i + 1 < args.length) out.push(args[++i]);
      continue;
    }
    // Drop resume/fork commands, IDs and positional prompts, but retain policy
    // options that were supplied after them in the original invocation.
  }
  return out;
}

function readSettingsValue(raw, cwd) {
  if (!raw) return {};
  if (String(raw).trim().startsWith("{")) return readJsonText(String(raw), {});
  const file = path.resolve(cwd, String(raw));
  return readJson(file, {});
}

function readJsonText(text, fallback = {}) {
  try { return JSON.parse(text); }
  catch { return fallback; }
}

function extractClaudeSettings(args, cwd) {
  let explicit = null;
  const clean = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--settings" && i + 1 < args.length) {
      explicit = readSettingsValue(args[++i], cwd);
      continue;
    }
    if (arg.startsWith("--settings=")) {
      explicit = readSettingsValue(arg.slice("--settings=".length), cwd);
      continue;
    }
    clean.push(arg);
  }
  return { clean, explicit: explicit || {} };
}

function effectiveClaudeStatusLine(project, explicit) {
  if (explicit?.statusLine) return explicit.statusLine;
  const configHome = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), ".claude");
  const candidates = [
    path.join(project, ".claude", "settings.local.json"),
    path.join(project, ".claude", "settings.json"),
    path.join(configHome, "settings.json"),
  ];
  for (const file of candidates) {
    const data = readJson(file, {});
    if (data.statusLine) return data.statusLine;
  }
  return null;
}

function sanitizeClaudeFreshArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (["-c", "--continue", "--fork-session"].includes(arg)) continue;
    if (["-r", "--resume", "--session-id"].includes(arg)) {
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) i += 1;
      continue;
    }
    if (/^--(?:resume|session-id|continue|fork-session)=/.test(arg)) continue;
    if (arg === "--") break;
    if (arg.startsWith("-")) {
      out.push(arg);
      if (CLAUDE_VALUE_FLAGS.has(arg) && i + 1 < args.length) out.push(args[++i]);
      continue;
    }
    // Positional builder text is not part of the next session.
  }
  return out;
}

function quoteCommandArg(value) {
  const text = String(value);
  if (process.platform === "win32") return `\"${text.replace(/\"/g, '\\\"')}\"`;
  return `'${text.replace(/'/g, `'\"'\"'`)}'`;
}

function prepareInstrumentation(provider, rawArgs, project, supervisorId) {
  const bridge = bridgeFile();
  if (!fs.existsSync(bridge)) throw new Error(`Provider bridge missing: ${bridge}`);
  const env = {
    ...process.env,
    WEB_KIT_CONTEXT_SUPERVISOR_ACTIVE: "1",
    WEB_KIT_PROJECT_ROOT: project,
    WEB_KIT_SUPERVISOR_ID: supervisorId,
    WEB_KIT_PROVIDER_BRIDGE: bridge,
  };

  if (provider === "codex") {
    const { clean, original } = extractCodexNotify(rawArgs);
    const notify = [process.execPath, bridge, "codex-notify"];
    const instrument = ["-c", `notify=${JSON.stringify(notify)}`];
    if (original) env.WEB_KIT_ORIGINAL_CODEX_NOTIFY_B64 = encodeJson(original);
    return {
      initialArgs: [...instrument, ...clean],
      freshBaseArgs: [...instrument, ...sanitizeCodexFreshArgs(clean)],
      env,
      cleanup: () => {},
    };
  }

  const { clean, explicit } = extractClaudeSettings(rawArgs, project);
  const originalStatusLine = effectiveClaudeStatusLine(project, explicit);
  if (originalStatusLine) env.WEB_KIT_ORIGINAL_CLAUDE_STATUSLINE_B64 = encodeJson(originalStatusLine);
  const runtimeDir = path.join(webKitHome(), "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const settingsFile = path.join(runtimeDir, `${supervisorId}-claude-settings.json`);
  const bridgeCommand = `${quoteCommandArg(process.execPath)} ${quoteCommandArg(bridge)} claude-statusline`;
  const idleCommand = `${quoteCommandArg(process.execPath)} ${quoteCommandArg(bridge)} claude-notification`;
  const stopCommand = `${quoteCommandArg(process.execPath)} ${quoteCommandArg(bridge)} claude-stop`;
  const merged = {
    ...explicit,
    hooks: {
      ...(explicit.hooks || {}),
      Notification: [
        ...(Array.isArray(explicit.hooks?.Notification) ? explicit.hooks.Notification : []),
        { matcher: "idle_prompt", hooks: [{ type: "command", command: idleCommand, timeout: 10 }] },
      ],
      Stop: [
        ...(Array.isArray(explicit.hooks?.Stop) ? explicit.hooks.Stop : []),
        { hooks: [{ type: "command", command: stopCommand, timeout: 10 }] },
      ],
    },
    statusLine: {
      type: "command",
      command: bridgeCommand,
      refreshInterval: 1,
    },
  };
  atomicWrite(settingsFile, merged);
  return {
    initialArgs: ["--settings", settingsFile, ...clean],
    freshBaseArgs: ["--settings", settingsFile, ...sanitizeClaudeFreshArgs(clean)],
    env,
    cleanup: () => { try { fs.unlinkSync(settingsFile); } catch {} },
  };
}

function gitSnapshot(project) {
  const run = (args) => {
    const result = spawnSync("git", args, { cwd: project, encoding: "utf8", windowsHide: true });
    return !result.error && result.status === 0 ? String(result.stdout || "").trim() : "";
  };
  if (run(["rev-parse", "--is-inside-work-tree"]) !== "true") return { is_git_repo: false, status: [] };
  return {
    is_git_repo: true,
    head: run(["rev-parse", "HEAD"]),
    branch: run(["branch", "--show-current"]),
    status: run(["status", "--short"]).split(/\r?\n/).filter(Boolean).slice(0, 250),
    changed_files: run(["diff", "--name-only"]).split(/\r?\n/).filter(Boolean).slice(0, 250),
    staged_changed_files: run(["diff", "--cached", "--name-only"]).split(/\r?\n/).filter(Boolean).slice(0, 250),
    diff_stat: run(["diff", "--stat"]).slice(0, 16000),
    staged_diff_stat: run(["diff", "--cached", "--stat"]).slice(0, 16000),
  };
}

function handoffPrompt() {
  return `Prepare a compact context handoff for a fresh AI session. Do NOT modify files, run destructive commands, or continue implementation. Return ONLY one JSON object with these keys:\n{\n  "original_request": "faithful original task/request if recoverable from this session",\n  "summary": "compact evidence-backed summary of work and current state",\n  "current_phase": "current workflow phase",\n  "current_role": "current role",\n  "completed_steps": [],\n  "current_step": "",\n  "pending_steps": [],\n  "decisions": [],\n  "constraints": [],\n  "files_changed": [],\n  "validation_completed": [],\n  "validation_pending": [],\n  "next_action": "exact next safe action"\n}\nDo not include markdown fences. If something is uncertain, say so inside the JSON rather than inventing it.`;
}

function parseJsonObject(text) {
  if (!text) return null;
  const trimmed = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(trimmed); } catch {}
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch {}
  }
  return null;
}

function captureCodexHandoff(real, project, sessionId, env) {
  if (!sessionId) return null;
  const result = spawnProviderSync(real, ["exec", "--json", "--sandbox", "read-only", "-C", project, "resume", sessionId, handoffPrompt()], {
    cwd: project,
    env: { ...env, WEB_KIT_CONTEXT_SUPERVISOR_HANDOFF: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
  });
  if (result.error || result.status !== 0) return null;
  let finalText = "";
  for (const line of String(result.stdout || "").split(/\r?\n/)) {
    const event = readJsonText(line, null);
    if (!event) continue;
    if (event.type === "item.completed" && event.item && ["agent_message", "assistant_message", "message"].includes(event.item.type) && typeof event.item.text === "string") finalText = event.item.text;
  }
  return parseJsonObject(finalText);
}

function captureClaudeHandoff(real, project, sessionId, env) {
  if (!sessionId) return null;
  const args = ["-p", handoffPrompt(), "--resume", sessionId, "--output-format", "json", "--permission-mode", "plan", "--tools", ""];
  const result = spawnProviderSync(real, args, {
    cwd: project,
    env: { ...env, WEB_KIT_CONTEXT_SUPERVISOR_HANDOFF: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
  });
  if (result.error || result.status !== 0) return null;
  const outer = readJsonText(String(result.stdout || "").trim(), null);
  return parseJsonObject(outer?.result || String(result.stdout || ""));
}

function normalizeArray(value) { return Array.isArray(value) ? value.slice(0, 200) : []; }

function buildHandoff(provider, request, generated, project, supervisorId, rolloverIndex) {
  const fallbackRequest = Array.isArray(request.input_messages) && request.input_messages.length ? request.input_messages[0] : "";
  const fallbackSummary = request.last_assistant_message || "The prior provider session reached the configured context threshold. Reconstruct exact progress from repository state before continuing.";
  const handoff = {
    schema_version: 2,
    status: "pending",
    supervisor_id: supervisorId,
    provider,
    from_session_id: request.session_id || null,
    rollover_index: rolloverIndex,
    rollover_reason: request.reason || "context-threshold",
    threshold_percent: request.threshold_percent || 50,
    observed_context_percent: request.used_percentage ?? null,
    context_telemetry_source: request.source || null,
    original_request: typeof generated?.original_request === "string" && generated.original_request.trim() ? generated.original_request : fallbackRequest,
    summary: typeof generated?.summary === "string" && generated.summary.trim() ? generated.summary : fallbackSummary,
    current_phase: generated?.current_phase || null,
    current_role: generated?.current_role || null,
    completed_steps: normalizeArray(generated?.completed_steps),
    current_step: generated?.current_step || null,
    pending_steps: normalizeArray(generated?.pending_steps),
    decisions: normalizeArray(generated?.decisions),
    constraints: normalizeArray(generated?.constraints),
    files_changed: normalizeArray(generated?.files_changed),
    validation_completed: normalizeArray(generated?.validation_completed),
    validation_pending: normalizeArray(generated?.validation_pending),
    next_action: typeof generated?.next_action === "string" && generated.next_action.trim()
      ? generated.next_action
      : "Verify current repository source/diff/tests, reconstruct the exact workflow position, and continue the original task without repeating completed work.",
    repository: gitSnapshot(project),
    authority: "This handoff is routing/state evidence only. Current source, current diff, tests/build, and runtime evidence override it.",
    created_at: nowIso(),
  };
  return handoff;
}

function validateHandoff(handoff) {
  const required = ["supervisor_id", "provider", "rollover_reason", "summary", "next_action", "repository", "created_at"];
  const missing = required.filter((key) => handoff[key] === undefined || handoff[key] === null || handoff[key] === "");
  if (missing.length) throw new Error(`Invalid context handoff; missing: ${missing.join(", ")}`);
}

function writeHandoff(project, supervisorId, rolloverIndex, handoff) {
  const root = path.join(project, ".agent-core", "state", "context-rollover", "handoffs");
  const archived = path.join(root, `${supervisorId}-${String(rolloverIndex).padStart(3, "0")}.json`);
  const latest = path.join(root, `${supervisorId}-latest.json`);
  const compatibility = path.join(project, ".agent-core", "state", "context-handoff.json");
  atomicWrite(archived, handoff);
  atomicWrite(latest, handoff);
  atomicWrite(compatibility, handoff);
  return { archived, latest, compatibility };
}

function freshPrompt(project, handoffPath, handoff) {
  const rel = path.relative(project, handoffPath).split(path.sep).join("/");
  return `Web Kit automatically started a fresh context because the previous ${handoff.provider} context reached ${Math.round(handoff.observed_context_percent ?? handoff.threshold_percent)}%. Read \`${rel}\` first. Treat it as routing/state evidence, verify material claims against current repository source/diff/tests/runtime, do not repeat completed work, and continue the exact recorded next action under the existing Web-Kit workflow. Do not manually /clear, /new, or /compact for this rollover.`;
}

function taskReviewPrompt(project, handoffPath) {
  const rel = path.relative(project, handoffPath).split(path.sep).join("/");
  const taskId = path.basename(path.dirname(handoffPath));
  return `Web Kit started a fresh review session for a new task through the same outer supervisor used for context rollover. Read \`${rel}\` first, then \`.agent-core/rules/changes-review.md\`. This is already the fresh reviewer: do not queue another handoff or resume the builder. Analyze the requested changes and relevant callers without modifying source or existing task/scope/queue records. Your ONE final assistant message MUST be the full plain-text report (no code fence, no introductory text), beginning with "Changes review: COMPLETED" or "Changes review: PARTIAL" or "Changes review: NO CHANGES" or "Changes review: NO SOURCE", then exact lines "Task: ${taskId}", "Execution: fresh native supervisor session", "Session: <native ID or pending>", and nonempty "Selection:", "Findings:", "Coverage:", "Checks:", "Gaps:", plus "PR readiness: not assessed". The native completion hook saves this final message and verifies the report receipt; no model-side report file write or report-ready command is required. The supervisor then stops at the real native completion boundary. Do not continue implementation, fix findings, run project code/tests, or grant code approval.`;
}

async function waitForChildOrRequest(child, requestFile, context) {
  return await new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve(value);
    };
    const requested = () => {
      const request = readJson(requestFile, null);
      if (request?.safe_boundary !== true) return null;
      if (["review-task", "review-complete", "review-failed"].includes(request.reason)) {
        const transition = readReviewTransition(request, context);
        return transition ? { type: transition.reason, request, transition } : null;
      }
      if (context.activeReviewTaskId || request.reason !== "context-threshold"
        || request.schema_version !== 1 || request.supervisor_id !== context.supervisorId
        || request.provider !== context.provider || request.project !== context.project
        || request.launch_id !== context.launchId
        || !Number.isFinite(request.used_percentage) || request.used_percentage < context.threshold
        || !["codex-notify", "claude-idle"].includes(request.boundary_source)) return null;
      return { type: "rollover", request };
    };
    child.once("error", () => finish({ type: "exit", code: 127 }));
    child.once("close", (code) => finish(requested() || { type: "exit", code: code ?? 1 }));
    timer = setInterval(() => {
      const request = requested();
      if (request) finish(request);
    }, 250);
    timer.unref?.();
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.killed) return;
  try { child.kill("SIGTERM"); } catch {}
  for (let i = 0; i < 20; i += 1) {
    if (child.exitCode !== null) return;
    await sleep(100);
  }
  try { child.kill("SIGKILL"); } catch {}
}

function removeIfExists(file) { try { fs.unlinkSync(file); } catch {} }

async function main() {
  const provider = String(process.argv[2] || "").toLowerCase();
  const rawArgs = process.argv.slice(3);
  if (!SUPPORTED.has(provider)) {
    console.error("Web Kit Context Supervisor: expected provider codex or claude.");
    return 2;
  }

  const real = resolveRealProvider(provider);
  if (!real) {
    console.error(`Web Kit Context Supervisor: real ${provider} executable not found outside ${shimBin()}.`);
    return 127;
  }

  if (process.env.WEB_KIT_CONTEXT_SUPERVISOR_BYPASS === "1" || process.env.WEB_KIT_CONTEXT_SUPERVISOR_ACTIVE === "1") {
    return await passThrough(real, rawArgs);
  }

  const project = findProjectRoot(process.cwd());
  const globalConfig = readJson(path.join(webKitHome(), "config.json"), {});
  if (!project || globalConfig.enabled === false || shouldPassThrough(provider, rawArgs)) return await passThrough(real, rawArgs);

  const projectConfig = readJson(path.join(project, ".agent-kit.json"), {});
  const threshold = Number(projectConfig.context_rollover?.threshold_percent ?? globalConfig.threshold_percent ?? 50);
  const boundedThreshold = Number.isFinite(threshold) ? Math.max(10, Math.min(90, threshold)) : 50;
  const supervisorId = crypto.randomUUID();
  const stateRoot = path.join(project, ".agent-core", "state", "context-rollover");
  const requestFile = path.join(stateRoot, "requests", `${supervisorId}.json`);
  const telemetryFile = path.join(stateRoot, "telemetry", `${supervisorId}.json`);
  const controllerFile = path.join(stateRoot, "supervisors", `${supervisorId}.json`);
  fs.mkdirSync(path.dirname(controllerFile), { recursive: true });
  removeIfExists(requestFile);
  removeIfExists(telemetryFile);

  const instrumentation = prepareInstrumentation(provider, rawArgs, project, supervisorId);
  instrumentation.env.WEB_KIT_CONTEXT_THRESHOLD = String(boundedThreshold);
  let launchArgs = instrumentation.initialArgs;
  let rollovers = 0;
  let nextLaunchId = null;
  let activeReviewTaskId = null;

  atomicWrite(controllerFile, {
    schema_version: 2,
    task_handoff_version: 1,
    pid: process.pid,
    supervisor_id: supervisorId,
    provider,
    status: "running",
    project,
    threshold_percent: boundedThreshold,
    real_provider: real,
    started_at: nowIso(),
    rollovers: 0,
  });

  console.log(`[Web Kit] ${provider} context supervisor active · fresh context at ${boundedThreshold}% · native CLI preserved`);

  try {
    while (true) {
      removeIfExists(requestFile);
      const launchId = nextLaunchId || crypto.randomUUID();
      nextLaunchId = null;
      instrumentation.env.WEB_KIT_LAUNCH_ID = launchId;
      if (activeReviewTaskId) instrumentation.env.WEB_KIT_REVIEW_TASK_ID = activeReviewTaskId;
      else delete instrumentation.env.WEB_KIT_REVIEW_TASK_ID;
      const current = readJson(controllerFile, {});
      atomicWrite(controllerFile, {
        ...current,
        status: "running",
        launch_id: launchId,
        launch_started_at: nowIso(),
        active_review_task_id: activeReviewTaskId,
        updated_at: nowIso(),
      });
      const child = spawnProvider(real, launchArgs, {
        cwd: project,
        stdio: "inherit",
        env: instrumentation.env,
      });
      const outcome = await waitForChildOrRequest(child, requestFile, {
        project, supervisorId, provider, launchId, activeReviewTaskId, threshold: boundedThreshold,
      });
      if (outcome.type === "exit") {
        let code = outcome.code;
        const pending = readJson(path.join(stateRoot, "pending-tasks", `${supervisorId}-${launchId}.json`), null);
        const incompleteTaskId = activeReviewTaskId || pending?.task_id;
        if (incompleteTaskId) {
          const reason = activeReviewTaskId
            ? `Review session exited (${code}) without a verified report-delivery boundary.`
            : `The current session exited (${code}) before the queued review reached a native handoff boundary.`;
          failReviewTransition(project, incompleteTaskId, reason);
          console.error(`[Web Kit] Review not completed: ${reason}`);
          code = code || 1;
        }
        const state = readJson(controllerFile, {});
        atomicWrite(controllerFile, { ...state, status: "exited", exit_code: code, rollovers, updated_at: nowIso() });
        return code;
      }

      const request = outcome.request;
      await stopChild(child);
      if (outcome.type === "review-failed") {
        const reason = outcome.transition.failure_reason;
        const failed = failReviewTransition(project, activeReviewTaskId, reason);
        const state = readJson(controllerFile, {});
        atomicWrite(controllerFile, { ...state, status: "exited", exit_code: 1, review_result: failed, updated_at: nowIso() });
        console.error(`[Web Kit] Review session stopped without verified report delivery: ${reason}`);
        return 1;
      }
      if (outcome.type === "review-complete") {
        const delivered = finishReviewTransition(outcome.transition);
        const state = readJson(controllerFile, {});
        atomicWrite(controllerFile, { ...state, status: "exited", exit_code: 0, review_result: delivered, updated_at: nowIso() });
        console.log(`[Web Kit] Review report delivered for ${activeReviewTaskId}. Review session stopped; PR readiness not assessed.`);
        return 0;
      }
      if (outcome.type === "review-task") {
        nextLaunchId = crypto.randomUUID();
        activeReviewTaskId = outcome.transition.task.task_id;
        const started = startReviewTransition(outcome.transition, nextLaunchId);
        activeReviewTaskId = started.taskId;
        launchArgs = [...instrumentation.freshBaseArgs, taskReviewPrompt(project, started.handoffPath)];
        console.log(`\n[Web Kit] Starting a fresh ${provider} session for review task ${activeReviewTaskId}; no builder conversation is resumed.\n`);
        continue;
      }
      rollovers += 1;
      console.log(`\n[Web Kit] Context ${Math.round(request.used_percentage ?? boundedThreshold)}% reached at a safe turn boundary. Preparing fresh context...`);

      const generated = provider === "codex"
        ? captureCodexHandoff(real, project, request.session_id, instrumentation.env)
        : captureClaudeHandoff(real, project, request.session_id, instrumentation.env);
      const handoff = buildHandoff(provider, request, generated, project, supervisorId, rollovers);
      validateHandoff(handoff);
      const handoffPaths = writeHandoff(project, supervisorId, rollovers, handoff);
      const relative = path.relative(project, handoffPaths.latest).split(path.sep).join("/");
      console.log(`[Web Kit] Handoff validated: ${relative}`);
      console.log(`[Web Kit] Starting a genuinely fresh ${provider} session automatically...\n`);

      const state = readJson(controllerFile, {});
      atomicWrite(controllerFile, {
        ...state,
        rollovers,
        last_context_percent: request.used_percentage ?? null,
        last_session_id: request.session_id ?? null,
        last_handoff: relative,
        last_rollover_at: nowIso(),
        updated_at: nowIso(),
      });

      launchArgs = [...instrumentation.freshBaseArgs, freshPrompt(project, handoffPaths.latest, handoff)];
      removeIfExists(requestFile);
      await sleep(150);
    }
  } catch (error) {
    if (activeReviewTaskId) {
      try { failReviewTransition(project, activeReviewTaskId, error.message); } catch {}
    }
    const state = readJson(controllerFile, {});
    atomicWrite(controllerFile, { ...state, status: "failed", error: error.message, updated_at: nowIso() });
    throw error;
  } finally {
    instrumentation.cleanup();
  }
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(`[Web Kit] Context Supervisor error: ${error.message}`);
  process.exitCode = 1;
});
