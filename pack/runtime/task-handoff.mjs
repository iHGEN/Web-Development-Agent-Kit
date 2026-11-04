#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// A task handoff shares the native supervisor's process ownership, but never its
// implementation handoff or transcript. Only the owning launch can stage work;
// only a native turn boundary can ask the supervisor to switch or finish it.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TASK_ID = /^changes-review-[a-f0-9-]{36}$/i;
const PROVIDERS = new Set(["codex", "claude"]);
const BOUNDARY_SOURCE = { codex: "codex-agent-turn-complete", claude: "claude-idle-prompt" };
const REVIEW_FAILURES = {
  "missing-report-receipt": "The reviewer completed its native turn without a report-ready receipt.",
  "invalid-report-receipt": "The reviewer completed its native turn with an invalid or stale report-ready receipt or changed report.",
};
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_REPORT_BYTES = 16 * 1024 * 1024;

class UnavailableError extends Error {}
function nowIso() { return new Date().toISOString(); }
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function timestamp(value) { return typeof value === "string" ? Date.parse(value) : NaN; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function validSession(value) { return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 256 && !/[\r\n\0]/.test(value); }

function statePaths(project, supervisorId, launchId, taskId = null) {
  const state = path.join(project, ".agent-core", "state");
  const rollover = path.join(state, "context-rollover");
  const taskDir = taskId ? path.join(state, "reviews", taskId) : null;
  return {
    project, state, rollover, taskDir,
    controller: path.join(rollover, "supervisors", `${supervisorId}.json`),
    pending: path.join(rollover, "pending-tasks", `${supervisorId}-${launchId}.json`),
    trigger: path.join(rollover, "requests", `${supervisorId}.json`),
    request: taskDir && path.join(taskDir, "request.json"),
    claim: taskDir && path.join(taskDir, "claim.json"),
    handoff: taskDir && path.join(taskDir, "handoff.json"),
    report: taskDir && path.join(taskDir, "report.md"),
    ready: taskDir && path.join(taskDir, "ready.json"),
    result: taskDir && path.join(taskDir, "result.json"),
    job: taskId && path.join(state, "jobs", `${taskId}.json`),
    workProgress: path.join(project, ".agent-core", "bin", "work-progress.mjs"),
  };
}

// Check only the paths this protocol uses. Reject directory symlinks, final
// symlinks, and hard-linked state/report files rather than following aliases.
function checkedPath(project, file, { missing = false, directory = false, createParents = false } = {}) {
  const relative = path.relative(project, file);
  requireValue(relative && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`), "Task state must stay inside its project.");
  const parts = relative.split(path.sep);
  let current = project;
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i]);
    const last = i === parts.length - 1;
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (!last && createParents) {
        try { fs.mkdirSync(current, { mode: 0o700 }); }
        catch (mkdirError) { if (mkdirError.code !== "EEXIST") throw mkdirError; }
        stat = fs.lstatSync(current);
      } else if (missing) return null;
      else throw error;
    }
    requireValue(!stat.isSymbolicLink(), `Refusing aliased task state: ${current}`);
    if (!last || directory) requireValue(stat.isDirectory(), `Expected task state directory: ${current}`);
    else requireValue(stat.isFile() && stat.nlink === 1, `Expected an unaliased task state file: ${current}`);
    if (last) return stat;
  }
  return null;
}

function readJson(project, file, optional = false) {
  const stat = checkedPath(project, file, { missing: optional });
  if (!stat) return null;
  requireValue(stat.size <= MAX_JSON_BYTES, "Task state JSON is too large.");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    requireValue(opened.isFile() && opened.nlink === 1 && opened.ino === stat.ino && opened.dev === stat.dev, "Task state changed while being read.");
    return JSON.parse(fs.readFileSync(fd, "utf8"));
  } finally { fs.closeSync(fd); }
}

function writeJson(project, file, value, { exclusive = true } = {}) {
  const existing = checkedPath(project, file, { missing: true, createParents: true });
  requireValue(!exclusive || !existing, `Task state already exists: ${file}`);
  const temp = `${file}.tmp-${randomUUID()}`;
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  try {
    checkedPath(project, file, { missing: true });
    if (exclusive) fs.linkSync(temp, file); // Atomic publication without replacing another request.
    else fs.renameSync(temp, file);
  } finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}

function readController({ project, supervisorId, provider = null, launchId }) {
  if (!project || !UUID.test(supervisorId || "") || !UUID.test(launchId || "")) throw new UnavailableError("Review not started: no active compatible native supervisor owns this session.");
  project = path.resolve(project);
  const paths = statePaths(project, supervisorId, launchId);
  let controller;
  try { controller = readJson(project, paths.controller); }
  catch { throw new UnavailableError("Review not started: the owning native supervisor controller is unavailable or unsafe."); }
  const valid = controller?.schema_version === 2 && controller.task_handoff_version === 1
    && controller.supervisor_id === supervisorId && controller.launch_id === launchId
    && controller.project === project && PROVIDERS.has(controller.provider)
    && (!provider || controller.provider === provider) && controller.status === "running"
    && Number.isSafeInteger(controller.pid) && controller.pid > 0
    && Number.isFinite(timestamp(controller.launch_started_at));
  if (!valid) throw new UnavailableError("Review not started: supervisor ownership, provider, or launch generation does not match.");
  try { process.kill(controller.pid, 0); }
  catch (error) { if (error.code !== "EPERM") throw new UnavailableError("Review not started: the owning native supervisor is no longer running."); }
  return { project, supervisorId, provider: controller.provider, launchId, controller, paths };
}

function contextFromEnv(env) {
  if (env.WEB_KIT_CONTEXT_SUPERVISOR_ACTIVE !== "1" || !env.WEB_KIT_PROJECT_ROOT) throw new UnavailableError("Review not started: no active compatible native supervisor owns this session.");
  const context = readController({ project: env.WEB_KIT_PROJECT_ROOT, supervisorId: env.WEB_KIT_SUPERVISOR_ID, launchId: env.WEB_KIT_LAUNCH_ID });
  const relative = path.relative(fs.realpathSync(context.project), fs.realpathSync(process.cwd()));
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new UnavailableError("Review not started: the current working directory is outside the owning supervisor's project.");
  }
  return context;
}

function matchesContext(value, context) {
  return value?.schema_version === 1 && value.project === context.project
    && value.supervisor_id === context.supervisorId && value.provider === context.provider
    && value.launch_id === context.launchId && TASK_ID.test(value.task_id || "")
    && UUID.test(value.request_id || "") && Number.isFinite(timestamp(value.requested_at))
    && timestamp(value.requested_at) >= timestamp(context.controller.launch_started_at)
    && timestamp(value.requested_at) <= Date.now() + 1000;
}

function sameTask(left, right) {
  return ["project", "provider", "supervisor_id", "task_id", "request_id"].every((key) => left?.[key] === right?.[key]);
}

function readTask(context, taskId) {
  requireValue(TASK_ID.test(taskId || ""), "Invalid review task identity.");
  const paths = statePaths(context.project, context.supervisorId, context.launchId, taskId);
  const task = readJson(context.project, paths.request);
  requireValue(task?.schema_version === 1 && task.kind === "changes-review" && task.task_id === taskId
    && task.project === context.project && task.provider === context.provider && task.supervisor_id === context.supervisorId
    && UUID.test(task.request_id || "") && UUID.test(task.launch_id || "")
    && typeof task.original_request === "string" && task.original_request.trim()
    && typeof task.selection === "string" && task.selection.trim()
    && task.report_path === paths.report && typeof task.registered === "boolean" && Array.isArray(task.tracking_gaps)
    && Number.isFinite(timestamp(task.requested_at)), "Invalid isolated review request.");
  return { task, paths };
}

function readPending(context, { preparing = false } = {}) {
  const pending = readJson(context.project, context.paths.pending, true);
  if (!pending) return null;
  requireValue(matchesContext(pending, context) && pending.reason === "review-task"
    && (pending.status === "pending" || (preparing && pending.status === "preparing"))
    && !Object.hasOwn(pending, "safe_boundary") && !context.controller.active_review_task_id, "Invalid or stale pending review request.");
  if (pending.status === "preparing") return { pending };
  const { task, paths } = readTask(context, pending.task_id);
  requireValue(sameTask(pending, task) && pending.launch_id === task.launch_id && pending.requested_at === task.requested_at, "Pending review request does not match its task.");
  requireValue(!readJson(context.project, paths.claim, true) && !readJson(context.project, paths.result, true), "Review request was already claimed or finished.");
  return { pending, task, paths };
}

function activeReview(context, taskId) {
  requireValue(taskId && context.controller.active_review_task_id === taskId, "Review task does not own this native launch.");
  const { task, paths } = readTask(context, taskId);
  const handoff = readJson(context.project, paths.handoff);
  requireValue(handoff?.schema_version === 1 && handoff.kind === "changes-review" && sameTask(handoff, task)
    && handoff.launch_id === context.launchId && handoff.previous_launch_id === task.launch_id
    && handoff.launch_id !== handoff.previous_launch_id && validSession(handoff.previous_session_id)
    && handoff.report_path === paths.report, "Review handoff does not match the active native launch.");
  requireValue(!readJson(context.project, paths.result, true), "Review task has already finished.");
  return { task, paths, handoff };
}

function reportDigest(project, file) {
  const stat = checkedPath(project, file);
  requireValue(stat.size > 0 && stat.size <= MAX_REPORT_BYTES, "A nonempty review report is required (maximum 16 MiB).");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    requireValue(opened.isFile() && opened.nlink === 1 && opened.ino === stat.ino && opened.dev === stat.dev, "Review report changed while being read.");
    const bytes = fs.readFileSync(fd);
    requireValue(bytes.toString("utf8").trim(), "Review report cannot be blank.");
    return { digest: sha256(bytes), bytes: bytes.length };
  } finally { fs.closeSync(fd); }
}

function readReadyReceipt(context, review) {
  const ready = readJson(context.project, review.paths.ready, true);
  if (!ready) return { ...review, ready: null };
  requireValue(matchesContext(ready, context) && ready.status === "report-ready" && sameTask(ready, review.task)
    && ready.previous_launch_id === review.handoff.previous_launch_id && ready.report_path === review.paths.report
    && /^[a-f0-9]{64}$/.test(ready.report_digest || ""), "Review receipt does not match the active native launch.");
  const report = reportDigest(context.project, review.paths.report);
  requireValue(report.digest === ready.report_digest && report.bytes === ready.report_bytes, "Review report changed after its receipt was staged.");
  return { ...review, ready };
}

function observeReviewDelivery(context, review) {
  try {
    const complete = readReadyReceipt(context, review);
    return complete.ready ? complete : { ...review, failure_code: "missing-report-receipt" };
  } catch {
    return { ...review, failure_code: "invalid-report-receipt" };
  }
}

function failedBoundary(context, review, sessionId, source, boundaryAt, failureCode) {
  return {
    schema_version: 1, reason: "review-failed", safe_boundary: true,
    project: context.project, provider: context.provider, supervisor_id: context.supervisorId,
    launch_id: context.launchId, previous_launch_id: review.handoff.previous_launch_id,
    task_id: review.task.task_id, request_id: review.task.request_id,
    session_id: sessionId, source, requested_at: boundaryAt, boundary_at: boundaryAt,
    failure_code: failureCode, failure_reason: REVIEW_FAILURES[failureCode],
  };
}

function artifactFingerprint(project, file, maxBytes) {
  checkedPath(project, path.dirname(file), { directory: true });
  let stat;
  try { stat = fs.lstatSync(file, { bigint: true }); }
  catch (error) { if (error.code === "ENOENT") return "missing"; throw error; }
  const identity = (value) => ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"].map((key) => String(value[key]));
  const metadata = identity(stat);
  // Fingerprint invalid aliases/types without reading through them. A stable
  // invalid receipt/report can fail at a genuine boundary; changing it makes
  // the earlier observation stale, just as replacing a valid file does.
  if (!stat.isFile() || stat.nlink !== 1n || stat.size > BigInt(maxBytes)) return sha256(JSON.stringify(metadata));
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd, { bigint: true });
    requireValue(JSON.stringify(identity(opened)) === JSON.stringify(metadata), "Review state changed during boundary observation.");
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    requireValue(JSON.stringify(identity(after)) === JSON.stringify(metadata), "Review state changed during boundary observation.");
    return sha256(JSON.stringify(metadata) + sha256(bytes));
  } catch (error) {
    if (["EACCES", "EPERM"].includes(error.code)) return sha256(JSON.stringify(metadata) + error.code);
    throw error;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function boundaryFingerprint(context, review, active) {
  const files = active
    ? [[review.paths.request, MAX_JSON_BYTES], [review.paths.handoff, MAX_JSON_BYTES], [review.paths.ready, MAX_JSON_BYTES], [review.paths.report, MAX_REPORT_BYTES]]
    : [[review.paths.request, MAX_JSON_BYTES], [review.paths.pending, MAX_JSON_BYTES]];
  return sha256(JSON.stringify(files.map(([file, limit]) => [path.basename(file), artifactFingerprint(context.project, file, limit)])));
}

export function hasTaskReviewActivity(env = process.env) {
  try {
    const context = contextFromEnv(env);
    // Corrupt/missing review artifacts must not send this launch back through
    // implementation progress tracking or threshold continuation.
    if (env.WEB_KIT_REVIEW_TASK_ID) return context.controller.active_review_task_id === env.WEB_KIT_REVIEW_TASK_ID;
    return Boolean(readPending(context, { preparing: true }));
  } catch { return false; }
}

export function captureReviewBoundary(provider, sessionId, source, env = process.env) {
  // Capture before context scans or arbitrary user notification hooks. The
  // snapshot is carried through publication and supervisor validation so an
  // older callback cannot consume a task/receipt staged while its hook waits.
  const observedAt = nowIso();
  try {
    const context = contextFromEnv(env);
    if (provider !== context.provider || source !== BOUNDARY_SOURCE[provider] || !validSession(sessionId)) return null;
    const activeTask = env.WEB_KIT_REVIEW_TASK_ID;
    const review = activeTask ? activeReview(context, activeTask) : readPending(context, { preparing: true });
    if (!review || (!activeTask && review.pending.status !== "pending")) return null;
    if (activeTask && sessionId === review.handoff.previous_session_id) return null;
    const fingerprint = boundaryFingerprint(context, review, Boolean(activeTask));
    let request;
    if (activeTask) {
      const complete = observeReviewDelivery(context, review);
      request = complete.failure_code
        ? failedBoundary(context, review, sessionId, source, observedAt, complete.failure_code)
        : { ...complete.ready, reason: "review-complete", session_id: sessionId };
    } else {
      request = { ...review.pending, reason: "review-task", session_id: sessionId };
    }
    if (timestamp(request.requested_at) > timestamp(observedAt)
      || boundaryFingerprint(context, review, Boolean(activeTask)) !== fingerprint) return null;
    return { ...request, safe_boundary: true, source, boundary_at: observedAt, boundary_fingerprint: fingerprint };
  } catch { return null; }
}

export function publishReviewBoundary(provider, sessionId, source, env = process.env, observation = undefined) {
  // Explicit null means capture found nothing eligible; never recapture after
  // a slow hook. The undefined default preserves direct, immediate callers.
  const captured = observation === undefined ? captureReviewBoundary(provider, sessionId, source, env) : observation;
  const ownsActivity = hasTaskReviewActivity(env);
  if (!captured) return ownsActivity;
  try {
    const context = contextFromEnv(env);
    requireValue(captured.provider === provider && captured.session_id === sessionId && captured.source === source, "Review observation does not match this native event.");
    const transition = readReviewTransition(captured, context);
    if (!transition) return ownsActivity;
    const current = readController(context);
    requireValue(current.controller.active_review_task_id === context.controller.active_review_task_id, "Supervisor task changed before the boundary.");
    // A task transition takes precedence over a simultaneous threshold request.
    // Keep a still-valid terminal observation. A changed snapshot needs a NEW
    // genuine boundary, which may replace only that same task/launch's stale
    // observation, never another task's transition or unrecognizable state.
    const existing = readJson(context.project, context.paths.trigger, true);
    if (existing && existing.reason !== "context-threshold") {
      if (!sameTask(existing, captured) || existing.launch_id !== captured.launch_id
        || !["review-task", "review-complete", "review-failed"].includes(existing.reason)
        || readReviewTransition(existing, context)) return true;
    }
    writeJson(context.project, context.paths.trigger, captured, { exclusive: !existing });
  } catch { /* Invalid ownership or unsafe state must not interrupt the native session. */ }
  return ownsActivity;
}

export function readReviewTransition(request, owner) {
  try {
    const context = readController(owner);
    requireValue(matchesContext(request, context) && request.safe_boundary === true
      && request.source === BOUNDARY_SOURCE[context.provider] && validSession(request.session_id)
      && ["review-task", "review-complete", "review-failed"].includes(request.reason)
      && /^[a-f0-9]{64}$/.test(request.boundary_fingerprint || "")
      && Number.isFinite(timestamp(request.boundary_at)) && timestamp(request.boundary_at) >= timestamp(request.requested_at)
      && timestamp(request.boundary_at) <= Date.now() + 1000, "Invalid review boundary request.");
    if (request.reason === "review-task") {
      const pending = readPending(context);
      requireValue(pending && sameTask(request, pending.pending) && request.requested_at === pending.pending.requested_at, "Review boundary does not match a pending task.");
      requireValue(request.boundary_fingerprint === boundaryFingerprint(context, pending, false), "Pending review changed after this boundary was observed.");
      return { ...request, ...pending, controller: context.controller };
    }
    const review = activeReview(context, request.task_id);
    requireValue(sameTask(request, review.task) && request.previous_launch_id === review.handoff.previous_launch_id
      && request.session_id !== review.handoff.previous_session_id, "Review boundary does not belong to a fresh native review.");
    requireValue(request.boundary_fingerprint === boundaryFingerprint(context, review, true), "Review artifacts changed after this boundary was observed.");
    const complete = observeReviewDelivery(context, review);
    requireValue(request.boundary_fingerprint === boundaryFingerprint(context, review, true), "Review artifacts changed while validating this boundary.");
    if (request.reason === "review-failed") {
      requireValue(Object.hasOwn(REVIEW_FAILURES, request.failure_code)
        && request.failure_reason === REVIEW_FAILURES[request.failure_code]
        && request.requested_at === request.boundary_at && complete.failure_code === request.failure_code, "Invalid terminal review failure.");
      // A stable failed observation terminates only this review. If newer work
      // repairs or changes its artifacts, the fingerprint above rejects this
      // older boundary completely; it cannot stop a newer active turn.
      return {
        ...request,
        ...review, controller: context.controller,
      };
    }
    requireValue(request.status === "report-ready" && request.report_path === review.paths.report
      && /^[a-f0-9]{64}$/.test(request.report_digest || "")
      && Number.isSafeInteger(request.report_bytes) && request.report_bytes > 0, "Invalid review completion envelope.");
    requireValue(complete.ready && request.requested_at === complete.ready.requested_at
      && request.report_digest === complete.ready.report_digest && request.report_bytes === complete.ready.report_bytes, "Review completion receipt does not match its observed boundary.");
    return { ...request, ...complete, controller: context.controller };
  } catch { return null; }
}

function revalidateTransition(transition, reason) {
  const current = readReviewTransition(transition, {
    project: transition?.project, supervisorId: transition?.supervisor_id,
    provider: transition?.provider, launchId: transition?.launch_id,
  });
  requireValue(current && current.reason === reason, "Review transition is no longer valid.");
  requireValue(current.controller.pid === process.pid, "Only the owning supervisor can apply a review transition.");
  return current;
}

function trackingMarker(task) { return `Native review request ${task.request_id}`; }
function ownedJob(task, paths) {
  const job = readJson(task.project, paths.job, true);
  requireValue(job && job.task_id === task.task_id && job.classification === "SMALL" && job.pr_bound === false
    && job.evidence?.items?.some((item) => item.value === trackingMarker(task)), "Registered review job ownership could not be verified.");
  return job;
}

function runProgress(task, paths, args, { registration = false } = {}) {
  try {
    checkedPath(task.project, paths.workProgress);
    checkedPath(task.project, paths.job, { missing: true, createParents: true });
    checkedPath(task.project, path.join(paths.state, "metrics", "workflow-efficiency.json"), { missing: true, createParents: true });
    if (!registration) ownedJob(task, paths);
    const result = spawnSync(process.execPath, [paths.workProgress, ...args, "--project", task.project, "--task-id", task.task_id], {
      cwd: task.project, env: process.env, encoding: "utf8", timeout: 15_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    });
    if (result.error || result.status !== 0) return `Review tracking: ${result.error?.message || String(result.stderr || result.stdout || `exit ${result.status}`).trim().slice(0, 1000)}`;
    return null;
  } catch (error) { return `Review tracking: ${error.message}`; }
}

export function startReviewTransition(transition, newLaunchId) {
  const current = revalidateTransition(transition, "review-task");
  requireValue(UUID.test(newLaunchId || "") && newLaunchId !== current.launch_id, "A new native review launch identity is required.");
  const { task, paths } = current;
  checkedPath(task.project, paths.claim, { missing: true });
  // The exclusive hard link is the atomic claim. Exactly one supervisor action
  // can acquire it; removing the pending name cannot claim a different request.
  fs.linkSync(paths.pending, paths.claim);
  fs.unlinkSync(paths.pending);
  const gaps = [...(task.tracking_gaps || [])];
  if (task.registered) {
    const gap = runProgress(task, paths, ["update", "--status", "REVIEWING", "--agent", `review-launch:${newLaunchId}`,
      "--evidence", `Native review launch ${newLaunchId}; session identity will be observed at its completion boundary.`,
      "--next", "Inspect the selected source, save one report, signal report-ready, and deliver the report."]);
    if (gap) gaps.push(gap);
  }
  readController({ project: task.project, supervisorId: task.supervisor_id, provider: task.provider, launchId: task.launch_id });
  writeJson(task.project, paths.handoff, {
    schema_version: 1, kind: "changes-review", status: "reviewing",
    project: task.project, provider: task.provider, supervisor_id: task.supervisor_id,
    task_id: task.task_id, request_id: task.request_id,
    launch_id: newLaunchId, previous_launch_id: task.launch_id, previous_session_id: current.session_id,
    original_request: task.original_request, selection: task.selection,
    created_at: nowIso(), report_path: paths.report, registered: task.registered, tracking_gaps: gaps,
    instructions: [
      "Perform this one standalone source review using the exact request and selected source. Read current project instructions and preserve the provider's existing permissions and policies.",
      "Do not load or resume the builder transcript, implementation handoff, implementation job, scope, queue, or prior review conclusions. Do not continue implementation or start another task.",
      "Inspect source read-only. Write only this new task's fixed report.md and its task-specific bookkeeping through task-handoff.mjs. Do not edit source, tests, original task records, or approval fields.",
      "Missing source, no changes, and partial coverage are report outcomes. State gaps and evidence; do not claim clean code or approval from absent evidence.",
      "Present the structured plain-text review as your sole final native response. The native completion hook persists the report and stages its receipt; do not require model-side report writes or report-ready.",
      "Finish after this single report. The outer supervisor verifies the native completion boundary and stops this review session; it does not resume implementation.",
    ],
  });
  return { taskId: task.task_id, handoffPath: paths.handoff };
}

export function finishReviewTransition(transition) {
  const current = revalidateTransition(transition, "review-complete");
  const { task, paths, handoff, ready } = current;
  const gaps = [...(handoff.tracking_gaps || task.tracking_gaps || [])];
  // Recheck the bytes immediately before publishing delivery. A receipt records
  // report delivery, not a certification of findings or code quality.
  const report = reportDigest(task.project, paths.report);
  requireValue(report.digest === ready.report_digest, "Review report changed before delivery was recorded.");
  readController({ project: task.project, supervisorId: task.supervisor_id, provider: task.provider, launchId: current.launch_id });
  const result = {
    schema_version: 1, status: "delivered", project: task.project, provider: task.provider,
    supervisor_id: task.supervisor_id, task_id: task.task_id, request_id: task.request_id,
    launch_id: current.launch_id, previous_launch_id: handoff.previous_launch_id,
    session_id: current.session_id, previous_session_id: handoff.previous_session_id,
    report_path: paths.report, report_digest: ready.report_digest, report_bytes: ready.report_bytes,
    delivered_at: nowIso(), source: current.source, registered: task.registered,
    tracking_gaps: gaps, certifies: "report-delivery-only",
  };
  writeJson(task.project, paths.result, result);
  // Delivery is durable before optional job bookkeeping. A tracking failure
  // cannot turn an already delivered report into a fabricated code approval.
  if (task.registered) {
    const gap = runProgress(task, paths, ["update", "--status", "DONE", "--final-validation", "PASS",
      "--evidence", `Delivered standalone review report ${paths.report}; SHA-256 ${ready.report_digest}; native session ${current.session_id}. Report delivery is not code or PR approval.`,
      "--next", "Review report delivered; stop this task."]);
    if (gap) {
      gaps.push(gap);
      writeJson(task.project, paths.result, result, { exclusive: false });
    }
  }
  return result;
}

export function failReviewTransition(project, taskId, reason) {
  project = path.resolve(project);
  requireValue(TASK_ID.test(taskId || ""), "Invalid review task identity.");
  const requestPath = path.join(project, ".agent-core", "state", "reviews", taskId, "request.json");
  const task = readJson(project, requestPath);
  requireValue(task?.project === project && task.task_id === taskId && UUID.test(task.supervisor_id || "") && UUID.test(task.launch_id || ""), "Invalid failed review ownership.");
  const paths = statePaths(project, task.supervisor_id, task.launch_id, taskId);
  const existing = readJson(project, paths.result, true);
  if (existing) return existing;
  const handoff = readJson(project, paths.handoff, true);
  const launchId = handoff?.launch_id || task.launch_id;
  const context = readController({ project, supervisorId: task.supervisor_id, provider: task.provider, launchId });
  requireValue(context.controller.pid === process.pid, "Only the owning supervisor can fail a review transition.");
  const owned = handoff ? activeReview(context, taskId) : readPending(context);
  requireValue(owned && sameTask(owned.task, task), "Failed review does not own a pending or active native task.");
  const gaps = [...(handoff?.tracking_gaps || task.tracking_gaps || [])];
  if (task.registered) {
    const gap = runProgress(task, paths, ["update", "--status", "FAILED", "--evidence", `Standalone review did not deliver: ${String(reason)}`, "--next", "Report the review delivery failure; do not resume implementation automatically."]);
    if (gap) gaps.push(gap);
  }
  const result = {
    schema_version: 1, status: "failed", project, provider: task.provider,
    supervisor_id: task.supervisor_id, task_id: taskId, request_id: task.request_id,
    launch_id: launchId, reason: String(reason), failed_at: nowIso(),
    registered: task.registered, tracking_gaps: gaps,
  };
  readController(context);
  writeJson(project, paths.result, result);
  if (!handoff) {
    const pending = readJson(project, paths.pending, true);
    if (pending && sameTask(pending, owned.pending) && pending.launch_id === context.launchId
      && pending.requested_at === owned.pending.requested_at) fs.unlinkSync(paths.pending);
  }
  return result;
}

// Unsupervised Codex Desktop/IDE sessions cannot hand off to the terminal
// supervisor retroactively. This route starts a distinct, bounded, read-only
// Codex CLI process. It never evaluates the review in the caller's context.
function findReviewProject(start) {
  let current = path.resolve(start);
  for (;;) {
    const config = path.join(current, ".agent-kit.json");
    try {
      if (readJson(current, config, true)?.kit === "web-dev-agent-kit") return current;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function standaloneCodexBinary(env, project) {
  // A project's PATH, particularly node_modules/.bin during npm scripts,
  // is untrusted source code. Never execute a project-owned provider shim:
  // CLI flags like --sandbox read-only cannot constrain a fake executable.
  const projectRoot = fs.realpathSync(project);
  const controlledRoots = [projectRoot];
  for (let ancestor = path.dirname(projectRoot); ancestor !== path.dirname(ancestor); ancestor = path.dirname(ancestor)) {
    // In a nested Web Kit project, the monorepo's node_modules/.bin is just
    // as untrusted as the nested package's own local bin directory.
    if (fs.existsSync(path.join(ancestor, ".git"))) {
      controlledRoots.push(fs.realpathSync(ancestor));
      break;
    }
  }
  const shim = path.resolve(env.WEB_KIT_HOME || path.join(env.WEB_KIT_USER_HOME || os.homedir(), ".web-kit"), "bin");
  let realShim = shim;
  try { realShim = fs.realpathSync(shim); } catch {}
  const inside = (file, root) => {
    const relative = path.relative(root, file);
    return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep);
  };
  const forbidden = file => controlledRoots.some(root => inside(file, root))
    || inside(file, shim) || inside(file, realShim);
  const safeTarget = file => {
    const lexical = path.resolve(file);
    if (forbidden(lexical)) return null;
    const canonical = fs.realpathSync(lexical);
    if (forbidden(canonical) || !fs.statSync(canonical).isFile()) return null;
    return canonical;
  };
  const override = env.WEB_KIT_STANDALONE_CODEX_BIN;
  const candidates = override ? [path.resolve(override)] : String(env.PATH || "").split(path.delimiter).filter(Boolean)
    .flatMap(dir => (process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"])
      .map(name => path.resolve(dir, name)));
  for (const candidate of candidates) {
    try {
      const executable = safeTarget(candidate);
      if (!executable) continue;
      if (/\.(?:js|mjs|cjs)$/i.test(executable)) return { command: process.execPath, prefix: [executable] };
      if (/\.cmd$/i.test(executable)) {
        // Only recognized npm Node shims; never launch arbitrary batch code.
        const contents = fs.readFileSync(executable, "utf8");
        const scripts = [...contents.matchAll(/"([^"\r\n]+\.(?:mjs|cjs|js))"/gi)];
        for (let i = scripts.length - 1; i >= 0; i--) {
          let script = scripts[i][1].replace(/%~?dp0%?/gi, path.dirname(executable) + path.sep);
          if (!path.isAbsolute(script)) script = path.resolve(path.dirname(executable), script);
          const target = safeTarget(script);
          if (target && /\.(?:mjs|cjs|js)$/i.test(target)) return { command: process.execPath, prefix: [target] };
        }
        continue;
      }
      if (process.platform !== "win32") fs.accessSync(executable, fs.constants.X_OK);
      return { command: executable, prefix: [] };
    } catch {}
  }
  throw new UnavailableError("Review not started: no independent Codex CLI executable was found outside project-controlled paths and Web Kit shims. Install the trusted global Codex CLI, configure WEB_KIT_STANDALONE_CODEX_BIN to its external path, or use the supervised terminal launcher.");
}

function collectUnsupervisedCodexReport(raw) {
  let thread = null, text = null, completed = false;
  for (const line of String(raw).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "error" || event.type === "turn.failed") throw new Error("Independent Codex review failed.");
    if (event.type === "thread.started") {
      requireValue(!thread && validSession(event.thread_id), "Fresh Codex reviewer returned an invalid or reused thread start.");
      thread = event.thread_id;
    } else if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string") {
      requireValue(thread && !completed, "Reviewer output arrived outside its new thread.");
      text = event.item.text;
    } else if (event.type === "turn.completed") {
      requireValue(thread && !completed, "Reviewer completion arrived without a new thread.");
      completed = true;
    }
  }
  requireValue(completed && thread && text, "Fresh Codex reviewer did not return a verified completed report.");
  return { sessionId: thread, message: text };
}

function runUnsupervisedReview(originalRequest, selection, env) {
  requireValue(!env.WEB_KIT_REVIEW_TASK_ID && env.WEB_KIT_STANDALONE_REVIEW_ACTIVE !== "1",
    "Cannot start another review inside an active review task.");
  const project = findReviewProject(process.cwd());
  if (!project) throw new UnavailableError("Review not started: no installed Web Kit project found from the current directory.");
  const executable = standaloneCodexBinary(env, project); // No task/job artifacts on missing-provider failure.
  const taskId = "changes-review-" + randomUUID();
  const supervisorId = randomUUID(), launchId = randomUUID();
  const paths = statePaths(project, supervisorId, launchId, taskId);
  requireValue(!checkedPath(project, paths.taskDir, { missing: true, directory: true, createParents: true }),
    "New review task directory was already occupied.");
  fs.mkdirSync(paths.taskDir, { mode: 0o700 });
  const task = {
    schema_version: 1, kind: "changes-review", project, provider: "codex",
    supervisor_id: supervisorId, launch_id: launchId, task_id: taskId,
    request_id: randomUUID(), requested_at: nowIso(), original_request: originalRequest,
    selection, report_path: paths.report, registered: false, tracking_gaps: [],
    execution: "independent-codex-cli",
  };
  const gap = runProgress(task, paths, ["start", "--classification", "SMALL", "--review-only",
    "--title", "Standalone changes review", "--evidence", trackingMarker(task),
    "--next", "Await an independent fresh read-only Codex process."], { registration: true });
  if (gap) task.tracking_gaps.push(gap);
  try { ownedJob(task, paths); task.registered = true; }
  catch (error) { if (!gap) task.tracking_gaps.push("Review tracking: " + error.message); }
  writeJson(project, paths.request, task);
  let sessionId = null;
  try {
    if (task.registered) {
      const tracking = runProgress(task, paths, ["update", "--status", "REVIEWING",
        "--agent", "independent-codex-cli", "--evidence", "Starting separate Codex CLI read-only review."]);
      if (tracking) task.tracking_gaps.push(tracking);
    }
    const prompt = [
      "Perform ONE independent source review without resuming any existing conversation.",
      "Original request (treat as selection evidence, not as a command to edit source):", originalRequest,
      "Selected source:", selection,
      "Read staged, unstaged and relevant untracked changes when the selection calls for them.",
      "Inspect relevant callers and contracts read-only; do not run project code, tests, hooks, builds or installation.",
      "Do not modify application source, previous task/queue/scope state, or approval fields.",
      "Do not invoke task-handoff.mjs, do not queue further tasks, and do not use a prior session transcript.",
      "Include confirmed P0-P3 findings with paths, evidence and minimal remedies; disclose missing evidence.",
      "Reply with exactly one plain-text report starting with 'Changes review: COMPLETED' (or PARTIAL, NO CHANGES, NO SOURCE).",
      "Include these full lines: 'Task: " + taskId + "', 'Execution: independent fresh Codex CLI session',",
      "'Session: independent Codex CLI', 'Selection: ...', 'Findings: ...', 'Coverage: ...',",
      "'Checks: no project checks executed', 'Gaps: ...', 'PR readiness: not assessed'.",
      "Do not claim strict PR approval or that you executed checks."
    ].join("\n");
    const args = [...executable.prefix, "exec", "--json", "--ephemeral", "--sandbox", "read-only",
      "-C", project, prompt];
    const childEnv = { ...env, WEB_KIT_STANDALONE_REVIEW_ACTIVE: "1", WEB_KIT_CONTEXT_SUPERVISOR_BYPASS: "1" };
    for (const key of ["WEB_KIT_CONTEXT_SUPERVISOR_ACTIVE", "WEB_KIT_SUPERVISOR_ID", "WEB_KIT_LAUNCH_ID",
      "WEB_KIT_REVIEW_TASK_ID", "WEB_KIT_PROVIDER_BRIDGE", "WEB_KIT_CONTEXT_SUPERVISOR_HANDOFF"]) delete childEnv[key];
    const result = spawnSync(executable.command, args, {
      cwd: project, env: childEnv, encoding: "utf8", windowsHide: true,
      shell: false, timeout: 180000, maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      throw new Error("Independent Codex reviewer did not complete successfully (" +
        (result.error?.code || "exit " + result.status) + ").");
    }
    const reviewed = collectUnsupervisedCodexReport(result.stdout);
    sessionId = reviewed.sessionId;
    const reportText = completeReviewText(reviewed.message, taskId);
    requireValue(reportText, "Independent Codex reviewer returned an incomplete or invalid report.");
    // Model-side read-only constraints never need to grant report storage writes.
    checkedPath(project, paths.report, { missing: true });
    fs.writeFileSync(paths.report, reportText, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const report = reportDigest(project, paths.report);
    const receipt = {
      schema_version: 1, status: "report-ready", project, provider: "codex", task_id: taskId,
      request_id: task.request_id, launch_id: launchId, session_id: sessionId,
      report_path: paths.report, report_digest: report.digest, report_bytes: report.bytes,
      requested_at: nowIso(), execution: "independent-codex-cli",
    };
    writeJson(project, paths.ready, receipt);
    const delivered = {
      schema_version: 1, status: "delivered", project, provider: "codex",
      task_id: taskId, request_id: task.request_id, session_id: sessionId,
      report_path: paths.report, report_digest: report.digest, report_bytes: report.bytes,
      delivered_at: nowIso(), certifies: "report-delivery-only",
      registered: task.registered, tracking_gaps: [...task.tracking_gaps],
      tracking_status: task.registered ? "PENDING" : "UNREGISTERED",
      execution: "independent-codex-cli",
    };
    // Publish the verified report delivery before optional progress bookkeeping.
    writeJson(project, paths.result, delivered);
    if (task.registered) {
      const gap = runProgress(task, paths, ["update", "--status", "DONE",
        "--final-validation", "PASS", "--evidence", "Independent Codex report delivered: " + paths.report]);
      if (gap) task.tracking_gaps.push(gap);
      delivered.tracking_gaps = [...task.tracking_gaps];
      delivered.tracking_status = gap ? "INCOMPLETE" : "DONE";
      // An unsuccessful final DONE must remain visible in both durable evidence
      // and the CLI response; never claim a successfully completed tracked job.
      writeJson(project, paths.result, delivered, { exclusive: false });
    }
    return { status: "delivered", task_id: taskId, session_id: sessionId,
      report_path: paths.report, result_path: paths.result,
      report: reportText, tracking_gaps: [...task.tracking_gaps],
      tracking_status: delivered.tracking_status, execution: "independent-codex-cli",
      pr_readiness: "not assessed" };
  } catch (error) {
    if (task.registered) runProgress(task, paths, ["update", "--status", "FAILED",
      "--evidence", "Independent review delivery failed: " + error.message]);
    writeJson(project, paths.result, {
      schema_version: 1, status: "failed", project, provider: "codex", task_id: taskId,
      request_id: task.request_id, session_id: sessionId,
      reason: error.message, failed_at: nowIso(), execution: "independent-codex-cli",
      registered: task.registered, tracking_gaps: task.tracking_gaps,
    });
    throw new UnavailableError("Review not completed: " + error.message + " (task " + taskId + ").");
  }
}

function requestReview(originalRequest, selection, env = process.env) {
  requireValue(typeof originalRequest === "string" && originalRequest.trim(), "--request must contain the user's review request.");
  requireValue(typeof selection === "string" && selection.trim(), "--selection must describe the selected source or current working tree.");
  requireValue(Buffer.byteLength(JSON.stringify({ originalRequest, selection })) < MAX_JSON_BYTES / 2, "Review request and selection are too large.");
  let context;
  try { context = contextFromEnv(env); }
  catch (error) {
    if (error instanceof UnavailableError) return runUnsupervisedReview(originalRequest, selection, env);
    throw error;
  }
  requireValue(!env.WEB_KIT_REVIEW_TASK_ID && !context.controller.active_review_task_id, "This launch is already running a standalone review.");
  const taskId = `changes-review-${randomUUID()}`;
  const paths = statePaths(context.project, context.supervisorId, context.launchId, taskId);
  const pending = {
    schema_version: 1, reason: "review-task", status: "preparing", project: context.project,
    provider: context.provider, supervisor_id: context.supervisorId, launch_id: context.launchId,
    task_id: taskId, request_id: randomUUID(), requested_at: nowIso(),
  };
  writeJson(context.project, paths.pending, pending);
  let task;
  try {
    requireValue(!checkedPath(context.project, paths.job, { missing: true }), "Generated review task already has a job.");
    requireValue(!checkedPath(context.project, path.join(paths.state, "scope", `${taskId}.json`), { missing: true }), "Generated review task already has a scope.");
    requireValue(!checkedPath(context.project, paths.taskDir, { missing: true, directory: true, createParents: true }), "Generated review report directory already exists.");
    fs.mkdirSync(paths.taskDir, { mode: 0o700 }); // Exclusive directory reservation; never reuse a report directory.
    task = {
      ...pending, kind: "changes-review", original_request: originalRequest, selection,
      report_path: paths.report, registered: false, tracking_gaps: [],
    };
    delete task.reason;
    delete task.status;
    const gap = runProgress(task, paths, ["start", "--classification", "SMALL", "--review-only", "--title", "Standalone changes review",
      "--evidence", trackingMarker(task), "--next", "Await the owning native supervisor's safe turn boundary."], { registration: true });
    if (gap) task.tracking_gaps.push(gap);
    try { ownedJob(task, paths); task.registered = true; }
    catch (error) { if (!gap) task.tracking_gaps.push(`Review tracking: ${error.message}`); }
    readController(context);
    writeJson(context.project, paths.request, task);
    const reserved = readJson(context.project, paths.pending);
    requireValue(sameTask(reserved, pending) && reserved.status === "preparing", "Review pending reservation changed.");
    writeJson(context.project, paths.pending, { ...pending, status: "pending" }, { exclusive: false });
    return {
      status: "queued", task_id: taskId, request_id: task.request_id,
      handoff_path: paths.handoff, report_path: paths.report, pending_path: paths.pending,
      registered: task.registered, tracking_gaps: task.tracking_gaps,
    };
  } catch (error) {
    // Remove only our unpublished reservation. An abandoned registered job is
    // explicitly failed when the same live launch still owns it.
    try {
      const reserved = readJson(context.project, paths.pending, true);
      if (sameTask(reserved, pending)) fs.unlinkSync(paths.pending);
      if (task?.registered) {
        readController(context);
        runProgress(task, paths, ["update", "--status", "FAILED", "--evidence", `Review staging failed: ${error.message}`]);
      }
    } catch {}
    throw error;
  }
}

function reportReady(env = process.env) {
  const context = contextFromEnv(env);
  const review = activeReview(context, env.WEB_KIT_REVIEW_TASK_ID);
  const report = reportDigest(context.project, review.paths.report);
  const receipt = {
    schema_version: 1, status: "report-ready", project: context.project, provider: context.provider,
    supervisor_id: context.supervisorId, launch_id: context.launchId,
    previous_launch_id: review.handoff.previous_launch_id,
    task_id: review.task.task_id, request_id: review.task.request_id, requested_at: nowIso(),
    report_path: review.paths.report, report_digest: report.digest, report_bytes: report.bytes,
  };
  const existing = readJson(context.project, review.paths.ready, true);
  if (existing) {
    requireValue(matchesContext(existing, context) && sameTask(existing, receipt)
      && existing.status === receipt.status && existing.report_digest === receipt.report_digest
      && existing.report_path === receipt.report_path, "A conflicting report receipt already exists.");
    return existing;
  }
  readController(context);
  writeJson(context.project, review.paths.ready, receipt);
  return receipt;
}

// Native completion hooks may persist a complete review even when the model
// session has no permission to write report.md. This certifies delivery only,
// never the findings or PR readiness.
function completeReviewText(message, taskId) {
  if (typeof message !== "string" || Buffer.byteLength(message, "utf8") > 512 * 1024) return null;
  const report = message.trim();
  if (!report.startsWith("Changes review: ")
    || !/^Changes review: (?:COMPLETED|PARTIAL|NO CHANGES|NO SOURCE)\r?$/m.test(report)
    || !report.split(/\r?\n/).some(line => line === "Task: " + taskId)
    || !/^Execution: (?:fresh native supervisor session|independent fresh Codex CLI session)\r?$/m.test(report)
    || !/^Selection: .+$/m.test(report) || !/^Findings: .+$/m.test(report)
    || !/^Coverage: .+$/m.test(report) || !/^Checks: .+$/m.test(report)
    || !/^Gaps: .+$/m.test(report) || !/^PR readiness: not assessed\r?$/m.test(report)) return null;
  return report + "\n";
}

export function stageNativeReviewOutput(provider, sessionId, finalMessage, env = process.env) {
  // Do not accept another task, earlier launch, resumed builder session,
  // malformed report, or conflicting report/receipt. Only real native hooks
  // should call this before the existing completion-boundary check.
  try {
    if (!validSession(sessionId) || !env.WEB_KIT_REVIEW_TASK_ID) return false;
    const context = contextFromEnv(env);
    if (context.provider !== provider) return false;
    const review = activeReview(context, env.WEB_KIT_REVIEW_TASK_ID);
    if (sessionId === review.handoff.previous_session_id
      || readJson(context.project, review.paths.ready, true)) return false;
    const reportText = completeReviewText(finalMessage, review.task.task_id);
    if (!reportText) return false;
    const existing = checkedPath(context.project, review.paths.report, { missing: true });
    if (existing) {
      // Never overwrite an earlier report, even if the current model text differs.
      if (reportDigest(context.project, review.paths.report).digest !== sha256(Buffer.from(reportText))) return false;
    } else {
      const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
      const fd = fs.openSync(review.paths.report, flags, 0o600);
      try { fs.writeFileSync(fd, reportText, "utf8"); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
    }
    reportReady(env); // Native-bound report receipt, rechecked at the actual completion boundary.
    return true;
  } catch { return false; } // Existing missing/invalid receipt path fails closed.
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const match = args[i].match(/^(--request|--selection|--request-file)(?:=(.*))?$/s);
    requireValue(match && !Object.hasOwn(out, match[1]), `Unknown or repeated argument: ${args[i]}`);
    const value = match[2] === undefined ? args[++i] : match[2];
    requireValue(typeof value === "string", `${match[1]} requires a value.`);
    out[match[1]] = value;
  }
  return out;
}

function main(args) {
  const command = args[0];
  if (!command || command === "help" || command === "--help") {
    process.stdout.write("Web Kit native task handoff\n\n  request-review --request TEXT --selection TEXT\n  request-review --request-file FILE.json\n  report-ready\n\nUses the native supervisor when present, or launches a fresh independent Codex CLI review. Request files contain {original_request, selection}.\n");
    return;
  }
  let result;
  if (command === "request-review") {
    const options = parseArgs(args.slice(1));
    let request = options["--request"];
    let selection = options["--selection"];
    if (options["--request-file"] !== undefined) {
      requireValue(request === undefined && selection === undefined, "Use --request-file or --request with --selection, not both.");
      let project;
      try { project = contextFromEnv(process.env).project; }
      catch (error) { if (!(error instanceof UnavailableError)) throw error; project = findReviewProject(process.cwd()); }
      requireValue(project, "Review not started: no installed Web Kit project found.");
      const file = path.resolve(project, options["--request-file"]);
      const stat = checkedPath(project, file);
      requireValue(stat.isFile() && stat.size <= MAX_JSON_BYTES, "Review request file is invalid or too large.");
      const input = JSON.parse(fs.readFileSync(file, "utf8"));
      request = input.original_request;
      selection = input.selection;
    }
    result = requestReview(request, selection);
  } else if (command === "report-ready") {
    requireValue(args.length === 1, "report-ready accepts no path or task override.");
    result = reportReady();
  } else throw new Error(`Unknown task handoff command: ${command}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

// Node canonicalizes ESM modules, but argv[1] can retain an installed symlink or macOS /private alias.
const invokedEntrypoint = Boolean(process.argv[1]) &&
  fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedEntrypoint) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ status: error instanceof UnavailableError ? "unavailable" : "rejected", error: error.message })}\n`);
    process.exitCode = 1;
  }
}
