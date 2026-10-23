#!/usr/bin/env node
// Evidence-backed specification, executed checks, and efficiency reports for Web Kit.
// Quality data augments existing job state; it does not replace the canonical workflow.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const SOURCE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".css", ".scss",
  ".html", ".vue", ".svelte", ".php", ".py", ".go", ".rs", ".java", ".kt",
  ".swift", ".cs", ".sql", ".yml", ".yaml", ".toml", ".sh",
]);
const SKIP_DIRS = new Set([
  ".git", ".agent-core", ".agents", "node_modules", "vendor", "dist",
  "build", "coverage", ".next", ".cache", "graphify-out", ".venv", "target",
]);
const REVIEW_RESULTS = new Set(["PASS", "FAIL"]);
const SPEC_RESULTS = new Set(["APPROVED", "REVISE", "REJECTED"]);

function now() { return new Date().toISOString(); }
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function arg(args, name) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name) return args[i + 1] ?? null;
    if (args[i].startsWith(name + "=")) return args[i].slice(name.length + 1);
  }
  return null;
}
function allArgs(args, name) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name && args[i + 1] !== undefined) values.push(args[++i]);
    else if (args[i].startsWith(name + "=")) values.push(args[i].slice(name.length + 1));
  }
  return values.filter((value) => String(value).trim());
}
function has(args, name) { return args.includes(name); }
function requireEvidence(args) {
  const evidence = allArgs(args, "--evidence").map(String);
  if (!evidence.length || evidence.some((s) => s.length > 2000)) {
    throw new Error("At least one concise --evidence value is required (max 2000 characters each).");
  }
  return evidence.slice(-20);
}
function requireRole(args, flag, job) {
  const source = String(arg(args, flag) || "").trim();
  if (!/^[a-zA-Z0-9._-]{2,100}$/.test(source)) throw new Error(flag + " requires a role identifier.");
  if (source === job.current_agent) throw new Error("Independent reviewer cannot be the current author/implementer.");
  return source;
}
function assertMutable(job) {
  if (job.status === "DONE") throw new Error("DONE jobs are immutable; reopen the job before changing quality evidence.");
}
function assertPlanning(job) {
  assertMutable(job);
  if (["IMPLEMENTING", "TESTING", "REVIEWING", "FIXING", "VALIDATING"].includes(job.status) && job.quality?.required) {
    throw new Error("Formal specification changes require returning the job to PLANNING and revalidating the plan.");
  }
}
function relativeSafeFile(project, file) {
  if (!file) throw new Error("--file is required");
  const root = fs.realpathSync(project);
  const candidate = path.resolve(project, file);
  const actual = fs.realpathSync(candidate);
  if (actual === root || !actual.startsWith(root + path.sep)) throw new Error("Specification must be a file within the project.");
  const stat = fs.statSync(actual);
  if (!stat.isFile() || stat.size > 262144) throw new Error("Specification must be a file of at most 256 KiB.");
  return { relative: path.relative(root, actual).split(path.sep).join("/"), content: fs.readFileSync(actual, "utf8") };
}
function specDigest(job, project) {
  const relative = job.quality?.spec?.file;
  if (!relative) return null;
  const spec = relativeSafeFile(project, relative);
  const requirements = job.quality.requirements.map((r) => [r.id, r.description, r.acceptance]);
  return hash(spec.content + "\n" + JSON.stringify(requirements));
}
function invalidatePlan(job) {
  if (!job.governance?.plan_validator_required) return;
  job.plan.status = "PENDING";
  job.plan.validator = {
    required: true, status: "PENDING", source: null, evidence: [], plan_version: null,
    validated_at: null, spec_digest: null,
  };
}
export function createQuality(governance) {
  const required = Boolean(governance?.plan_validator_required);
  return {
    schema_version: 1,
    required,
    spec: { file: null, validator: { status: required ? "PENDING" : "NOT_REQUIRED", source: null, digest: null, evidence: [] } },
    requirements: [],
    checks: [],
    code_review: { status: "PENDING", source: null, evidence: [], source_digest: null },
  };
}
export function ensureQuality(job) {
  if (!job.quality) {
    // Pre-existing job records must remain readable and are not silently given new retroactive gates.
    job.quality = createQuality({ plan_validator_required: false });
    job.quality.legacy = true;
  }
  return job.quality;
}
export function specificationReady(job, project) {
  const quality = ensureQuality(job);
  if (!quality.required) return true;
  if (!quality.spec.file || !quality.requirements.length) return false;
  const validator = quality.spec.validator;
  if (validator?.status !== "APPROVED" || !validator.source || !validator.digest) return false;
  try {
    return validator.digest === specDigest(job, project);
  } catch {
    return false;
  }
}
export function assertSpecificationReady(job, project) {
  if (!specificationReady(job, project)) {
    throw new Error("Formal/high-risk work requires a current independently approved specification with testable requirements.");
  }
}
export function sourceDigest(project) {
  const root = fs.realpathSync(project);
  const digester = crypto.createHash("sha256");
  const stack = [root];
  const files = [];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(absolute);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(absolute);
        if (files.length > 5000) throw new Error("Source snapshot exceeds 5000 files; cannot safely claim fresh verification.");
      }
    }
  }
  files.sort();
  let total = 0;
  for (const file of files) {
    const stat = fs.statSync(file);
    total += stat.size;
    if (stat.size > 8 * 1024 * 1024 || total > 128 * 1024 * 1024) {
      throw new Error("Source snapshot exceeds bounded verification limits.");
    }
    digester.update(path.relative(root, file).split(path.sep).join("/"));
    digester.update("\0");
    digester.update(fs.readFileSync(file));
    digester.update("\0");
  }
  return digester.digest("hex");
}
function packageScripts(project) {
  const p = path.join(project, "package.json");
  if (!fs.existsSync(p)) return {};
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  return data.scripts && typeof data.scripts === "object" ? data.scripts : {};
}
function lastChecks(quality) {
  const map = new Map();
  for (const record of quality.checks) map.set(record.script, record);
  return [...map.values()];
}
export function evaluateQuality(job, project) {
  const quality = ensureQuality(job);
  const reasons = [];
  const formal = quality.required;
  const contract = quality.requirements.length > 0;
  if (formal && !specificationReady(job, project)) reasons.push("Specification approval missing or stale.");
  if (formal && !contract) reasons.push("No acceptance criteria registered.");
  for (const req of quality.requirements) {
    if (req.verification?.status !== "PASS" || !req.verification.evidence?.length) {
      reasons.push(req.id + " lacks passing verification evidence.");
    }
  }
  if (!formal && !contract) return { ok: true, reasons, required: false, verified: 0, total: 0 };
  let digest;
  try { digest = sourceDigest(project); }
  catch (error) { reasons.push("Unable to fingerprint current source: " + error.message); }
  for (const req of quality.requirements) {
    if (req.verification?.status !== "PASS") continue;
    if (req.verification.source_digest !== digest) reasons.push(req.id + " evidence is stale after source changes.");
    if (req.verification.method === "check") {
      const check = lastChecks(quality).find((c) => c.script === req.verification.check_script);
      if (!check || check.status !== "PASS" || check.source_digest !== digest) reasons.push(req.id + " lacks a fresh passing executed check.");
    } else if (req.verification.method !== "manual") {
      reasons.push(req.id + " has no documented verification method.");
    }
  }
  const scripts = packageScripts(project);
  if (formal) {
    const relevant = Object.keys(scripts).filter((s) => /^(test([:_-].*)?|build|lint|typecheck|type-check)$/.test(s));
    const checks = lastChecks(quality);
    const requiredScripts = relevant.filter((s) => s === "test" || /^test[:_-]/.test(s));
    if (requiredScripts.length && !requiredScripts.some((s) => checks.some((c) => c.script === s && c.status === "PASS" && c.source_digest === digest))) {
      reasons.push("An available npm test script must be executed successfully on current source.");
    } else if (!requiredScripts.length && relevant.length && !relevant.some((s) => checks.some((c) => c.script === s && c.status === "PASS" && c.source_digest === digest))) {
      reasons.push("At least one available npm build/lint/typecheck check must pass on current source.");
    }
    if (checks.some((c) => c.status !== "PASS" || c.source_digest !== digest)) {
      reasons.push("One or more recorded checks failed or became stale.");
    }
    const review = quality.code_review;
    if (review.status !== "PASS" || !review.source || !review.evidence?.length || review.source_digest !== digest) {
      reasons.push("Independent code review must pass on current source.");
    }
  }
  return {
    ok: reasons.length === 0,
    reasons,
    required: formal || contract,
    verified: quality.requirements.filter((r) => r.verification?.status === "PASS" && r.verification?.source_digest === digest).length,
    total: quality.requirements.length,
    source_digest: digest || null,
  };
}
export function assertQualityComplete(job, project) {
  const status = evaluateQuality(job, project);
  if (!status.ok) throw new Error("Quality gate blocked DONE: " + status.reasons.join(" "));
}
function getJob(project, args, loadJob) {
  const taskId = String(arg(args, "--task-id") || "").trim();
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(taskId)) throw new Error("--task-id is required.");
  return loadJob(project, taskId).job;
}
function report(job, project) {
  const quality = ensureQuality(job);
  const evaluation = evaluateQuality(job, project);
  const m = job.metrics || {};
  const measured = {
    elapsed_ms: Number(m.reported_elapsed_ms || 0) || null,
    tool_calls: Number(m.reported_tool_calls || 0) || null,
    input_tokens: Number(m.reported_input_tokens || 0) || null,
    output_tokens: Number(m.reported_output_tokens || 0) || null,
  };
  const checks = lastChecks(quality);
  const failureCount = Number(m.repeated_action_alerts || 0) + (job.anti_slop?.violation ? 1 : 0);
  const totalCycles = Number(m.ai_cycles || 0);
  const metaCycles = Number(m.planning_cycles || 0) + Number(m.routing_cycles || 0) + Number(m.prose_only_cycles || 0);
  const metaWorkPercent = totalCycles ? Math.min(100, Math.round(metaCycles / totalCycles * 100)) : null;
  const observations = [
    { name: "proportional_meta_work", pass: metaWorkPercent === null ? null : metaWorkPercent <= (job.classification === "LARGE" || job.high_risk ? 40 : 25) },
    { name: "proportional_planning", pass: job.classification !== "SMALL" || job.governance.plan_required === Boolean(job.high_risk) },
    { name: "no_active_planning_loop", pass: !job.anti_slop?.violation },
    { name: "no_repeat_alert", pass: !job.efficiency_guard?.repeat_detected },
    { name: "quality_gate", pass: evaluation.ok },
  ];
  const assessed = observations.filter((item) => item.pass !== null);
  return {
    task_id: job.task_id, classification: job.classification, status: job.status,
    requirements_fidelity: {
      spec_file: quality.spec.file,
      spec_validator: quality.spec.validator.status,
      requirements_total: evaluation.total,
      requirements_verified: evaluation.verified,
      criteria: quality.requirements.map((r) => ({ id: r.id, description: r.description, status: r.verification.status, method: r.verification.method })),
      passed: formalOrRequirements(job) ? evaluation.ok : null,
    },
    engineering_quality: {
      gate: evaluation.ok ? "PASS" : "BLOCKED", blockers: evaluation.reasons,
      executed_checks: checks.map((c) => ({ script: c.script, status: c.status, exit_code: c.exit_code, elapsed_ms: c.elapsed_ms, source_current: c.source_digest === evaluation.source_digest })),
      independent_review: quality.code_review.status,
    },
    execution_efficiency: {
      policy_checks: observations,
      policy_conformance_percent: assessed.length ? Math.round(100 * assessed.filter((x) => x.pass).length / assessed.length) : null,
      meta_work_percent: metaWorkPercent,
      cycle_breakdown: {
        total: totalCycles, discovery: Number(m.discovery_cycles || 0), planning: Number(m.planning_cycles || 0),
        routing: Number(m.routing_cycles || 0), implementation: Number(m.implementation_cycles || 0),
        testing: Number(m.testing_cycles || 0), review: Number(m.review_cycles || 0),
        validation: Number(m.validation_cycles || 0), prose_only: Number(m.prose_only_cycles || 0),
      },
      repeated_action_alerts: Number(m.repeated_action_alerts || 0),
      anti_slop_violations: job.anti_slop?.violation ? 1 : 0,
      useful_work_ratio_percent: Number(m.useful_work_ratio || 0),
      wasted_action_signals: failureCount,
      measured,
      telemetry_available: Object.values(measured).some((v) => v !== null),
    },
  };
}
function formalOrRequirements(job) { return Boolean(job.quality.required || job.quality.requirements.length); }
export const QUALITY_COMMANDS = new Set([
  "spec-set", "requirement-add", "spec-validate", "requirement-verify",
  "check-run", "quality-review", "report", "audit", "benchmark",
]);
export function runQualityCommand(project, command, args, loadJob, writeJob) {
  if (command === "benchmark") {
    const first = getJob(project, args, loadJob);
    const against = arg(args, "--against");
    if (!against) throw new Error("--against <task-id> is required.");
    const second = getJob(project, ["--task-id", against], loadJob);
    for (const job of [first, second]) {
      const elapsed = Number(job.metrics?.reported_elapsed_ms || 0);
      if (job.status !== "DONE" || !elapsed || !formalOrRequirements(job) || !evaluateQuality(job, project).ok) {
        throw new Error("Benchmark requires two completed quality-verified jobs with measured elapsed time.");
      }
    }
    if (first.classification !== second.classification) throw new Error("Benchmark jobs must have the same task classification.");
    return {
      compared: [first.task_id, second.task_id],
      elapsed_ms: [first.metrics.reported_elapsed_ms, second.metrics.reported_elapsed_ms],
      elapsed_difference_ms: first.metrics.reported_elapsed_ms - second.metrics.reported_elapsed_ms,
      note: "Comparison is observational, not a causal speedup claim. Compare similar workloads only.",
    };
  }
  const job = getJob(project, args, loadJob);
  const quality = ensureQuality(job);
  if (command === "report") return report(job, project);
  if (command === "audit") return report(job, project).execution_efficiency;
  assertMutable(job);
  if (command === "spec-set") {
    assertPlanning(job);
    const spec = relativeSafeFile(project, arg(args, "--file"));
    quality.spec.file = spec.relative;
    quality.spec.validator = { status: "PENDING", source: null, digest: null, evidence: [] };
    for (const req of quality.requirements) req.verification = { status: "PENDING", method: null, source_digest: null, evidence: [] };
    invalidatePlan(job);
  } else if (command === "requirement-add") {
    assertPlanning(job);
    const id = String(arg(args, "--id") || "").trim();
    const description = String(arg(args, "--description") || "").trim();
    const acceptance = String(arg(args, "--acceptance") || "").trim();
    if (!/^REQ-[0-9]{3,6}$/.test(id) || !description || !acceptance || description.length > 1000 || acceptance.length > 1000) {
      throw new Error("Requirement needs REQ-###, --description and --acceptance (max 1000 chars each).");
    }
    if (quality.requirements.some((r) => r.id === id)) throw new Error("Duplicate requirement ID: " + id);
    if (quality.spec.file && !relativeSafeFile(project, quality.spec.file).content.includes(id)) {
      throw new Error("Requirement ID must appear in the specification.");
    }
    quality.requirements.push({ id, description, acceptance, verification: { status: "PENDING", method: null, evidence: [], source_digest: null } });
    quality.spec.validator = { status: "PENDING", source: null, digest: null, evidence: [] };
    invalidatePlan(job);
  } else if (command === "spec-validate") {
    assertPlanning(job);
    const result = String(arg(args, "--result") || "").toUpperCase();
    if (!SPEC_RESULTS.has(result)) throw new Error("--result must be APPROVED, REVISE, or REJECTED.");
    const validator = requireRole(args, "--validator", job);
    const evidence = requireEvidence(args);
    if (result === "APPROVED") {
      if (!quality.spec.file || !quality.requirements.length) throw new Error("An approved spec needs a file and acceptance criteria.");
      const content = relativeSafeFile(project, quality.spec.file).content;
      if (quality.requirements.some((r) => !content.includes(r.id))) throw new Error("Spec must contain every registered requirement ID.");
    }
    quality.spec.validator = {
      status: result, source: validator, evidence, digest: result === "APPROVED" ? specDigest(job, project) : null, validated_at: now(),
    };
    if (result !== "APPROVED") invalidatePlan(job);
  } else if (command === "check-run") {
    if (quality.required && !["IMPLEMENTING", "TESTING", "REVIEWING", "FIXING", "VALIDATING"].includes(job.status)) {
      throw new Error("Approve the formal specification and plan before executing checks.");
    }
    const script = String(arg(args, "--script") || "");
    if (!/^[a-zA-Z0-9_:-]{1,80}$/.test(script) || !Object.hasOwn(packageScripts(project), script)) {
      throw new Error("--script must name an existing npm package.json script.");
    }
    const started = Date.now();
    const commandName = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawnSync(commandName, ["run", script], {
      cwd: project, windowsHide: true, shell: process.platform === "win32",
      encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024,
    });
    const status = !child.error && child.status === 0 ? "PASS" : "FAIL";
    const fingerprint = sourceDigest(project);
    quality.checks.push({
      script, status, exit_code: child.status ?? null,
      elapsed_ms: Date.now() - started, source_digest: fingerprint, at: now(),
      error: child.error?.message || null,
    });
    quality.checks = quality.checks.slice(-50);
    job.evidence.items.push({ kind: "executed-check", value: "npm run " + script + ": " + status, at: now() });
    writeJob(project, job);
    return { task_id: job.task_id, script, status, exit_code: child.status ?? null, elapsed_ms: Date.now() - started, error: child.error?.message || null, output_tail: String(child.stdout || child.stderr || "").slice(-2000) };
  } else if (command === "requirement-verify") {
    const id = String(arg(args, "--id") || "");
    const req = quality.requirements.find((r) => r.id === id);
    if (!req) throw new Error("Unknown requirement ID: " + id);
    const result = String(arg(args, "--result") || "").toUpperCase();
    if (!REVIEW_RESULTS.has(result)) throw new Error("--result must be PASS or FAIL.");
    const evidence = requireEvidence(args);
    const checkScript = arg(args, "--check-script");
    if (checkScript && has(args, "--manual")) throw new Error("Choose --check-script or --manual, not both.");
    if (result === "PASS" && !checkScript && !has(args, "--manual")) {
      throw new Error("PASS needs --check-script <executed npm script> or --manual and evidence.");
    }
    const fingerprint = sourceDigest(project);
    if (result === "PASS" && checkScript && !lastChecks(quality).some((c) => c.script === checkScript && c.status === "PASS" && c.source_digest === fingerprint)) {
      throw new Error("Requirement verification must reference a fresh successful executed check.");
    }
    req.verification = { status: result, method: checkScript ? "check" : "manual", check_script: checkScript || null, evidence, source_digest: fingerprint, at: now() };
  } else if (command === "quality-review") {
    const result = String(arg(args, "--result") || "").toUpperCase();
    if (!REVIEW_RESULTS.has(result)) throw new Error("--result must be PASS or FAIL.");
    const reviewer = requireRole(args, "--reviewer", job);
    quality.code_review = { status: result, source: reviewer, evidence: requireEvidence(args), source_digest: sourceDigest(project), at: now() };
  } else {
    throw new Error("Unknown quality command: " + command);
  }
  writeJob(project, job);
  return report(job, project);
}
