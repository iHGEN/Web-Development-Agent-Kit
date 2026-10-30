#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createQuality, ensureQuality, assertSpecificationReady, evaluateQuality, QUALITY_COMMANDS, runQualityCommand } from "./quality-pipeline.mjs";

const CLASSIFICATIONS = new Set(["SMALL", "MEDIUM", "LARGE"]);
const JOB_STATUSES = new Set([
  "QUEUED", "DISCOVERING", "PLANNING", "IMPLEMENTING", "TESTING", "REVIEWING",
  "FIXING", "VALIDATING", "DONE", "BLOCKED", "WAITING_USER", "WAITING_EXTERNAL",
  "FAILED", "CANCELLED",
]);
const CYCLE_KINDS = new Set(["discovery", "planning", "routing", "implementation", "testing", "review", "validation", "prose"]);
const IMPLEMENTATION_OR_LATER = new Set(["IMPLEMENTING", "TESTING", "REVIEWING", "FIXING", "VALIDATING", "DONE"]);
const PLAN_RESULTS = new Set(["APPROVED", "REVISE", "REJECTED"]);
const WEIGHTS = {
  SMALL: { discovery: 5, planning: 0, implementation: 70, testing: 15, review: 5, validation: 5 },
  MEDIUM: { discovery: 10, planning: 5, implementation: 60, testing: 15, review: 5, validation: 5 },
  LARGE: { discovery: 10, planning: 15, implementation: 45, testing: 15, review: 10, validation: 5 },
};
const STATUS_ORDER = ["QUEUED", "DISCOVERING", "PLANNING", "IMPLEMENTING", "TESTING", "REVIEWING", "FIXING", "VALIDATING", "DONE"];
// A directory lock carries owner identity before it becomes visible via atomic rename.
// Crash recovery renames a proven-dead owner's directory to a deterministic tombstone.
// The tombstone is intentionally retained: another contender with the same stale view
// cannot rename a newly acquired LIVE lock into an already existing nonempty directory.
const loadedRevisions = new WeakMap();
const lockWait = new Int32Array(new SharedArrayBuffer(4));
function lockOwner(lockDir) {
  try {
    if (!fs.lstatSync(lockDir).isDirectory()) return null;
    const meta = fs.readFileSync(path.join(lockDir, "owner.json"), "utf8");
    if (meta.length > 4096) return null;
    const owner = JSON.parse(meta);
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0
      || !/^[a-f0-9-]{36}$/.test(owner.token || "") || typeof owner.host !== "string") return null;
    return owner;
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code) || error instanceof SyntaxError) return null;
    throw error;
  }
}
function ownerProvablyDead(owner) {
  if (!owner || owner.host !== os.hostname()) return false;
  try {
    process.kill(owner.pid, 0);
    // Live, inaccessible (EPERM), or a reused PID: never remove a lock.
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}
function recoverAbandonedLock(lockDir) {
  const owner = lockOwner(lockDir);
  if (!ownerProvablyDead(owner)) return false;
  // Recheck ownership before the atomic rename. No age-based expiration is used.
  const current = lockOwner(lockDir);
  if (!current || current.token !== owner.token || !ownerProvablyDead(current)) return false;
  const tombstone = lockDir + ".abandoned." + owner.token;
  try {
    // A deterministic nonempty tombstone ensures two recovering processes cannot
    // move a newly acquired lock after the first process has moved the stale one.
    fs.renameSync(lockDir, tombstone);
    return true;
  } catch (error) {
    if (["EEXIST", "ENOTEMPTY", "ENOENT", "EPERM", "EACCES"].includes(error.code)) return false;
    throw error;
  }
}
function withJobLock(file, write) {
  const lockDir = file + ".lock";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = randomUUID();
  const candidate = lockDir + ".candidate." + token;
  const owner = { pid: process.pid, host: os.hostname(), token, created_at: new Date().toISOString() };
  fs.mkdirSync(candidate);
  try {
    // Construct the complete candidate before publication; a crash here leaves
    // an unused candidate, not an unreadable primary lock.
    fs.writeFileSync(path.join(candidate, "owner.json"), JSON.stringify(owner) + "\n", { flag: "wx", mode: 0o600 });
    let acquired = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        fs.renameSync(candidate, lockDir);
        acquired = true;
        break;
      } catch (error) {
        // Windows may return EPERM when the destination is an existing directory.
        if (!["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(error.code) || !fs.existsSync(lockDir)) {
          throw error;
        }
        if (recoverAbandonedLock(lockDir)) continue;
        Atomics.wait(lockWait, 0, 0, 50);
      }
    }
    if (!acquired) {
      throw new Error("Job is busy: lock owner is active, on another host, or cannot be proven dead. Check the lock owner before manual cleanup.");
    }
    try {
      return write();
    } finally {
      const current = lockOwner(lockDir);
      if (!current || current.token !== token) throw new Error("Lock ownership changed unexpectedly; refusing to remove another process's lock.");
      // Release atomically while owner.json still exists. A crash after the
      // rename cannot strand an empty, ownerless primary lock directory.
      const released = lockDir + ".released." + token;
      fs.renameSync(lockDir, released);
      try {
        fs.unlinkSync(path.join(released, "owner.json"));
        fs.rmdirSync(released);
      } catch (error) {
        // The primary lock is already released. Retain only this owner-specific
        // cleanup artifact rather than report the persisted operation as failed.
        console.error("Web Kit lock cleanup warning: " + error.message);
      }
    }
  } finally {
    // The unique unpublished candidate is private to this writer, safe to remove.
    if (fs.existsSync(candidate)) fs.rmSync(candidate, { recursive: true, force: true });
  }
}

function nowIso() { return new Date().toISOString(); }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}
function getArg(args, name) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name) return args[i + 1] ?? null;
    if (args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
  }
  return null;
}
function getAllArgs(args, name) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name && i + 1 < args.length) values.push(args[++i]);
    else if (args[i].startsWith(`${name}=`)) values.push(args[i].slice(name.length + 1));
  }
  return values.filter((value) => value !== null && value !== undefined && String(value).trim());
}
function hasArg(args, name) { return args.some((arg) => arg === name || arg.startsWith(`${name}=`)); }
function numberArg(args, name, fallback = null) {
  const raw = getArg(args, name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function safeTaskId(value) {
  const id = String(value || "").trim();
  if (!id) throw new Error("--task-id is required");
  if (id.length > 120 || !/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error("--task-id must be 1-120 characters using only letters, numbers, '.', '_', or '-'");
  }
  return id;
}
function statePaths(project, taskId = null) {
  const root = path.join(project, ".agent-core", "state");
  return {
    root,
    jobs: path.join(root, "jobs"),
    job: taskId ? path.join(root, "jobs", `${safeTaskId(taskId)}.json`) : null,
    projectStatus: path.join(root, "project-status.json"),
    efficiency: path.join(root, "metrics", "workflow-efficiency.json"),
  };
}
function statusAtOrAfter(status, target) {
  const current = STATUS_ORDER.indexOf(status);
  const wanted = STATUS_ORDER.indexOf(target);
  return current >= 0 && wanted >= 0 && current >= wanted;
}
function governanceFor(classification, highRisk) {
  if (classification === "SMALL" && !highRisk) {
    return { plan_required: false, plan_mode: "none", min_plan_bullets: 0, max_plan_bullets: 0, plan_validator_required: false };
  }
  if (classification === "MEDIUM" && !highRisk) {
    return { plan_required: true, plan_mode: "short", min_plan_bullets: 3, max_plan_bullets: 6, plan_validator_required: false };
  }
  return { plan_required: true, plan_mode: "formal", min_plan_bullets: 1, max_plan_bullets: 20, plan_validator_required: true };
}
function defaultValidator(governance) {
  return {
    required: Boolean(governance.plan_validator_required),
    status: governance.plan_validator_required ? "PENDING" : "NOT_REQUIRED",
    source: null,
    evidence: [],
    plan_version: null,
    validated_at: null,
  };
}
function planReady(job) {
  if (!job.governance.plan_required) return true;
  const bullets = Number(job.plan?.bullets || 0);
  if (bullets < Number(job.governance.min_plan_bullets || 0) || bullets > Number(job.governance.max_plan_bullets || 0)) return false;
  if (job.plan?.status !== "APPROVED") return false;
  if (!job.governance.plan_validator_required) return true;
  return job.plan?.validator?.status === "APPROVED"
    && Boolean(job.plan?.validator?.source)
    && Number(job.plan?.validator?.plan_version) === Number(job.plan?.version || 0)
    // An approved plan is valid only for the specification reviewed by that plan validator.
    && (!job.quality?.required || (
      Boolean(job.plan.validator.spec_digest)
      && job.plan.validator.spec_digest === job.quality.spec?.validator?.digest
    ));
}
function assertPlanReady(job) {
  if (planReady(job)) return;
  if (job.governance.plan_validator_required) {
    throw new Error(`${job.classification}${job.high_risk ? "/high-risk" : ""} job requires an independently APPROVED ${job.governance.plan_mode} plan for the current plan version before implementation.`);
  }
  throw new Error(`${job.classification} job requires ${job.governance.min_plan_bullets}-${job.governance.max_plan_bullets} approved plan bullets before implementation.`);
}
function defaultMetrics() {
  return {
    ai_cycles: 0,
    // Counts each planning/routing/prose cycle once. prose_only_cycles overlaps those kinds.
    meta_work_cycles: 0,
    discovery_cycles: 0,
    planning_cycles: 0,
    routing_cycles: 0,
    implementation_cycles: 0,
    testing_cycles: 0,
    review_cycles: 0,
    validation_cycles: 0,
    prose_only_cycles: 0,
    consecutive_prose_only_cycles: 0,
    replans: 0,
    handoffs: 0,
    no_progress_cycles: 0,
    no_progress_work_cycles: 0,
    repeated_action_alerts: 0,
    reported_tool_calls: 0,
    reported_elapsed_ms: 0,
    reported_input_tokens: 0,
    reported_output_tokens: 0,
    useful_work_ratio: 0,
  };
}
function defaultEfficiencyGuard() {
  return { repeat_detected: false, action_key: null, consecutive_no_progress: 0, reason: null };
}
function actionKeyArg(args) {
  const key = getArg(args, "--action-key");
  if (key === null) return null;
  if (!/^[a-zA-Z0-9._:/@-]{1,120}$/.test(key)) {
    throw new Error("--action-key must be a stable 1-120 character identifier (letters/numbers/._:/@-), not a command, secret, or transcript");
  }
  return key;
}
function phaseCompletion(job) {
  const discovery = statusAtOrAfter(job.status, "IMPLEMENTING") || job.status === "PLANNING" ? 1 : job.status === "DISCOVERING" ? 0.5 : 0;
  const planning = !job.governance.plan_required ? 1 : planReady(job) ? 1 : (job.plan?.bullets || 0) > 0 ? 0.5 : 0;
  const implementation = job.implementation.total > 0
    ? clamp(job.implementation.completed / job.implementation.total, 0, 1)
    : job.evidence.files_changed > 0 ? clamp(0.20 + job.evidence.files_changed * 0.05, 0, 0.55) : 0;
  const testing = job.evidence.tests_total > 0
    ? clamp(job.evidence.tests_passing / job.evidence.tests_total, 0, 1)
    : job.evidence.build === "PASS" ? 0.5 : 0;
  const review = job.review.status === "PASS" ? 1 : 0;
  const validation = job.final_validation.status === "PASS" ? 1 : 0;
  return { discovery, planning, implementation, testing, review, validation };
}
function recalculate(job) {
  const weights = WEIGHTS[job.classification];
  const phases = phaseCompletion(job);
  job.progress = Math.round(Object.entries(weights).reduce((sum, [name, weight]) => sum + weight * phases[name], 0));
  if (job.status === "DONE" && job.final_validation.status === "PASS") job.progress = 100;
  const m = job.metrics;
  const useful = Math.max(0, m.implementation_cycles + m.testing_cycles + m.review_cycles + m.validation_cycles - (m.no_progress_work_cycles || 0));
  m.useful_work_ratio = m.ai_cycles ? Math.round((useful / m.ai_cycles) * 100) : 0;
  job.updated_at = nowIso();
  return job;
}
function appendEvidence(job, values, kind = "note") {
  for (const value of values) job.evidence.items.push({ kind, value: String(value), at: nowIso() });
  if (job.evidence.items.length > 200) job.evidence.items = job.evidence.items.slice(-200);
}
function loadJob(project, taskId) {
  const paths = statePaths(project, taskId);
  const job = readJson(paths.job, null);
  if (!job) throw new Error(`Job ${taskId} does not exist. Run 'start' first.`);
  if (!job.plan?.validator) job.plan.validator = defaultValidator(job.governance);
  // Old job metrics cannot reconstruct distinct meta cycles from overlapping counters.
  const hasMetaWorkHistory = Object.hasOwn(job.metrics || {}, "meta_work_cycles");
  job.metrics = { ...defaultMetrics(), ...job.metrics };
  if (!hasMetaWorkHistory) job.metrics.meta_work_cycles = null;
  job.efficiency_guard ||= defaultEfficiencyGuard();
  ensureQuality(job);
  loadedRevisions.set(job, Number(job.revision || 0));
  if (job.governance.min_plan_bullets === undefined) job.governance.min_plan_bullets = job.classification === "MEDIUM" && !job.high_risk ? 3 : job.governance.plan_required ? 1 : 0;
  return { job, paths };
}
function listJobs(project) {
  const paths = statePaths(project);
  if (!fs.existsSync(paths.jobs)) return [];
  return fs.readdirSync(paths.jobs)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(paths.jobs, name), null))
    .filter(Boolean)
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
}
function jobSummary(job) {
  return {
    task_id: job.task_id,
    title: job.title,
    classification: job.classification,
    high_risk: Boolean(job.high_risk),
    status: job.status,
    progress: job.progress,
    current_agent: job.current_agent,
    active_implementation: job.implementation?.active || null,
    plan: {
      status: job.plan?.status || null,
      bullets: Number(job.plan?.bullets || 0),
      validator_status: job.plan?.validator?.status || null,
      validator_source: job.plan?.validator?.source || null,
    },
    next_action: job.next_action,
    anti_slop: job.anti_slop,
    efficiency_guard: job.efficiency_guard || defaultEfficiencyGuard(),
    useful_work_ratio: Number(job.metrics?.useful_work_ratio || 0),
    updated_at: job.updated_at,
  };
}
function writeJob(project, job) {
  const paths = statePaths(project, job.task_id);
  withJobLock(paths.job, () => {
    const previous = readJson(paths.job, null);
    const revision = Number(previous?.revision || 0);
    const loaded = loadedRevisions.get(job);
    if (fs.existsSync(paths.job) && !previous) throw new Error("Job state could not be read; refusing to replace it.");
    if (loaded === undefined || loaded !== revision) {
      throw new Error("Concurrent job update detected: reload the latest task state before retrying.");
    }
    if (job.status === "DONE" && job.final_validation.status !== "PASS") throw new Error("Invariant violation: DONE requires final validation PASS.");
    if (IMPLEMENTATION_OR_LATER.has(job.status) && job.quality?.required) assertSpecificationReady(job, project);
    if (IMPLEMENTATION_OR_LATER.has(job.status) && job.governance.plan_required) assertPlanReady(job);
    if (job.status === "DONE") {
      const verdict = evaluateQuality(job, project);
      if (!verdict.ok) throw new Error("Quality gate blocked DONE: " + verdict.reasons.join(" "));
      // Capture an immutable as-of-completion verdict; later code edits must not erase history.
      if (previous?.status !== "DONE") {
        const snapshot = {
          completed_at: nowIso(),
          source_digest: verdict.source_digest,
          change_digest: verdict.change_digest || null,
          gate: "PASS",
          acceptance_verified: verdict.total > 0 && verdict.total === verdict.verified,
          requirements_verified: verdict.verified,
          requirements_total: verdict.total,
          measured_elapsed_ms: Number(job.metrics?.reported_elapsed_ms || 0) || null,
        };
        job.completion_history ||= [];
        job.completion_history.push(snapshot);
        job.completion = snapshot;
      }
    }
    recalculate(job);
    job.revision = revision + 1;
    atomicWriteJson(paths.job, job);
    loadedRevisions.set(job, job.revision);
  });
  writeEfficiency(project);
  return job;
}
function writeEfficiency(project) {
  const paths = statePaths(project);
  fs.mkdirSync(paths.jobs, { recursive: true });
  const jobs = listJobs(project);
  const totals = defaultMetrics();
  for (const job of jobs) {
    const metrics = job.metrics || {};
    for (const key of Object.keys(totals)) {
      if (key === "useful_work_ratio") continue;
      totals[key] += Number(metrics[key] || 0);
    }
  }
  const useful = Math.max(0, totals.implementation_cycles + totals.testing_cycles + totals.review_cycles + totals.validation_cycles - totals.no_progress_work_cycles);
  totals.useful_work_ratio = totals.ai_cycles ? Math.round((useful / totals.ai_cycles) * 100) : 0;
  atomicWriteJson(paths.efficiency, { schema_version: 1, jobs: jobs.length, totals, updated_at: nowIso() });
}
function start(project, args) {
  const taskId = safeTaskId(getArg(args, "--task-id"));
  const classification = String(getArg(args, "--classification") || "MEDIUM").toUpperCase();
  if (!CLASSIFICATIONS.has(classification)) throw new Error("--classification must be SMALL, MEDIUM, or LARGE");
  const highRisk = hasArg(args, "--high-risk") || String(getArg(args, "--risk") || "").toLowerCase() === "high";
  const paths = statePaths(project, taskId);
  if (fs.existsSync(paths.job) && !hasArg(args, "--force")) throw new Error(`Job ${taskId} already exists; use --force to replace it.`);
  const governance = governanceFor(classification, highRisk);
  const job = {
    schema_version: 3,
    task_id: taskId,
    title: getArg(args, "--title") || taskId,
    classification,
    high_risk: highRisk,
    pr_bound: hasArg(args, "--pr-bound"),
    status: "QUEUED",
    progress: 0,
    current_agent: null,
    current_phase: "QUEUED",
    governance,
    plan: {
      status: governance.plan_required ? "PENDING" : "NOT_REQUIRED",
      bullets: 0,
      version: 0,
      validator: defaultValidator(governance),
    },
    implementation: { total: 0, completed: 0, active: null, authors: [] },
    evidence: { files_changed: 0, tests_added: 0, tests_total: 0, tests_passing: 0, build: "UNKNOWN", items: [] },
    review: { status: "PENDING" },
    final_validation: { status: "PENDING" },
    anti_slop: { violation: false, reason: null, forced_next_phase: null },
    efficiency_guard: defaultEfficiencyGuard(),
    quality: createQuality(governance),
    metrics: defaultMetrics(),
    next_action: getArg(args, "--next") || "Perform the minimum targeted discovery needed to identify the next safe implementation action.",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  appendEvidence(job, getAllArgs(args, "--evidence"), "start");
  // Explicit --force may replace a prior job; retain its current revision for the write lease.
  loadedRevisions.set(job, Number(readJson(paths.job, null)?.revision || 0));
  writeJob(project, job);
  return job;
}
function recordImplementationAuthor(job, agent) {
  if (!agent) return;
  // A later fix must not erase earlier implementers, including legacy jobs
  // that predate the authors array.
  const authors = Array.isArray(job.implementation.authors) ? job.implementation.authors : [];
  job.implementation.authors = [...new Set([...authors, job.implementation.last_author, agent].filter(Boolean))];
  job.implementation.last_author = agent;
}
function update(project, args) {
  const taskId = safeTaskId(getArg(args, "--task-id"));
  const { job } = loadJob(project, taskId);
  const reopening = hasArg(args, "--reopen");
  if (job.status === "DONE" && !reopening) {
    throw new Error("DONE jobs are immutable. Use --reopen with an explicit non-DONE --status before changing validation, review, implementation, or plan state.");
  }

  const requestedStatus = getArg(args, "--status");
  // A local task can become PR-bound later, but cannot downgrade a PR-bound
  // task to bypass its scope/review completion gate.
  if (hasArg(args, "--pr-bound")) job.pr_bound = true;
  if (reopening) {
    if (!requestedStatus) throw new Error("--reopen requires an explicit non-DONE --status.");
    const reopenStatus = String(requestedStatus).toUpperCase();
    if (!JOB_STATUSES.has(reopenStatus) || reopenStatus === "DONE") throw new Error("--reopen status must be a valid non-DONE job status.");
    if (!getArg(args, "--final-validation")) job.final_validation.status = "PENDING";
    if (!getArg(args, "--review")) job.review.status = "PENDING";
    job.efficiency_guard = defaultEfficiencyGuard();
  }

  const previousBullets = Number(job.plan.bullets || 0);
  const previousVersion = Number(job.plan.version || 0);
  const planBullets = numberArg(args, "--plan-bullets");
  if (planBullets !== null) {
    const nextBullets = Math.max(0, Math.floor(planBullets));
    if (nextBullets > job.governance.max_plan_bullets) throw new Error(`Plan exceeds ${job.governance.max_plan_bullets} bullet limit for ${job.classification}`);
    job.plan.bullets = nextBullets;
  }
  const planVersion = numberArg(args, "--plan-version");
  if (planVersion !== null) job.plan.version = Math.max(0, Math.floor(planVersion));

  if (job.governance.plan_validator_required && (Number(job.plan.bullets) !== previousBullets || Number(job.plan.version) !== previousVersion)) {
    job.plan.status = "PENDING";
    job.plan.validator = defaultValidator(job.governance);
  }

  const planStatus = getArg(args, "--plan-status");
  if (planStatus) {
    const normalizedPlan = String(planStatus).toUpperCase();
    if (normalizedPlan === "APPROVED") {
      if (job.governance.plan_validator_required) {
        throw new Error("Formal/high-risk plans cannot self-approve through update. Use plan-validate with independent validator provenance.");
      }
      if (Number(job.plan.bullets || 0) < Number(job.governance.min_plan_bullets || 0)) {
        throw new Error(`${job.classification} plan requires at least ${job.governance.min_plan_bullets} bullets before approval.`);
      }
    }
    job.plan.status = normalizedPlan;
  }

  const finalValidation = getArg(args, "--final-validation");
  if (finalValidation) job.final_validation.status = String(finalValidation).toUpperCase();
  const review = getArg(args, "--review");
  if (review) job.review.status = String(review).toUpperCase();

  if (requestedStatus) {
    const normalized = String(requestedStatus).toUpperCase();
    if (!JOB_STATUSES.has(normalized)) throw new Error(`Unsupported status: ${normalized}`);
    if (normalized === "PLANNING" && !job.governance.plan_required) throw new Error("SMALL/non-plan job cannot enter PLANNING; route to implementation instead.");
    if (IMPLEMENTATION_OR_LATER.has(normalized) && job.governance.plan_required) assertPlanReady(job);
    if (normalized === "DONE" && job.final_validation.status !== "PASS") throw new Error("DONE requires final validation PASS.");
    job.status = normalized;
    job.current_phase = normalized;
  }

  const agent = getArg(args, "--agent");
  if (agent) {
    job.current_agent = agent;
    if (["IMPLEMENTING", "FIXING"].includes(job.status)) {
      recordImplementationAuthor(job, agent);
    }
  }
  const next = getArg(args, "--next");
  if (next) job.next_action = next;

  const implTotal = numberArg(args, "--implementation-total");
  const implCompleted = numberArg(args, "--implementation-completed");
  if (implTotal !== null) job.implementation.total = Math.max(0, Math.floor(implTotal));
  if (implCompleted !== null) job.implementation.completed = Math.max(0, Math.floor(implCompleted));
  if (job.implementation.total && job.implementation.completed > job.implementation.total) throw new Error("implementation completed cannot exceed total");
  const active = getArg(args, "--active");
  if (active) job.implementation.active = active;

  for (const [argName, field] of [["--files-changed", "files_changed"], ["--tests-added", "tests_added"], ["--tests-total", "tests_total"], ["--tests-passing", "tests_passing"]]) {
    const value = numberArg(args, argName);
    if (value !== null) job.evidence[field] = Math.max(0, Math.floor(value));
  }
  if (job.evidence.tests_total && job.evidence.tests_passing > job.evidence.tests_total) throw new Error("tests passing cannot exceed tests total");
  const build = getArg(args, "--build");
  if (build) job.evidence.build = String(build).toUpperCase();

  if (job.status === "DONE" && job.final_validation.status !== "PASS") throw new Error("Invariant violation: DONE requires final validation PASS.");
  appendEvidence(job, getAllArgs(args, "--evidence"), reopening ? "reopen" : "update");
  if (hasArg(args, "--replan")) job.metrics.replans += 1;
  if (hasArg(args, "--handoff")) job.metrics.handoffs += 1;
  writeJob(project, job);
  return job;
}
function planValidate(project, args) {
  const taskId = safeTaskId(getArg(args, "--task-id"));
  const { job } = loadJob(project, taskId);
  if (!job.governance.plan_validator_required) throw new Error("Independent plan validation is not required for this job.");
  if (job.status === "DONE") throw new Error("DONE jobs are immutable; reopen before changing plan validation.");
  const result = String(getArg(args, "--result") || "").toUpperCase();
  if (!PLAN_RESULTS.has(result)) throw new Error("--result must be APPROVED, REVISE, or REJECTED");
  const validator = String(getArg(args, "--validator") || "").trim();
  if (!validator) throw new Error("--validator is required to record independent validator provenance");
  if (job.current_agent && validator === job.current_agent) throw new Error("Independent Plan Validator cannot be the current implementation/planning agent.");
  const evidence = getAllArgs(args, "--evidence");
  if (!evidence.length) throw new Error("plan-validate requires at least one --evidence value");
  if (result === "APPROVED") assertSpecificationReady(job, project);
  if (result === "APPROVED" && Number(job.plan.bullets || 0) < Number(job.governance.min_plan_bullets || 0)) {
    throw new Error(`${job.governance.plan_mode} plan requires at least ${job.governance.min_plan_bullets} bullets before approval.`);
  }
  job.plan.validator = {
    required: true,
    status: result,
    source: validator,
    evidence: evidence.slice(-20),
    plan_version: Number(job.plan.version || 0),
    spec_digest: job.quality?.spec?.validator?.digest || null,
    validated_at: nowIso(),
  };
  job.plan.status = result;
  if (result !== "APPROVED") {
    job.status = "PLANNING";
    job.current_phase = "PLANNING";
    job.next_action = result === "REVISE" ? "Revise only the validator findings, then request independent plan validation again." : "Plan rejected. Resolve the blocking evidence before implementation.";
  }
  appendEvidence(job, evidence, `plan-validator:${result.toLowerCase()}`);
  writeJob(project, job);
  return job;
}
function cycle(project, args) {
  const taskId = safeTaskId(getArg(args, "--task-id"));
  const kind = String(getArg(args, "--kind") || "").toLowerCase();
  if (!CYCLE_KINDS.has(kind)) throw new Error(`--kind must be one of: ${[...CYCLE_KINDS].join(", ")}`);
  const { job } = loadJob(project, taskId);
  if (job.status === "DONE") throw new Error("DONE jobs are immutable. Reopen the job before recording more cycles.");
  if (kind === "implementation" && job.governance.plan_required) assertPlanReady(job);

  // All new tracking is opt-in: legacy cycles work unchanged. Validate before mutating job state.
  const actionKey = actionKeyArg(args);
  const outcome = getArg(args, "--outcome");
  if ((actionKey === null) !== (outcome === null)) throw new Error("--action-key and --outcome must be supplied together");
  if (outcome !== null && !["progress", "no-progress"].includes(outcome)) throw new Error("--outcome must be progress or no-progress");
  const evidence = getAllArgs(args, "--evidence");
  if (outcome === "progress" && !evidence.length) throw new Error("--outcome progress requires --evidence describing observable progress");
  const reported = {};
  for (const [arg, field] of [["--tool-calls", "reported_tool_calls"], ["--elapsed-ms", "reported_elapsed_ms"], ["--input-tokens", "reported_input_tokens"], ["--output-tokens", "reported_output_tokens"]]) {
    const n = numberArg(args, arg);
    if (n !== null) {
      if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${arg} must be a non-negative safe integer from actual telemetry`);
      reported[field] = n;
    }
  }

  if (kind === "discovery" && job.status === "QUEUED") {
    job.status = "DISCOVERING";
    job.current_phase = "DISCOVERING";
  } else if (kind === "planning" && job.governance.plan_required && ["QUEUED", "DISCOVERING"].includes(job.status)) {
    job.status = "PLANNING";
    job.current_phase = "PLANNING";
  } else if (kind === "implementation" && ["QUEUED", "DISCOVERING", "PLANNING"].includes(job.status)) {
    job.status = "IMPLEMENTING";
    job.current_phase = "IMPLEMENTING";
  }
  if (kind === "implementation") recordImplementationAuthor(job, job.current_agent);

  const m = job.metrics;
  for (const [field, value] of Object.entries(reported)) m[field] += value;
  m.ai_cycles += 1;
  if (["planning", "routing", "prose"].includes(kind) && Number.isInteger(m.meta_work_cycles)) {
    m.meta_work_cycles += 1;
  }
  if (outcome === "no-progress") {
    m.no_progress_cycles += 1;
    if (["implementation", "testing", "review", "validation"].includes(kind)) m.no_progress_work_cycles += 1;
    const previous = job.efficiency_guard || defaultEfficiencyGuard();
    const count = previous.action_key === actionKey ? previous.consecutive_no_progress + 1 : 1;
    job.efficiency_guard = {
      repeat_detected: count >= 2,
      action_key: actionKey,
      consecutive_no_progress: count,
      reason: count >= 2 ? "Two consecutive attempts of the same action produced no new progress evidence." : null,
    };
    if (count === 2) m.repeated_action_alerts += 1;
    if (count >= 2) job.next_action = "Stop repeating " + actionKey + ". Change strategy with a meaningful new condition or report the precise blocker; preserve required governance and validation.";
  } else if (outcome === "progress") {
    job.efficiency_guard = defaultEfficiencyGuard();
  }
  const metricName = `${kind}_cycles`;
  if (Object.hasOwn(m, metricName)) m[metricName] += 1;
  const metaOnly = ["prose", "planning", "routing"].includes(kind) && (evidence.length === 0 || outcome === "no-progress");
  if (metaOnly && !["QUEUED", "DISCOVERING"].includes(job.status)) {
    m.prose_only_cycles += 1;
    m.consecutive_prose_only_cycles += 1;
  } else {
    m.consecutive_prose_only_cycles = 0;
  }
  if (m.consecutive_prose_only_cycles >= 2) {
    job.anti_slop = {
      violation: true,
      reason: "Two consecutive post-discovery cycles produced planning/routing/prose without implementation, test, review, validation, or concrete evidence.",
      forced_next_phase: "IMPLEMENTING",
    };
    if (planReady(job)) {
      job.status = "IMPLEMENTING";
      job.current_phase = "IMPLEMENTING";
      job.next_action = "Stop meta-work. Make the next evidence-supported repository change now, then run its local check.";
    } else {
      job.status = "PLANNING";
      job.current_phase = "PLANNING";
      job.next_action = `Stop expanding the plan. Satisfy the ${job.governance.min_plan_bullets}-${job.governance.max_plan_bullets} bullet contract${job.governance.plan_validator_required ? " and obtain independent Plan Validator approval" : ""}, then implement immediately.`;
      job.anti_slop.forced_next_phase = "PLANNING_APPROVAL_THEN_IMPLEMENTING";
    }
  } else if (!["prose", "planning", "routing"].includes(kind)) {
    job.anti_slop = { violation: false, reason: null, forced_next_phase: null };
  }
  appendEvidence(job, evidence, `cycle:${kind}`);
  writeJob(project, job);
  return job;
}
function projectUpdate(project, args) {
  const area = String(getArg(args, "--area") || "").trim();
  if (!area) throw new Error("--area is required");
  const progress = numberArg(args, "--progress");
  if (progress === null) throw new Error("--progress is required");
  const evidence = getAllArgs(args, "--evidence");
  if (!evidence.length) throw new Error("project status updates require at least one --evidence value");
  const paths = statePaths(project);
  const current = readJson(paths.projectStatus, { schema_version: 1, areas: {}, overall_progress: 0, updated_at: null });
  current.areas[area] = {
    progress: Math.round(clamp(progress, 0, 100)),
    status: String(getArg(args, "--status") || "ACTIVE").toUpperCase(),
    weight: Math.max(0.01, numberArg(args, "--weight", 1)),
    evidence: evidence.slice(-20),
    updated_at: nowIso(),
  };
  const areas = Object.values(current.areas);
  const totalWeight = areas.reduce((sum, item) => sum + Number(item.weight || 1), 0);
  current.overall_progress = totalWeight ? Math.round(areas.reduce((sum, item) => sum + item.progress * Number(item.weight || 1), 0) / totalWeight) : 0;
  current.updated_at = nowIso();
  atomicWriteJson(paths.projectStatus, current);
  return current;
}
function show(project, args) {
  const taskId = getArg(args, "--task-id");
  const paths = statePaths(project, taskId || null);
  const jobs = listJobs(project);
  return {
    job: taskId ? readJson(paths.job, null) : null,
    jobs: taskId ? undefined : jobs.slice(0, 50).map(jobSummary),
    project_status: readJson(paths.projectStatus, null),
    workflow_efficiency: readJson(paths.efficiency, null),
  };
}
function printHelp() {
  console.log(`Web Kit Work Progress\n\nCommands:\n  start --task-id <id> --classification SMALL|MEDIUM|LARGE [--title <text>] [--high-risk] [--pr-bound]\n  update --task-id <id> [--status IMPLEMENTING] [--agent <role>] [--implementation-total N] [--implementation-completed N]\n         [--files-changed N] [--tests-added N] [--tests-total N] [--tests-passing N] [--build PASS|FAIL]\n         [--plan-status APPROVED] [--plan-bullets N] [--plan-version N] [--review PASS|FAIL] [--final-validation PASS|FAIL]\n         [--evidence <text>]... [--next <text>] [--replan] [--handoff] [--reopen] [--pr-bound]\n  plan-validate --task-id <id> --result APPROVED|REVISE|REJECTED --validator <independent-role> --evidence <text>...\n  cycle --task-id <id> --kind discovery|planning|routing|implementation|testing|review|validation|prose [--evidence <text>]...
        [--action-key <operation-id> --outcome progress|no-progress] [--tool-calls N] [--elapsed-ms N]
        [--input-tokens N] [--output-tokens N]\n  project-update --area <name> --progress <0..100> --evidence <text> [--status <status>] [--weight N]\n  show [--task-id <id>]
  spec-set --task-id <id> --file <project-relative-spec.md>
  requirement-add --task-id <id> --id REQ-001 --description <text> --acceptance <testable-criteria>
  spec-validate --task-id <id> --validator <independent-role> --result APPROVED|REVISE|REJECTED --evidence <text>
  check-run --task-id <id> --script <npm-script-name>
  requirement-verify --task-id <id> --id REQ-001 --result PASS|FAIL --check-script <script>|--manual --evidence <text>
  quality-review --task-id <id> --reviewer <independent-role> --result PASS|FAIL --evidence <text>
  report|audit --task-id <id>; benchmark --task-id <id> --against <other-id>\n\nOptions:\n  --project <path>   Project root, default current directory.\n\nProgress is evidence-weighted. SMALL skips formal planning, MEDIUM requires 3-6 approved bullets, LARGE/high-risk requires independent validator provenance for the current plan version, DONE is immutable unless explicitly reopened, two consecutive post-discovery meta-only cycles trigger the anti-slop guard, and two consecutive tagged attempts of the same no-progress action trigger a repeated-action alert. Telemetry fields are optional and must not be invented.`);
}

const args = process.argv.slice(2);
const command = args[0];
const project = path.resolve(getArg(args, "--project") || ".");
try {
  if (!command || command === "help" || hasArg(args, "--help") || hasArg(args, "-h")) { printHelp(); process.exitCode = 0; }
  else {
    let result;
    if (command === "start") result = start(project, args.slice(1));
    else if (command === "update") result = update(project, args.slice(1));
    else if (command === "plan-validate") result = planValidate(project, args.slice(1));
    else if (command === "cycle") result = cycle(project, args.slice(1));
    else if (command === "project-update") result = projectUpdate(project, args.slice(1));
    else if (command === "show") result = show(project, args.slice(1));
    else if (QUALITY_COMMANDS.has(command)) result = runQualityCommand(project, command, args.slice(1), loadJob, writeJob);
    else throw new Error(`Unknown command: ${command}`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  console.error(`Work Progress error: ${error.message}`);
  process.exitCode = 1;
}
