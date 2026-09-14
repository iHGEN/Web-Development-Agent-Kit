#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const TERMINAL_JOB_STATUSES = new Set(["DONE", "BLOCKED", "WAITING_USER", "WAITING_EXTERNAL", "FAILED", "CANCELLED"]);
const MAX_UNTRACKED_FILES = 200;
const MAX_UNTRACKED_BYTES_PER_FILE = 64 * 1024;
const MAX_UNTRACKED_TOTAL_BYTES = 512 * 1024;

function readAllStdin() {
  try { return fs.readFileSync(0, "utf8"); }
  catch { return ""; }
}

function readJsonText(text, fallback = null) {
  try { return JSON.parse(text); }
  catch { return fallback; }
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function hash(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), "utf8");
  return crypto.createHash("sha256").update(input).digest("hex");
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
    root,
    telemetry: path.join(root, "telemetry", `${supervisorId}.json`),
    request: path.join(root, "requests", `${supervisorId}.json`),
    turnState: path.join(root, "turns", `${supervisorId}.json`),
    jobs: path.join(project, ".agent-core", "state", "jobs"),
    workProgress: path.join(project, ".agent-core", "bin", "work-progress.mjs"),
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

function gitRun(project, args) {
  const result = spawnSync("git", args, { cwd: project, encoding: "utf8", windowsHide: true });
  return !result.error && result.status === 0 ? String(result.stdout || "") : "";
}

function managedStatePath(file) {
  const normalized = String(file || "").replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized.startsWith(".agent-core/state/") || normalized.startsWith(".agent-core/security-reviews/");
}

function filteredStatus(project) {
  return gitRun(project, ["status", "--porcelain=v1", "--untracked-files=all"])
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => {
      const file = line.slice(3).replace(/^"|"$/g, "");
      return !managedStatePath(file);
    });
}

function boundedUntrackedFingerprint(project) {
  const root = path.resolve(project);
  const files = gitRun(project, ["ls-files", "--others", "--exclude-standard"])
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => !managedStatePath(file))
    .sort()
    .slice(0, MAX_UNTRACKED_FILES);
  const records = [];
  let totalBytes = 0;
  for (const relative of files) {
    const absolute = path.resolve(project, relative);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) continue;
    let stat;
    try { stat = fs.lstatSync(absolute); } catch { continue; }
    if (!stat.isFile()) {
      records.push(`${relative}|non-regular`);
      continue;
    }
    const remaining = Math.max(0, MAX_UNTRACKED_TOTAL_BYTES - totalBytes);
    if (!remaining) {
      records.push(`${relative}|${stat.size}|total-limit`);
      continue;
    }
    const captureBytes = Math.min(stat.size, MAX_UNTRACKED_BYTES_PER_FILE, remaining);
    let bytes = Buffer.alloc(0);
    try {
      const fd = fs.openSync(absolute, "r");
      try {
        bytes = Buffer.alloc(captureBytes);
        const read = fs.readSync(fd, bytes, 0, captureBytes, 0);
        bytes = bytes.subarray(0, read);
      } finally { fs.closeSync(fd); }
    } catch {
      records.push(`${relative}|${stat.size}|unreadable`);
      continue;
    }
    totalBytes += bytes.length;
    records.push(`${relative}|${stat.size}|${bytes.length}|${hash(bytes)}`);
  }
  return hash(records.join("\n"));
}

function repositoryFingerprint(project) {
  if (gitRun(project, ["rev-parse", "--is-inside-work-tree"]).trim() !== "true") return null;
  const pathspec = ["--", ".", ":(exclude).agent-core/state/**", ":(exclude).agent-core/security-reviews/**"];
  const diff = gitRun(project, ["diff", "--no-ext-diff", "--binary", ...pathspec]);
  const staged = gitRun(project, ["diff", "--cached", "--no-ext-diff", "--binary", ...pathspec]);
  const status = filteredStatus(project).join("\n");
  const untracked = boundedUntrackedFingerprint(project);
  const head = gitRun(project, ["rev-parse", "HEAD"]).trim();
  return hash(`${head}\n--status--\n${status}\n--diff--\n${diff}\n--staged--\n${staged}\n--untracked--\n${untracked}`);
}

function validTaskId(taskId) {
  const value = String(taskId || "");
  return value.length > 0 && value.length <= 120 && /^[a-zA-Z0-9._-]+$/.test(value);
}

function activeJobById(paths, taskId) {
  if (!validTaskId(taskId)) return null;
  const file = path.join(paths.jobs, `${taskId}.json`);
  const job = readJson(file, null);
  if (!job || TERMINAL_JOB_STATUSES.has(String(job.status || "").toUpperCase())) return null;
  return { file, job };
}

function latestActiveJob(paths) {
  if (!fs.existsSync(paths.jobs)) return null;
  let latest = null;
  for (const name of fs.readdirSync(paths.jobs)) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(paths.jobs, name);
    const job = readJson(file, null);
    if (!job || TERMINAL_JOB_STATUSES.has(String(job.status || "").toUpperCase())) continue;
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(file).mtimeMs; } catch {}
    if (!latest || mtimeMs > latest.mtimeMs) latest = { file, job, mtimeMs };
  }
  return latest;
}

function activeJobForObservation(paths, observation) {
  return activeJobById(paths, observation?.task_id) || latestActiveJob(paths);
}

function planGateReady(job) {
  if (!job?.governance?.plan_required) return true;
  const min = Number(job.governance.min_plan_bullets ?? (job.classification === "MEDIUM" && !job.high_risk ? 3 : 1));
  const max = Number(job.governance.max_plan_bullets ?? 20);
  const bullets = Number(job.plan?.bullets || 0);
  if (bullets < min || bullets > max || job.plan?.status !== "APPROVED") return false;
  if (!job.governance.plan_validator_required) return true;
  return job.plan?.validator?.status === "APPROVED"
    && Boolean(job.plan?.validator?.source)
    && Number(job.plan?.validator?.plan_version) === Number(job.plan?.version || 0);
}

function invokeWorkProgress(paths, job, kind, evidence) {
  if (!fs.existsSync(paths.workProgress) || !job?.task_id) return false;
  const result = spawnSync(process.execPath, [
    paths.workProgress,
    "cycle",
    "--task-id", String(job.task_id),
    "--kind", kind,
    "--project", paths.project,
    ...(evidence ? ["--evidence", evidence] : []),
  ], {
    cwd: paths.project,
    encoding: "utf8",
    windowsHide: true,
    stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

function recordProviderTurn(provider, sessionId, turnKey) {
  const paths = statePaths();
  if (!turnKey || !fs.existsSync(paths.workProgress)) return;
  const observation = readJson(paths.turnState, {});
  if (observation.last_turn_key === turnKey) return;

  const active = activeJobForObservation(paths, observation);
  const fingerprint = repositoryFingerprint(paths.project);
  const previousFingerprint = observation.repository_fingerprint || null;
  const job = active?.job || null;
  const jobId = job?.task_id || null;
  const currentCycles = Number(job?.metrics?.ai_cycles || 0);
  const sameJob = Boolean(jobId && observation.task_id === jobId);
  const providerAlreadyRecordedCycle = sameJob
    && Number.isFinite(Number(observation.job_ai_cycles))
    && currentCycles > Number(observation.job_ai_cycles);
  const repositoryChanged = Boolean(previousFingerprint && fingerprint && previousFingerprint !== fingerprint);
  const pendingGovernanceDelta = Boolean(
    repositoryChanged
    && observation.pending_repository_fingerprint
    && observation.pending_repository_fingerprint === fingerprint
    && observation.governance_violation
  );

  let recorded = false;
  let attempted = false;
  let governanceViolation = null;

  if (job && sameJob && !providerAlreadyRecordedCycle && previousFingerprint && fingerprint) {
    const status = String(job.status || "").toUpperCase();

    if (pendingGovernanceDelta) {
      attempted = true;
      if (!planGateReady(job)) {
        governanceViolation = {
          ...observation.governance_violation,
          status,
          message: "The previously blocked repository delta is still pending because the required plan/validator gate is not approved.",
          pending_repository_fingerprint: fingerprint,
          detected_at: new Date().toISOString(),
        };
      } else {
        recorded = invokeWorkProgress(paths, job, "implementation", `automatic ${provider} safe-turn evidence: previously blocked repository delta now allowed by governance`);
      }
    } else if (status === "PLANNING") {
      attempted = true;
      recorded = invokeWorkProgress(paths, job, "planning", "");
    } else if (repositoryChanged) {
      attempted = true;
      if (!planGateReady(job)) {
        governanceViolation = {
          type: "PRE_APPROVAL_REPOSITORY_DELTA",
          task_id: jobId,
          status,
          message: "Repository changed before the required plan/validator gate was approved. The prior repository fingerprint is preserved so this delta remains pending.",
          pending_repository_fingerprint: fingerprint,
          detected_at: new Date().toISOString(),
        };
      } else {
        recorded = invokeWorkProgress(paths, job, "implementation", `automatic ${provider} safe-turn evidence: repository diff/status changed`);
      }
    } else if (status === "IMPLEMENTING") {
      attempted = true;
      recorded = invokeWorkProgress(paths, job, "prose", "");
    }
  }

  if (attempted && !recorded && repositoryChanged && !governanceViolation) {
    governanceViolation = {
      type: "PROGRESS_RECORDING_FAILED",
      task_id: jobId,
      status: String(job?.status || "").toUpperCase(),
      message: "Repository changed, but the progress engine rejected or failed to record the cycle. The previous fingerprint is preserved for retry.",
      pending_repository_fingerprint: fingerprint,
      detected_at: new Date().toISOString(),
    };
  }

  const refreshed = active?.file ? readJson(active.file, job) : job;
  const shouldPreserveFingerprint = Boolean(repositoryChanged && attempted && !recorded);
  atomicWrite(paths.turnState, {
    schema_version: 2,
    supervisor_id: paths.supervisorId,
    provider,
    session_id: sessionId || null,
    last_turn_key: turnKey,
    task_id: refreshed?.task_id || jobId,
    job_ai_cycles: Number(refreshed?.metrics?.ai_cycles || currentCycles),
    repository_fingerprint: shouldPreserveFingerprint ? previousFingerprint : fingerprint,
    pending_repository_fingerprint: shouldPreserveFingerprint ? fingerprint : null,
    automatic_cycle_recorded: recorded,
    governance_violation: governanceViolation,
    observed_at: new Date().toISOString(),
  });
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
  const inputMessages = Array.isArray(event["input-messages"]) ? event["input-messages"].slice(-8) : [];
  const lastAssistant = typeof event["last-assistant-message"] === "string" ? event["last-assistant-message"].slice(-12000) : "";
  if (context) {
    writeTelemetryAndMaybeRequest("codex", threadId, context.percent, context.source, {
      context_window: context.context_window ?? null,
      input_tokens: context.input_tokens ?? null,
      input_messages: inputMessages,
      last_assistant_message: lastAssistant,
    });
  }
  recordProviderTurn("codex", threadId, hash(JSON.stringify([threadId, inputMessages, lastAssistant])));
  runOriginalCodexNotify(raw);
}

function claudeStatusline() {
  const raw = readAllStdin();
  const data = readJsonText(raw, {});
  const pct = numeric(data?.context_window, "used_percentage");
  const sessionId = typeof data.session_id === "string" ? data.session_id : null;
  const contextWindow = numeric(data?.context_window, "context_window_size");
  const totalInput = numeric(data?.context_window, "total_input_tokens");
  const totalOutput = numeric(data?.context_window, "total_output_tokens");
  const model = data?.model?.id || data?.model?.display_name || null;
  if (pct !== null) {
    writeTelemetryAndMaybeRequest("claude", sessionId, pct, "claude-statusline", {
      context_window: contextWindow,
      total_input_tokens: totalInput,
      total_output_tokens: totalOutput,
      model,
    });
  }
  recordProviderTurn("claude", sessionId, hash(JSON.stringify([sessionId, totalInput, totalOutput, pct, model])));
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
