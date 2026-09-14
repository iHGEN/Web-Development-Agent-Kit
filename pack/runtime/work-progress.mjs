#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const CLASSIFICATIONS = new Set(["SMALL", "MEDIUM", "LARGE"]);
const JOB_STATUSES = new Set([
  "QUEUED", "DISCOVERING", "PLANNING", "IMPLEMENTING", "TESTING", "REVIEWING",
  "FIXING", "VALIDATING", "DONE", "BLOCKED", "WAITING_USER", "WAITING_EXTERNAL",
  "FAILED", "CANCELLED",
]);
const CYCLE_KINDS = new Set(["discovery", "planning", "routing", "implementation", "testing", "review", "validation", "prose"]);
const IMPLEMENTATION_OR_LATER = new Set(["IMPLEMENTING", "TESTING", "REVIEWING", "FIXING", "VALIDATING", "DONE"]);
const WEIGHTS = {
  SMALL: { discovery: 5, planning: 0, implementation: 70, testing: 15, review: 5, validation: 5 },
  MEDIUM: { discovery: 10, planning: 5, implementation: 60, testing: 15, review: 5, validation: 5 },
  LARGE: { discovery: 10, planning: 15, implementation: 45, testing: 15, review: 10, validation: 5 },
};
const STATUS_ORDER = ["QUEUED", "DISCOVERING", "PLANNING", "IMPLEMENTING", "TESTING", "REVIEWING", "FIXING", "VALIDATING", "DONE"];

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
  if (classification === "SMALL" && !highRisk) return { plan_required: false, plan_mode: "none", max_plan_bullets: 0, plan_validator_required: false };
  if (classification === "MEDIUM" && !highRisk) return { plan_required: true, plan_mode: "short", max_plan_bullets: 6, plan_validator_required: false };
  return { plan_required: true, plan_mode: "formal", max_plan_bullets: 20, plan_validator_required: true };
}
function defaultMetrics() {
  return {
    ai_cycles: 0,
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
    useful_work_ratio: 0,
  };
}
function phaseCompletion(job) {
  const discovery = statusAtOrAfter(job.status, "IMPLEMENTING") || job.status === "PLANNING" ? 1 : job.status === "DISCOVERING" ? 0.5 : 0;
  const planning = !job.governance.plan_required ? 1 : job.plan?.status === "APPROVED" ? 1 : (job.plan?.bullets || 0) > 0 ? 0.5 : 0;
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
  if (job.status === "DONE") job.progress = 100;
  const m = job.metrics;
  const useful = m.implementation_cycles + m.testing_cycles + m.review_cycles + m.validation_cycles;
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
  return { job, paths };
}
function writeJob(project, job) {
  const paths = statePaths(project, job.task_id);
  recalculate(job);
  atomicWriteJson(paths.job, job);
  writeEfficiency(project);
  return job;
}
function writeEfficiency(project) {
  const paths = statePaths(project);
  fs.mkdirSync(paths.jobs, { recursive: true });
  const jobs = fs.readdirSync(paths.jobs)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(paths.jobs, name), null))
    .filter(Boolean);
  const totals = defaultMetrics();
  for (const job of jobs) {
    const metrics = job.metrics || {};
    for (const key of Object.keys(totals)) {
      if (key === "useful_work_ratio") continue;
      totals[key] += Number(metrics[key] || 0);
    }
  }
  const useful = totals.implementation_cycles + totals.testing_cycles + totals.review_cycles + totals.validation_cycles;
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
    schema_version: 1,
    task_id: taskId,
    title: getArg(args, "--title") || taskId,
    classification,
    high_risk: highRisk,
    status: "QUEUED",
    progress: 0,
    current_agent: null,
    current_phase: "QUEUED",
    governance,
    plan: { status: governance.plan_required ? "PENDING" : "NOT_REQUIRED", bullets: 0, version: 0 },
    implementation: { total: 0, completed: 0, active: null },
    evidence: { files_changed: 0, tests_added: 0, tests_total: 0, tests_passing: 0, build: "UNKNOWN", items: [] },
    review: { status: "PENDING" },
    final_validation: { status: "PENDING" },
    anti_slop: { violation: false, reason: null, forced_next_phase: null },
    metrics: defaultMetrics(),
    next_action: getArg(args, "--next") || "Perform the minimum targeted discovery needed to identify the next safe implementation action.",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  appendEvidence(job, getAllArgs(args, "--evidence"), "start");
  writeJob(project, job);
  return job;
}
function update(project, args) {
  const taskId = safeTaskId(getArg(args, "--task-id"));
  const { job } = loadJob(project, taskId);

  const planStatus = getArg(args, "--plan-status");
  if (planStatus) job.plan.status = String(planStatus).toUpperCase();
  const planBullets = numberArg(args, "--plan-bullets");
  if (planBullets !== null) {
    if (planBullets > job.governance.max_plan_bullets) throw new Error(`Plan exceeds ${job.governance.max_plan_bullets} bullet limit for ${job.classification}`);
    job.plan.bullets = Math.max(0, Math.floor(planBullets));
  }
  const planVersion = numberArg(args, "--plan-version");
  if (planVersion !== null) job.plan.version = Math.max(0, Math.floor(planVersion));

  const finalValidation = getArg(args, "--final-validation");
  if (finalValidation) job.final_validation.status = String(finalValidation).toUpperCase();
  const review = getArg(args, "--review");
  if (review) job.review.status = String(review).toUpperCase();

  const status = getArg(args, "--status");
  if (status) {
    const normalized = String(status).toUpperCase();
    if (!JOB_STATUSES.has(normalized)) throw new Error(`Unsupported status: ${normalized}`);
    if (normalized === "PLANNING" && !job.governance.plan_required) throw new Error("SMALL/non-plan job cannot enter PLANNING; route to implementation instead.");
    if (IMPLEMENTATION_OR_LATER.has(normalized) && job.governance.plan_required && job.plan.status !== "APPROVED") {
      throw new Error(`${job.classification}${job.high_risk ? "/high-risk" : ""} job requires an approved ${job.governance.plan_mode} plan before implementation.`);
    }
    if (normalized === "DONE" && job.final_validation.status !== "PASS") throw new Error("DONE requires final validation PASS.");
    job.status = normalized;
    job.current_phase = normalized;
  }

  const agent = getArg(args, "--agent");
  if (agent) job.current_agent = agent;
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

  appendEvidence(job, getAllArgs(args, "--evidence"), "update");
  if (hasArg(args, "--replan")) job.metrics.replans += 1;
  if (hasArg(args, "--handoff")) job.metrics.handoffs += 1;
  writeJob(project, job);
  return job;
}
function cycle(project, args) {
  const taskId = safeTaskId(getArg(args, "--task-id"));
  const kind = String(getArg(args, "--kind") || "").toLowerCase();
  if (!CYCLE_KINDS.has(kind)) throw new Error(`--kind must be one of: ${[...CYCLE_KINDS].join(", ")}`);
  const { job } = loadJob(project, taskId);
  const evidence = getAllArgs(args, "--evidence");
  const m = job.metrics;
  m.ai_cycles += 1;
  const metricName = `${kind}_cycles`;
  if (Object.hasOwn(m, metricName)) m[metricName] += 1;
  const metaOnly = ["prose", "planning", "routing"].includes(kind) && evidence.length === 0;
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
    if (!job.governance.plan_required || job.plan.status === "APPROVED") {
      job.status = "IMPLEMENTING";
      job.current_phase = "IMPLEMENTING";
      job.next_action = "Stop meta-work. Make the next evidence-supported repository change now, then run its local check.";
    } else {
      job.status = "PLANNING";
      job.current_phase = "PLANNING";
      job.next_action = `Stop expanding the plan. Finish the smallest ${job.governance.plan_mode} plan allowed by policy, mark it APPROVED through the required validation path, then implement immediately.`;
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
  return {
    job: taskId ? readJson(paths.job, null) : null,
    project_status: readJson(paths.projectStatus, null),
    workflow_efficiency: readJson(paths.efficiency, null),
  };
}
function printHelp() {
  console.log(`Web Kit Work Progress\n\nCommands:\n  start --task-id <id> --classification SMALL|MEDIUM|LARGE [--title <text>] [--high-risk]\n  update --task-id <id> [--status IMPLEMENTING] [--agent <role>] [--implementation-total N] [--implementation-completed N]\n         [--files-changed N] [--tests-added N] [--tests-total N] [--tests-passing N] [--build PASS|FAIL]\n         [--plan-status APPROVED] [--plan-bullets N] [--review PASS|FAIL] [--final-validation PASS|FAIL]\n         [--evidence <text>]... [--next <text>] [--replan] [--handoff]\n  cycle --task-id <id> --kind discovery|planning|routing|implementation|testing|review|validation|prose [--evidence <text>]...\n  project-update --area <name> --progress <0..100> --evidence <text> [--status <status>] [--weight N]\n  show [--task-id <id>]\n\nOptions:\n  --project <path>   Project root, default current directory.\n\nProgress is evidence-weighted. SMALL skips formal planning, MEDIUM is capped at six bullets, formal/high-risk work cannot enter implementation until its plan is approved, and two consecutive post-discovery meta-only cycles trigger the anti-slop guard.`);
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
    else if (command === "cycle") result = cycle(project, args.slice(1));
    else if (command === "project-update") result = projectUpdate(project, args.slice(1));
    else if (command === "show") result = show(project, args.slice(1));
    else throw new Error(`Unknown command: ${command}`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  console.error(`Work Progress error: ${error.message}`);
  process.exitCode = 1;
}
