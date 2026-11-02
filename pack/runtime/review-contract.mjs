// Shared evidence contract for the existing Code Reviewer and final readiness gate.
// Receipts describe observed local execution; they are not a trust boundary against
// someone with write access to this repository or proof that every bug was found.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

export const REVIEW_SCHEMA = 1;
const PREFIX = ".agent-core/state/code-reviews/";
const MAX_ARTIFACT = 2 * 1024 * 1024;
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const text = value => typeof value === "string" && value.trim().length > 0 && value.length <= 16000;
const safeId = value => typeof value === "string" && /^[a-zA-Z0-9._-]{1,120}$/.test(value) && ![".", ".."].includes(value);
const safeRelative = value => typeof value === "string" && value.length > 0 && value.length <= 4096
  && !path.posix.isAbsolute(value) && !value.includes("\\") && !value.includes("\0")
  && !/^[a-zA-Z]:/.test(value) && !value.split("/").some(part => !part || part === "." || part === "..");

function git(project, args) {
  const r = spawnSync("git", args, { cwd: project, encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error("Cannot capture review Git evidence: " + (r.error?.message || r.stderr?.trim() || args[0]));
  return r.stdout;
}

function safeStatePath(project, relative, create = false) {
  if (!safeRelative(relative)) throw new Error("Invalid review evidence path.");
  const root = fs.realpathSync(project);
  const parts = relative.split("/");
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory())) throw new Error("Review state cannot use symlinks or non-directory parents.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (create && i < parts.length - 1) fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  return current;
}

function artifactPath(project, relative, create = false) {
  if (!relative?.startsWith(PREFIX) || relative.split("/").length !== 5 || !relative.endsWith(".json")) {
    throw new Error("Use a canonical code-review run artifact from .agent-core/state/code-reviews/<task>/<run>.json.");
  }
  return safeStatePath(project, relative, create);
}

export function loadReviewArtifact(project, relative) {
  const file = artifactPath(project, relative);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_ARTIFACT) throw new Error("Review artifact is not a bounded regular file.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function reviewArtifactDigest(project, relative) {
  loadReviewArtifact(project, relative);
  return hash(fs.readFileSync(artifactPath(project, relative)));
}

export function reviewRequirementsDigest(job) {
  return hash(JSON.stringify({
    task_id: job.task_id, title: job.title, pr_bound: Boolean(job.pr_bound),
    requirements: (job.quality?.requirements || []).map(r => [r.id, r.description, r.acceptance]),
    required_checks: job.quality?.required_checks || [],
  }));
}

export function reviewContextDigest(job) {
  const latest = new Map();
  for (const check of job.quality?.checks || []) latest.set(check.script, check);
  return hash(JSON.stringify({
    requirements_digest: reviewRequirementsDigest(job),
    verification: (job.quality?.requirements || []).map(r => [r.id, r.verification?.status,
      r.verification?.method, r.verification?.check_script, r.verification?.evidence,
      r.verification?.source_digest, r.verification?.change_digest]),
    checks: [...latest].sort(([a], [b]) => a.localeCompare(b)).map(([id, c]) =>
      [id, c.status, c.source_digest, c.change_digest, c.exit_code, c.definition_digest]),
  }));
}

export function captureReviewSnapshot(project, job, sourceDigest) {
  if (!safeId(job.task_id) || typeof sourceDigest !== "function") throw new Error("Review needs a valid task and source fingerprint function.");
  const scopePath = safeStatePath(project, `.agent-core/state/scope/${job.task_id}.json`);
  const scope = JSON.parse(fs.readFileSync(scopePath, "utf8"));
  if (!text(scope.base) || scope.base.startsWith("-")) throw new Error("Review has no safe comparison base.");
  const guard = path.join(project, ".agent-core/rules/scope-guard.mjs");
  const r = spawnSync(process.execPath, [guard, "check", "--task-id", job.task_id, "--project", project], {
    cwd: project, encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) throw new Error("Review requires a passing current scope check: " + (r.error?.message || r.stdout || r.stderr));
  const checked = JSON.parse(r.stdout);
  if (checked.verdict !== "PASS" || !/^[a-f0-9]{64}$/.test(checked.change_digest || "")) throw new Error("Scope guard supplied no valid review fingerprint.");
  const branch = git(project, ["branch", "--show-current"]).trim();
  const head = git(project, ["rev-parse", "--verify", "HEAD"]).trim();
  const baseCommit = git(project, ["rev-parse", "--verify", `${scope.base}^{commit}`]).trim();
  const mergeBase = git(project, ["merge-base", scope.base, "HEAD"]).trim();
  const index = git(project, ["ls-files", "--stage", "-z"]);
  const tracked = new Set([
    ...git(project, ["ls-files", "-z"]).split("\0"),
    ...git(project, ["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", ".agent-core/state"]).split("\0"),
    ...git(project, ["ls-tree", "-r", "--name-only", "-z", mergeBase, "--", ".agent-core/state"]).split("\0"),
  ].filter(Boolean));
  const generated = file => file.startsWith(".agent-core/state/") && !tracked.has(file);
  const lists = [
    ["diff", "--name-only", "--no-renames", "-z", mergeBase, "HEAD"],
    ["diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD"],
    ["diff", "--name-only", "--no-renames", "-z"],
    ["ls-files", "--others", "--exclude-standard", "-z"],
  ];
  const files = [...new Set(lists.flatMap(args => git(project, args).split("\0").filter(Boolean)))].filter(f => !generated(f)).sort();
  if (!files.length || files.length > 5000 || files.some(f => !safeRelative(f))) throw new Error("Review change list is empty, unsafe, or too large.");
  const status = git(project, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
    .split("\0").filter(entry => entry && !generated(entry.slice(3))).join("\0");
  const source = sourceDigest(project);
  let priorFindings = job.quality?.known_findings || [];
  if (!Array.isArray(job.quality?.known_findings) && job.quality?.code_review?.report_path) {
    const previous = loadReviewArtifact(project, job.quality.code_review.report_path);
    if (previous.task_id !== job.task_id) throw new Error("Previous review belongs to another task.");
    priorFindings = previous.report?.findings || [];
  }
  return {
    task_id: job.task_id, source_digest: source, change_digest: checked.change_digest,
    requirements_digest: reviewRequirementsDigest(job), evidence_digest: reviewContextDigest(job),
    scope_digest: hash(JSON.stringify([scope.intent, scope.allowed_paths, scope.extensions, scope.base])),
    base: scope.base, base_commit: baseCommit, branch, merge_base: mergeBase, files,
    prior_findings: priorFindings,
    readonly_digest: hash(JSON.stringify([head, branch, index, status, source, checked.change_digest])),
  };
}

export function sameReviewSnapshot(a, b, readOnly = false) {
  const fields = ["task_id", "source_digest", "change_digest", "requirements_digest", "evidence_digest", "scope_digest", "base", "base_commit", "branch", "merge_base"];
  if (readOnly) fields.push("readonly_digest");
  return fields.every(key => a?.[key] && a[key] === b?.[key]) && JSON.stringify(a.files) === JSON.stringify(b.files);
}

function requireText(value, label) { if (!text(value)) throw new Error(`Review report requires ${label}.`); }
function requireArray(value, label, max = 5000) { if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid review ${label}.`); }
function requirePath(value) { if (!safeRelative(value)) throw new Error("Review report contains an unsafe file path."); }

export function validateReviewReport(report, snapshot, job) {
  if (!report || report.schema_version !== REVIEW_SCHEMA) throw new Error("Unsupported code-review report schema.");
  requireText(report.summary, "a summary");
  for (const key of ["files_reviewed", "requirements", "scenarios", "boundaries", "findings", "prior_findings", "verification_gaps"]) requireArray(report[key], key);
  const gaps = [...report.verification_gaps];
  gaps.forEach(value => requireText(value, "verification gap details"));
  report.files_reviewed.forEach(requirePath);
  for (const file of snapshot.files) if (!report.files_reviewed.includes(file)) gaps.push("Changed file was not reviewed: " + file);
  const required = new Set((job.quality?.requirements || []).map(r => r.id));
  if (!required.size) gaps.push("No acceptance criteria registered.");
  const seen = new Set();
  let failed = false;
  for (const r of report.requirements) {
    if (!r || !required.has(r.id) || seen.has(r.id) || !["PASS", "FAIL", "BLOCKED"].includes(r.status)) throw new Error("Invalid or duplicate review requirement.");
    seen.add(r.id); requireText(r.evidence, "requirement evidence");
    if (r.status === "FAIL") failed = true;
    if (r.status === "BLOCKED") gaps.push(r.id + " could not be verified.");
  }
  for (const id of required) if (!seen.has(id)) gaps.push("Requirement was not reviewed: " + id);
  for (const c of report.scenarios) {
    if (!c || !required.has(c.requirement_id) || !["normal", "negative", "integration"].includes(c.kind)
      || !["PASS", "FAIL", "BLOCKED", "NOT_APPLICABLE"].includes(c.status)) throw new Error("Invalid review scenario.");
    for (const key of ["scenario", "expected", "observed", "evidence"]) requireText(c[key], "scenario " + key);
    if (c.kind === "normal" && c.status === "NOT_APPLICABLE") throw new Error("Normal acceptance behavior cannot be marked not applicable.");
    if (c.status === "FAIL") failed = true;
    if (c.status === "BLOCKED") gaps.push("Unverified scenario: " + c.scenario);
  }
  for (const id of required) for (const kind of ["normal", "negative", "integration"]) {
    if (!report.scenarios.some(c => c.requirement_id === id && c.kind === kind)) gaps.push(`${id} lacks ${kind} scenario evidence or an applicability explanation.`);
  }
  if (!report.boundaries.length) gaps.push("Affected interfaces were not assessed.");
  for (const b of report.boundaries) {
    if (!b || !["REVIEWED", "NOT_APPLICABLE", "LIMITED"].includes(b.status)) throw new Error("Invalid boundary assessment.");
    requireText(b.name, "boundary name"); requireText(b.evidence, "boundary evidence");
    requireArray(b.files, "boundary paths"); b.files.forEach(requirePath);
    if (b.status === "REVIEWED" && !b.files.length) throw new Error("Reviewed boundaries must identify their source paths.");
    if (b.status === "LIMITED") gaps.push("Interface review incomplete: " + b.name);
  }
  const findingIds = new Set();
  for (const f of report.findings) {
    if (!f || !safeId(f.id) || findingIds.has(f.id) || !["P0", "P1", "P2", "P3"].includes(f.severity)) throw new Error("Invalid or duplicate code-review finding.");
    findingIds.add(f.id); requirePath(f.file);
    if (!(Number.isSafeInteger(f.line) && f.line > 0) && !text(f.symbol)) throw new Error("Finding requires a line or symbol.");
    for (const key of ["title", "trigger", "impact", "evidence", "recommendation"]) requireText(f[key], "finding " + key);
    if (f.severity !== "P3") failed = true;
  }
  const previous = new Map((snapshot.prior_findings || []).map(f => [f.id, f]));
  const dispositions = new Set();
  for (const d of report.prior_findings) {
    if (!d || !previous.has(d.id) || dispositions.has(d.id) || !["RESOLVED", "OPEN"].includes(d.status)) throw new Error("Invalid prior finding disposition.");
    dispositions.add(d.id); requireText(d.evidence, "prior finding disposition evidence");
    if (d.status === "OPEN" && !findingIds.has(d.id) && previous.get(d.id).kind === "external-observation") {
      gaps.push("External observation remains unverified: " + d.id + ". " + d.evidence);
    } else if ((d.status === "OPEN") !== findingIds.has(d.id)) {
      throw new Error("Prior finding disposition disagrees with current findings.");
    }
  }
  for (const id of previous.keys()) if (!dispositions.has(id)) gaps.push("Prior finding was silently omitted: " + id);
  return {
    verdict: failed ? "NOT READY" : gaps.length ? "VERIFICATION BLOCKED" : "READY TO OPEN PR",
    reasons: [...(failed ? ["Confirmed blocking findings or failed acceptance scenarios remain."] : []), ...gaps],
  };
}

function validateEnvelope(envelope, job) {
  if (!envelope || envelope.schema_version !== REVIEW_SCHEMA || envelope.task_id !== job.task_id || !safeId(envelope.run_id)) throw new Error("Review run does not match the task.");
  const p = envelope.provenance;
  if (!p || p.kind !== "provider-process" || !["codex", "claude", "gemini"].includes(p.provider)
    || p.fresh_session !== true || p.read_only !== true || !Number.isSafeInteger(p.pid) || p.pid <= 0 || p.exit_code !== 0
    || !Number.isFinite(Date.parse(p.started_at)) || !Number.isFinite(Date.parse(p.completed_at))
    || Date.parse(p.completed_at) < Date.parse(p.started_at)) throw new Error("Review has no valid fresh provider execution record.");
}

export function storeReviewArtifact(project, job, envelope) {
  validateEnvelope(envelope, job);
  const result = validateReviewReport(envelope.report, envelope.snapshot, job);
  if (envelope.verdict !== result.verdict) throw new Error("Review verdict disagrees with its evidence.");
  const relative = `${PREFIX}${job.task_id}/${envelope.run_id}.json`;
  const data = JSON.stringify(envelope, null, 2) + "\n";
  if (Buffer.byteLength(data) > MAX_ARTIFACT) throw new Error("Review artifact exceeds the evidence size limit.");
  fs.writeFileSync(artifactPath(project, relative, true), data, { flag: "wx", mode: 0o600 });
  return relative;
}

export function validateReviewArtifact(project, relative, job, snapshot, expectedHash = null) {
  const envelope = loadReviewArtifact(project, relative);
  validateEnvelope(envelope, job);
  if (relative !== `${PREFIX}${job.task_id}/${envelope.run_id}.json`) throw new Error("Review artifact location does not match its run.");
  const digest = reviewArtifactDigest(project, relative);
  if (expectedHash && digest !== expectedHash) throw new Error("Stored review evidence was modified.");
  if (!sameReviewSnapshot(envelope.snapshot, snapshot)) throw new Error("Review evidence is stale against the code, base, requirements, or checks.");
  const result = validateReviewReport(envelope.report, envelope.snapshot, job);
  if (envelope.verdict !== result.verdict) throw new Error("Review verdict disagrees with its evidence.");
  return { envelope, digest, ...result };
}
