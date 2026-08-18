#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function readAllStdin() {
  try { return fs.readFileSync(0, "utf8"); }
  catch { return ""; }
}

function readJsonText(text, fallback = null) {
  try { return JSON.parse(text); }
  catch { return fallback; }
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function decodeJsonEnv(name, fallback = null) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try { return JSON.parse(Buffer.from(raw, "base64").toString("utf8")); }
  catch { return fallback; }
}

function statePaths() {
  const project = path.resolve(process.env.WEB_KIT_PROJECT_ROOT || process.cwd());
  const supervisorId = process.env.WEB_KIT_SUPERVISOR_ID || "unknown";
  const root = path.join(project, ".agent-core", "state", "context-rollover");
  return {
    project,
    supervisorId,
    telemetry: path.join(root, "telemetry", `${supervisorId}.json`),
    request: path.join(root, "requests", `${supervisorId}.json`),
  };
}

function threshold() {
  const value = Number(process.env.WEB_KIT_CONTEXT_THRESHOLD || 50);
  return Number.isFinite(value) ? Math.max(10, Math.min(90, value)) : 50;
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

function tailText(file, maxBytes = 2 * 1024 * 1024) {
  const stat = fs.statSync(file);
  const length = Math.min(maxBytes, stat.size);
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, stat.size - length);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function findCodexSessionFile(threadId) {
  const codexHome = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), ".codex");
  const root = path.join(codexHome, "sessions");
  if (!fs.existsSync(root)) return null;
  const stack = [root];
  let newest = null;
  let visited = 0;
  while (stack.length && visited < 20000) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      visited += 1;
      if (visited >= 20000) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      if (threadId && entry.name.includes(threadId)) return full;
      try {
        const stat = fs.statSync(full);
        if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { file: full, mtimeMs: stat.mtimeMs };
      } catch {}
    }
  }
  return newest?.file || null;
}

function codexContext(threadId) {
  const file = findCodexSessionFile(threadId);
  if (!file) return null;
  const lines = tailText(file).split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    const event = readJsonText(line, null);
    if (!event) continue;
    let found = null;
    walkObject(event, (obj) => {
      if (found) return;
      const pct = numeric(obj?.context_window, "used_percentage") ?? numeric(obj, "context_used_percent", "context_used_percentage");
      if (pct !== null) {
        found = { percent: Math.max(0, Math.min(100, pct)), source: "codex-session-percent", session_file: file };
        return;
      }
      const window = numeric(obj, "model_context_window", "context_window_size", "contextWindow");
      const usage = obj.last_token_usage || obj.lastTokenUsage || obj.current_usage;
      const input = usageInputTokens(usage);
      if (window && input !== null) {
        found = {
          percent: Math.max(0, Math.min(100, (input / window) * 100)),
          source: "codex-session-token-count",
          context_window: window,
          input_tokens: input,
          session_file: file,
        };
      }
    });
    if (found) return found;
  }
  return null;
}

function writeTelemetryAndMaybeRequest(provider, sessionId, percent, source, extra = {}) {
  const paths = statePaths();
  if (!Number.isFinite(percent)) return;
  const telemetry = {
    schema_version: 1,
    supervisor_id: paths.supervisorId,
    provider,
    session_id: sessionId || null,
    used_percentage: Math.max(0, Math.min(100, percent)),
    source,
    observed_at: new Date().toISOString(),
    ...extra,
  };
  atomicWrite(paths.telemetry, telemetry);
  if (telemetry.used_percentage >= threshold()) {
    atomicWrite(paths.request, {
      ...telemetry,
      threshold_percent: threshold(),
      reason: "context-threshold",
      safe_boundary: true,
      requested_at: new Date().toISOString(),
    });
  }
}

function runOriginalCodexNotify(rawEvent) {
  const original = decodeJsonEnv("WEB_KIT_ORIGINAL_CODEX_NOTIFY_B64", null);
  if (!Array.isArray(original) || !original.length) return;
  try {
    spawnSync(String(original[0]), [...original.slice(1).map(String), rawEvent], {
      stdio: "ignore",
      windowsHide: true,
      shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(String(original[0])),
    });
  } catch {}
}

function runOriginalClaudeStatusline(rawInput) {
  const original = decodeJsonEnv("WEB_KIT_ORIGINAL_CLAUDE_STATUSLINE_B64", null);
  const command = typeof original === "string" ? original : original?.command;
  if (!command) return false;
  try {
    const result = spawnSync(command, [], {
      shell: true,
      input: rawInput,
      encoding: "utf8",
      windowsHide: true,
      timeout: 1500,
    });
    if (!result.error && result.status === 0 && result.stdout) {
      process.stdout.write(result.stdout);
      return true;
    }
  } catch {}
  return false;
}

function codexNotify() {
  const raw = process.argv[3] || "{}";
  const event = readJsonText(raw, {});
  const threadId = event["thread-id"] || event.thread_id || null;
  const context = codexContext(threadId);
  if (context) {
    writeTelemetryAndMaybeRequest("codex", threadId, context.percent, context.source, {
      context_window: context.context_window ?? null,
      input_tokens: context.input_tokens ?? null,
      input_messages: Array.isArray(event["input-messages"]) ? event["input-messages"].slice(-8) : [],
      last_assistant_message: typeof event["last-assistant-message"] === "string" ? event["last-assistant-message"].slice(-12000) : "",
    });
  }
  runOriginalCodexNotify(raw);
}

function claudeStatusline() {
  const raw = readAllStdin();
  const data = readJsonText(raw, {});
  const pct = numeric(data?.context_window, "used_percentage");
  const sessionId = typeof data.session_id === "string" ? data.session_id : null;
  if (pct !== null) {
    writeTelemetryAndMaybeRequest("claude", sessionId, pct, "claude-statusline", {
      context_window: numeric(data?.context_window, "context_window_size"),
      total_input_tokens: numeric(data?.context_window, "total_input_tokens"),
      total_output_tokens: numeric(data?.context_window, "total_output_tokens"),
      model: data?.model?.id || data?.model?.display_name || null,
    });
  }
  if (!runOriginalClaudeStatusline(raw)) {
    const shown = pct === null ? "--" : Math.round(pct);
    process.stdout.write(`[WK ctx ${shown}%]\n`);
  }
}

const mode = process.argv[2];
if (mode === "codex-notify") codexNotify();
else if (mode === "claude-statusline") claudeStatusline();
else {
  console.error("Usage: provider-bridge.mjs <codex-notify|claude-statusline>");
  process.exitCode = 2;
}
