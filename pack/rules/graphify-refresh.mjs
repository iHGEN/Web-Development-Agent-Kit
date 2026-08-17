#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const STATE_REL = path.join(".agent-core", "state", "graphify.json");
const INSTALL_STATE_REL = path.join(".agent-core", "state", "graphify-install.json");
const PROFILE_REL = path.join(".agent-core", "index", "project-profile.json");
const CONFIG_REL = ".agent-kit.json";
const GRAPH_REL = path.join("graphify-out", "graph.json");
const GRAPHIFY_MCP_CONFIGS = [
  ".mcp.json", "mcp.json", ".cursor/mcp.json", ".gemini/settings.json",
  ".vscode/mcp.json", ".codex/config.toml",
];
const IGNORED_PARTS = new Set([
  ".git", ".agent-core", ".agents", "graphify-out", "node_modules", "vendor",
  "bin", "obj", ".next", "dist", "build", "coverage", ".cache", ".idea", ".vscode",
]);
const IGNORED_FILES = new Set([".agent-kit.json", ".agent-kit-source.json"]);
const MAX_CONTENT_HASH_BYTES = 5 * 1024 * 1024;

function nowIso() { return new Date().toISOString(); }
function posix(rel) { return rel.split(path.sep).join("/"); }
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return {}; }
}
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}
function commandWorks(command, args = ["--version"]) {
  const result = spawnSync(command, args, { stdio: "ignore", windowsHide: true });
  return !result.error && result.status === 0;
}
function findGraphify() {
  const suffix = process.platform === "win32" ? ".exe" : "";
  for (const candidate of [
    process.env.WEB_KIT_GRAPHIFY_BIN,
    "graphify",
    path.join(os.homedir(), ".local", "bin", `graphify${suffix}`),
    path.join(os.homedir(), ".cargo", "bin", `graphify${suffix}`),
  ].filter(Boolean)) {
    if (candidate === "graphify") {
      if (commandWorks(candidate)) return candidate;
    } else if (fs.existsSync(candidate) && commandWorks(candidate)) return candidate;
  }
  return null;
}
function looksLikeGraphifyCodeMcp(text) {
  const lower = String(text || "").toLowerCase();
  return lower.includes("graphify.serve") || lower.includes("graphify-mcp") ||
    (lower.includes("graphify") && lower.includes("graphify-out/graph.json"));
}
function graphifyConfigFiles(project) {
  const hits = [];
  for (const rel of GRAPHIFY_MCP_CONFIGS) {
    const file = path.join(project, rel);
    if (!fs.existsSync(file)) continue;
    try { if (looksLikeGraphifyCodeMcp(fs.readFileSync(file, "utf8"))) hits.push(posix(rel)); }
    catch {}
  }
  return hits.sort();
}
function syncGraphifyMetadata(project, state) {
  const graphReady = fs.existsSync(path.join(project, GRAPH_REL));
  const configHits = graphifyConfigFiles(project);
  const installPath = path.join(project, INSTALL_STATE_REL);
  const installState = readJson(installPath);
  const configuredBySetup = installState.configured === true;
  const detected = graphReady || configHits.length > 0 || configuredBySetup;
  const dirty = graphReady ? Boolean(state.dirty) : false;
  const fallback = Boolean(state.fallback_for_task);
  const runtimeMode = graphReady && !dirty && !fallback && state.routing_mode === "graphify-assisted"
    ? "graphify-assisted" : "standard";

  const capability = {
    detected,
    graph_ready: graphReady,
    graph_path: graphReady ? "graphify-out/graph.json" : null,
    local_mcp_configured: configHits.length > 0,
    config_files: configHits,
    routing_mode: runtimeMode,
    fallback_mode: "standard",
    runtime_tool_required: graphReady,
    source_authority: "repository source",
    dirty,
    fallback_for_task: fallback,
    fallback_task_id: state.fallback_task_id ?? null,
    last_refresh_status: state.last_refresh_status ?? null,
    runtime_state_path: ".agent-core/state/graphify.json",
    synced_at: nowIso(),
    note: graphReady
      ? "Graphify graph snapshot detected. Use graph-assisted navigation only when the Graph Refresh Gate reports a clean graph; verify behavior from exact source."
      : detected
        ? "Graphify project integration detected but no graph snapshot is ready. Use standard routing until graphify-out/graph.json exists."
        : "Graphify not detected in this project; use standard repository routing.",
  };

  for (const rel of [PROFILE_REL, CONFIG_REL]) {
    const file = path.join(project, rel);
    const data = readJson(file);
    if (!Object.keys(data).length) continue;
    data.capabilities ||= {};
    data.capabilities.graphify = capability;
    writeJsonAtomic(file, data);
  }

  if (Object.keys(installState).length || graphReady || configuredBySetup) {
    Object.assign(installState, {
      graph_ready: graphReady,
      initial_graph_required: !graphReady,
      observed_routing_mode: runtimeMode,
      observed_dirty: dirty,
      observed_fallback_for_task: fallback,
      observed_last_refresh_status: state.last_refresh_status ?? null,
      synced_at: nowIso(),
    });
    writeJsonAtomic(installPath, installState);
  }
}
function ignored(rel) {
  const normalized = posix(rel);
  if (IGNORED_FILES.has(normalized)) return true;
  return normalized.split("/").some((part) => IGNORED_PARTS.has(part));
}
function runGit(project, args) {
  const result = spawnSync("git", ["-C", project, ...args], { encoding: "buffer", windowsHide: true });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}
function nulPaths(project, args) {
  const raw = runGit(project, args);
  if (!raw) return [];
  return raw.toString("utf8").split("\0").filter(Boolean);
}
function fileSignature(file) {
  if (!fs.existsSync(file)) return "deleted";
  try {
    const stat = fs.statSync(file);
    if (stat.isFile() && stat.size <= MAX_CONTENT_HASH_BYTES) {
      const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      return `sha256:${digest}`;
    }
    return `stat:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "unreadable";
  }
}
function gitFingerprint(project) {
  if (!fs.existsSync(path.join(project, ".git")) || !commandWorks("git", ["--version"])) return null;
  const headRaw = runGit(project, ["rev-parse", "HEAD"]);
  if (!headRaw) return null;
  const changed = new Set([
    ...nulPaths(project, ["diff", "--name-only", "-z"]),
    ...nulPaths(project, ["diff", "--cached", "--name-only", "-z"]),
    ...nulPaths(project, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ].filter((rel) => !ignored(rel)));
  const sorted = [...changed].sort();
  const head = headRaw.toString("utf8").trim();
  const hash = crypto.createHash("sha256");
  hash.update(`HEAD:${head}\n`);
  for (const rel of sorted) {
    hash.update(posix(rel));
    hash.update("\0");
    hash.update(fileSignature(path.join(project, rel)));
    hash.update("\n");
  }
  return {
    method: "git-working-tree",
    fingerprint: hash.digest("hex"),
    head,
    changed_files: sorted.slice(0, 200).map(posix),
    changed_file_count: sorted.length,
  };
}
function filesystemFingerprint(project) {
  const hash = crypto.createHash("sha256");
  let count = 0;
  function walk(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = path.relative(project, full);
      if (ignored(rel)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          hash.update(`${posix(rel)}:${stat.size}:${stat.mtimeMs}\n`);
          count += 1;
        } catch {}
      }
    }
  }
  walk(project);
  return {
    method: "filesystem-stat",
    fingerprint: hash.digest("hex"),
    head: null,
    changed_files: [],
    changed_file_count: count,
  };
}
function projectFingerprint(project) { return gitFingerprint(project) || filesystemFingerprint(project); }
function baseState(project, fingerprint) {
  const graphReady = fs.existsSync(path.join(project, GRAPH_REL));
  return {
    version: 2,
    runtime: "node",
    graph_path: "graphify-out/graph.json",
    graph_ready: graphReady,
    routing_mode: graphReady ? "graphify-assisted" : "standard",
    fallback_mode: "standard",
    dirty: graphReady,
    fingerprint_method: fingerprint.method,
    current_fingerprint: fingerprint.fingerprint,
    last_successful_fingerprint: null,
    changed_files: fingerprint.changed_files,
    changed_file_count: fingerprint.changed_file_count,
    last_refresh_status: graphReady ? "needs-refresh" : "not-ready",
    last_refresh_at: null,
    fallback_for_task: false,
    fallback_task_id: null,
    last_error: null,
    command: "graphify update .",
    updated_at: nowIso(),
  };
}
function saveState(project, state) {
  state.updated_at = nowIso();
  writeJsonAtomic(path.join(project, STATE_REL), state);
  syncGraphifyMetadata(project, state);
}
function initialize(project) {
  const fingerprint = projectFingerprint(project);
  const existing = readJson(path.join(project, STATE_REL));
  const state = baseState(project, fingerprint);
  if (Object.keys(existing).length) {
    state.last_successful_fingerprint = existing.last_successful_fingerprint ?? null;
    state.last_refresh_at = existing.last_refresh_at ?? null;
    state.last_refresh_status = existing.last_refresh_status ?? state.last_refresh_status;
    state.fallback_for_task = Boolean(existing.fallback_for_task);
    state.fallback_task_id = existing.fallback_task_id ?? null;
    state.last_error = existing.last_error ?? null;
    state.dirty = state.graph_ready && state.current_fingerprint !== state.last_successful_fingerprint;
  }
  saveState(project, state);
  console.log(`Graph Refresh Gate initialized: ${state.dirty ? "refresh required before Graphify use" : state.routing_mode}`);
  return 0;
}
function status(project) {
  const fingerprint = projectFingerprint(project);
  const state = Object.assign(baseState(project, fingerprint), readJson(path.join(project, STATE_REL)));
  state.graph_ready = fs.existsSync(path.join(project, GRAPH_REL));
  state.current_fingerprint = fingerprint.fingerprint;
  state.fingerprint_method = fingerprint.method;
  state.changed_files = fingerprint.changed_files;
  state.changed_file_count = fingerprint.changed_file_count;
  state.dirty = state.graph_ready && state.last_successful_fingerprint !== fingerprint.fingerprint;
  syncGraphifyMetadata(project, state);
  console.log(JSON.stringify(state, null, 2));
  return 0;
}
function markFallback(project, state, taskId, fingerprint, statusName, error) {
  Object.assign(state, {
    graph_ready: fs.existsSync(path.join(project, GRAPH_REL)),
    routing_mode: "standard",
    dirty: true,
    fingerprint_method: fingerprint.method,
    current_fingerprint: fingerprint.fingerprint,
    changed_files: fingerprint.changed_files,
    changed_file_count: fingerprint.changed_file_count,
    last_refresh_status: statusName,
    fallback_for_task: true,
    fallback_task_id: taskId ?? null,
    last_error: String(error),
  });
  saveState(project, state);
  console.log(`Graph Refresh Gate: ${error}. Using standard routing for task ${taskId || "(unspecified)"}.`);
  return 0;
}
function refresh(project, taskId, retry, timeoutSeconds) {
  const graphPath = path.join(project, GRAPH_REL);
  const fingerprint = projectFingerprint(project);
  const state = Object.assign(baseState(project, fingerprint), readJson(path.join(project, STATE_REL)));

  if (!fs.existsSync(graphPath)) {
    Object.assign(state, {
      graph_ready: false, routing_mode: "standard", dirty: false,
      fingerprint_method: fingerprint.method, current_fingerprint: fingerprint.fingerprint,
      changed_files: fingerprint.changed_files, changed_file_count: fingerprint.changed_file_count,
      last_refresh_status: "not-ready", fallback_for_task: false, fallback_task_id: null, last_error: null,
    });
    saveState(project, state);
    console.log("Graph Refresh Gate: no graphify-out/graph.json; using standard routing.");
    return 0;
  }

  if (!retry && taskId && state.fallback_for_task && state.fallback_task_id === taskId) {
    Object.assign(state, {
      routing_mode: "standard", dirty: true,
      current_fingerprint: fingerprint.fingerprint, fingerprint_method: fingerprint.method,
      changed_files: fingerprint.changed_files, changed_file_count: fingerprint.changed_file_count,
    });
    saveState(project, state);
    console.log(`Graph Refresh Gate: Graphify already fell back for task ${taskId}; continuing in standard mode.`);
    return 0;
  }

  if (state.last_successful_fingerprint === fingerprint.fingerprint) {
    Object.assign(state, {
      graph_ready: true, routing_mode: "graphify-assisted", dirty: false,
      current_fingerprint: fingerprint.fingerprint, fingerprint_method: fingerprint.method,
      changed_files: fingerprint.changed_files, changed_file_count: fingerprint.changed_file_count,
      last_refresh_status: "clean", fallback_for_task: false, fallback_task_id: null, last_error: null,
    });
    saveState(project, state);
    console.log("Graph Refresh Gate: repository state unchanged since last successful refresh; no Graphify update needed.");
    return 0;
  }

  const graphify = findGraphify();
  if (!graphify) return markFallback(project, state, taskId, fingerprint, "unavailable", "Graphify CLI is not available");

  console.log("Graph Refresh Gate: repository changed; running one incremental `graphify update .` refresh...");
  const result = spawnSync(graphify, ["update", "."], {
    cwd: project, stdio: "inherit", timeout: timeoutSeconds * 1000, windowsHide: true,
  });
  if (result.error) {
    const statusName = result.error.code === "ETIMEDOUT" ? "timeout" : "failed";
    return markFallback(project, state, taskId, fingerprint, statusName, result.error.message);
  }
  if (result.status !== 0) return markFallback(project, state, taskId, fingerprint, "failed", `Graphify refresh exited with status ${result.status}`);

  const refreshed = projectFingerprint(project);
  Object.assign(state, {
    graph_ready: fs.existsSync(graphPath),
    routing_mode: fs.existsSync(graphPath) ? "graphify-assisted" : "standard",
    dirty: false,
    fingerprint_method: refreshed.method,
    current_fingerprint: refreshed.fingerprint,
    last_successful_fingerprint: refreshed.fingerprint,
    changed_files: refreshed.changed_files,
    changed_file_count: refreshed.changed_file_count,
    last_refresh_status: "success",
    last_refresh_at: nowIso(),
    fallback_for_task: false,
    fallback_task_id: null,
    last_error: null,
  });
  saveState(project, state);
  console.log("Graph Refresh Gate: refresh succeeded; graphify-assisted routing is fresh.");
  return 0;
}
function parseArgs(argv) {
  const out = {
    project: ".", taskId: null, initialize: false, status: false, retry: false,
    timeout: Number(process.env.WEB_KIT_GRAPHIFY_TIMEOUT || "300"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project") out.project = argv[++i] || ".";
    else if (arg.startsWith("--project=")) out.project = arg.slice(10);
    else if (arg === "--task-id") out.taskId = argv[++i] || null;
    else if (arg.startsWith("--task-id=")) out.taskId = arg.slice(10);
    else if (arg === "--initialize") out.initialize = true;
    else if (arg === "--status") out.status = true;
    else if (arg === "--retry") out.retry = true;
    else if (arg === "--timeout") out.timeout = Number(argv[++i] || out.timeout);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const project = path.resolve(args.project);
process.exitCode = args.initialize ? initialize(project)
  : args.status ? status(project)
    : refresh(project, args.taskId, args.retry, args.timeout);
