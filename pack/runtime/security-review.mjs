#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
const CONFIDENCES = ["HIGH", "MEDIUM", "LOW"];
const ACTIVE = new Set(["OPEN", "STILL_OPEN", "NEW", "REGRESSION"]);
const PROVIDERS = new Set(["auto", "codex", "claude", "gemini"]);
const REVIEW_STATE_REL = ".agent-core/security-reviews";
const REVIEW_STATE_PREFIX = `${REVIEW_STATE_REL}/`;
const UNTRACKED_EVIDENCE_MAX_FILES = 200;
const UNTRACKED_EVIDENCE_MAX_BYTES_PER_FILE = 64 * 1024;
const UNTRACKED_EVIDENCE_MAX_TOTAL_BYTES = 512 * 1024;
const UNTRACKED_EVIDENCE_BINARY_SAMPLE_BYTES = 8 * 1024;
const REVIEW_STATE_GIT_EXCLUDE = "/.agent-core/security-reviews/";

// Only provider execution/protocol failures become incomplete review records.
// Filesystem/state failures must still propagate instead of being misreported as reviewer failures.
class ReviewerFailure extends Error {}

const AREAS = [
  ["authentication", "Authentication", /(auth|login|signin|signup|register|password|credential|identity|mfa|2fa|verify|account)/i, /(password|credential|login|sign.?in|authenticate|mfa|2fa|otp|verification)/i, ["credential handling", "brute force", "account enumeration", "password reset", "MFA bypass", "authentication bypass"]],
  ["authorization", "Authorization & Multi-tenancy", /(permission|role|rbac|acl|policy|tenant|organization|workspace|member|admin|owner)/i, /(authorize|authorization|permission|role|tenant|owner|admin|isAdmin|policy)/i, ["IDOR/BOLA", "BFLA", "tenant isolation", "privilege escalation", "ownership validation", "server-side authorization"]],
  ["sessions", "Sessions, JWT & OAuth", /(session|jwt|token|oauth|oidc|cookie|refresh)/i, /(jwt|bearer|access.?token|refresh.?token|session|cookie|oauth|oidc|sameSite|httpOnly)/i, ["token validation", "algorithm confusion", "session fixation", "revocation", "expiration", "cookie security", "OAuth/OIDC state and redirects"]],
  ["api", "API & Input Validation", /(^|\/)(api|routes?|controllers?|handlers?|endpoints?|rpc|graphql)(\/|$)/i, /(req\.|request\.|params|query|body|headers|router\.|app\.(get|post|put|patch|delete)|graphql|resolver)/i, ["untrusted input", "mass assignment", "excessive data exposure", "unsafe methods", "schema validation", "API authorization"]],
  ["database", "Database & Data Access", /(db|database|repository|repositories|models?|orm|prisma|drizzle|sequelize|typeorm|mongoose|sql|migration)/i, /(select |insert |update |delete |query\(|execute\(|prisma\.|drizzle|mongoose|sequelize|typeorm|transaction)/i, ["SQL/NoSQL injection", "tenant isolation", "unsafe queries", "transaction integrity", "mass assignment", "data exposure"]],
  ["injection", "Injection & Code Execution", /(shell|exec|command|template|render|query|script)/i, /(exec\(|spawn\(|system\(|eval\(|Function\(|child_process|shell|rawQuery|queryRaw|innerHTML|template)/i, ["SQL injection", "NoSQL injection", "OS command injection", "template injection", "code evaluation", "header/LDAP injection"]],
  ["browser", "Browser Security & XSS", /(components?|pages?|views?|frontend|client|browser|ui|templates?)/i, /(innerHTML|dangerouslySetInnerHTML|document\.write|postMessage|location\.|window\.open|href=|src=|sanitize)/i, ["stored/reflected/DOM XSS", "unsafe HTML", "open redirects", "postMessage trust", "clickjacking", "CSP", "client-side token exposure"]],
  ["csrf_cors", "CSRF, CORS & Browser Boundaries", /(cors|csrf|middleware|server|api|auth)/i, /(cors|csrf|sameSite|Access-Control-Allow|origin|credentials:\s*true)/i, ["CSRF", "overbroad CORS", "credentialed origins", "origin validation", "unsafe state-changing GET"]],
  ["network", "SSRF & Outbound Networking", /(http|network|fetch|proxy|webhook|callback|url|integration|client)/i, /(fetch\(|axios|http\.request|https\.request|request\(|webhook|callback|new URL|proxy)/i, ["SSRF", "DNS rebinding", "internal service access", "redirect following", "TLS verification", "webhook authenticity"]],
  ["files", "File Upload & Filesystem", /(upload|file|storage|media|asset|archive|zip|image|document)/i, /(multipart|upload|filename|path\.join|readFile|writeFile|createReadStream|extract|unzip|mime|content-type)/i, ["unrestricted upload", "MIME spoofing", "path traversal", "zip slip", "archive bombs", "overwrite", "public exposure", "active-content upload"]],
  ["secrets", "Secrets & Credentials", /(\.env|secret|credential|config|settings|key|token)/i, /(api[_-]?key|secret|password|private[_-]?key|access[_-]?key|client[_-]?secret|token\s*[:=])/i, ["hard-coded secrets", "secret leakage", "unsafe logging", "credential scope", "private-key exposure"]],
  ["crypto", "Cryptography", /(crypto|hash|encrypt|decrypt|sign|certificate|tls)/i, /(md5|sha1|crypto\.|encrypt|decrypt|cipher|randomBytes|Math\.random|sign\(|verify\()/i, ["weak algorithms", "predictable randomness", "nonce/IV reuse", "key management", "signature verification", "TLS validation"]],
  ["dependencies", "Dependencies & Supply Chain", /(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements|poetry\.lock|uv\.lock|go\.mod|go\.sum|Cargo\.lock|composer\.lock|Gemfile\.lock|pom\.xml|gradle|packages\.lock\.json)/i, /(dependencies|devDependencies|packageManager|registry|postinstall|preinstall|resolution|override)/i, ["CVE/GHSA/OSV advisories", "dependency confusion", "typosquatting", "lifecycle scripts", "unsafe downgrade", "untrusted registries"]],
  ["containers_iac", "Containers, IaC & Cloud", /(Dockerfile|docker-compose|compose\.ya?ml|k8s|kubernetes|helm|terraform|\.tf$|cloudformation|pulumi|deployment|service\.ya?ml|ingress)/i, /(FROM |USER |privileged|cap_add|hostNetwork|securityContext|terraform|iam|publicAccess|0\.0\.0\.0|LoadBalancer)/i, ["root/privileged workloads", "exposed services", "weak IAM", "unsafe defaults", "secret mounts", "public resources", "image risk"]],
  ["cicd", "CI/CD & Repository Automation", /(^|\/)(\.github\/workflows|\.gitlab-ci|Jenkinsfile|azure-pipelines|circleci|buildkite|ci)(\/|$|\.)/i, /(pull_request_target|permissions:|secrets\.|GITHUB_TOKEN|uses:|run:|workflow_call|workflow_dispatch)/i, ["untrusted PR execution", "workflow command injection", "token permissions", "unpinned actions", "secret exfiltration", "artifact poisoning"]],
  ["logging_privacy", "Logging, Privacy & Sensitive Data", /(log|audit|telemetry|analytics|monitor|observability|error)/i, /(console\.log|logger\.|log\(|telemetry|analytics|sentry|error\(|stack)/i, ["PII/credential leakage", "verbose errors", "audit gaps", "log injection", "retention/privacy"]],
  ["abuse", "Rate Limiting, Abuse & DoS", /(rate|limit|queue|worker|search|login|api|upload|export|report)/i, /(rateLimit|throttle|limit|timeout|queue|pagination|pageSize|retry|while\s*\()/i, ["brute force", "resource exhaustion", "unbounded queries", "request-size abuse", "retry storms", "algorithmic complexity"]],
  ["realtime", "WebSockets & Realtime", /(websocket|socket|realtime|ws|sse|channel|room)/i, /(WebSocket|socket\.|io\.|subscribe|publish|channel|room|SSE|EventSource)/i, ["connection authentication", "message authorization", "room isolation", "replay", "flooding", "origin validation"]],
  ["business_logic", "Business Logic, Concurrency & Transactions", /(payment|billing|order|checkout|balance|wallet|credit|booking|reservation|inventory|workflow|state|transaction)/i, /(payment|amount|price|balance|credit|booking|reserve|inventory|status|transition|transaction|idempot)/i, ["workflow bypass", "amount tampering", "double-spend", "race conditions", "idempotency", "state abuse", "TOCTOU"]],
  ["deserialization", "Deserialization & Dynamic Data", /(serialize|deserialize|yaml|xml|template|parser|import)/i, /(deserialize|unserialize|yaml\.load|XML|DOMParser|JSON\.parse|pickle|marshal|ObjectInputStream|template)/i, ["unsafe deserialization", "XXE", "prototype pollution", "parser bombs", "template injection"]],
  ["cache", "Cache & Shared-State Boundaries", /(cache|redis|memcache|cdn|edge)/i, /(redis|cache|ttl|keyPrefix|invalidate|cdn|vary|etag)/i, ["cross-user leakage", "cache poisoning", "tenant-key collisions", "stale authorization", "sensitive response caching"]],
].map(([id, name, paths, text, concerns]) => ({ id, name, paths, text, concerns }));

function nowIso() { return new Date().toISOString(); }
function readJson(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function readText(file, fallback = "") { try { return fs.readFileSync(file, "utf8"); } catch { return fallback; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function writeText(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value.endsWith("\n") ? value : `${value}\n`, "utf8"); }
function posix(value) { return String(value || "").replace(/\\/g, "/").replace(/^\.\//, ""); }
function slug(value) { return posix(value || "detached").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "detached"; }
function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function branchStorageKey(branch) { return `${slug(branch).slice(0, 96)}--${hash(`branch:${branch}`).slice(0, 10)}`; }
function isReviewState(file) { return file === REVIEW_STATE_REL || file.startsWith(REVIEW_STATE_PREFIX); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }

function copyTree(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
  }
}
function moveTree(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try { fs.renameSync(src, dst); }
  catch (error) {
    if (error?.code !== "EXDEV") throw error;
    copyTree(src, dst);
    fs.rmSync(src, { recursive: true, force: true });
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout ?? 120_000,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
    shell: options.shell ?? (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)),
  });
}
function git(project, args, fallback = "") { const r = run("git", args, { cwd: project, timeout: 60_000 }); return !r.error && r.status === 0 ? String(r.stdout || "").trim() : fallback; }
function gitOk(project, args) { const r = run("git", args, { cwd: project, timeout: 60_000 }); return !r.error && r.status === 0; }
function gitNul(project, args) {
  const result = run("git", args, { cwd: project, timeout: 60_000 });
  if (result.error || result.status !== 0) throw new Error(`Could not read security-review Git paths: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  const output = result.stdout || "";
  if (output && !output.endsWith("\0")) throw new Error("Git path output was not NUL terminated.");
  // Git -z emits exact repository-relative paths, including whitespace and
  // literal backslashes on POSIX. Never trim, C-unquote, or normalize them.
  return output ? output.slice(0, -1).split("\0") : [];
}
function resolveGitPath(project, name) {
  const value = git(project, ["rev-parse", "--git-path", name]);
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.resolve(project, value);
}
function ensureReviewStateGitExcluded(project) {
  const excludeFile = resolveGitPath(project, "info/exclude");
  if (!excludeFile) throw new Error("Could not resolve .git/info/exclude for security-review state protection.");
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  let text = readText(excludeFile, "");
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  if (!lines.includes(REVIEW_STATE_GIT_EXCLUDE) && !lines.includes(".agent-core/security-reviews/")) {
    if (text && !text.endsWith("\n")) text += "\n";
    fs.writeFileSync(excludeFile, `${text}${REVIEW_STATE_GIT_EXCLUDE}\n`, "utf8");
  }
  return true;
}

function parseArgs(argv) {
  const out = { project: ".", base: null, provider: process.env.WEB_KIT_SECURITY_PROVIDER || "auto", deep: false, scanOnly: false, noScanners: false, json: false, failOnBlocking: false, timeoutMs: 180_000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i] ?? null;
    if (arg === "--project") out.project = next() || ".";
    else if (arg.startsWith("--project=")) out.project = arg.slice(10);
    else if (arg === "--base") out.base = next();
    else if (arg.startsWith("--base=")) out.base = arg.slice(7);
    else if (arg === "--provider") out.provider = next() || "auto";
    else if (arg.startsWith("--provider=")) out.provider = arg.slice(11);
    else if (arg === "--deep") out.deep = true;
    else if (arg === "--scan-only") out.scanOnly = true;
    else if (arg === "--no-scanners") out.noScanners = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--fail-on-blocking") out.failOnBlocking = true;
    else if (arg === "--timeout") out.timeoutMs = Math.max(10_000, Number(next() || 180) * 1000);
    else if (arg.startsWith("--timeout=")) out.timeoutMs = Math.max(10_000, Number(arg.slice(10) || 180) * 1000);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown security-review option: ${arg}`);
  }
  out.provider = String(out.provider || "auto").toLowerCase();
  if (!PROVIDERS.has(out.provider)) throw new Error(`Unsupported provider '${out.provider}'. Use auto, codex, claude, or gemini.`);
  if (!Number.isFinite(out.timeoutMs)) out.timeoutMs = 180_000;
  return out;
}
function printHelp() {
  console.log(`Web Kit Security PR Reviewer\n\nUsage:\n  node .agent-core/bin/security-review.mjs [options]\n\nOptions:\n  --project <path>          Project root. Default: current directory.\n  --base <branch/ref>       Base branch/ref. Auto-detected when omitted.\n  --provider <name>         auto | codex | claude | gemini.\n  --deep                    Review every security area.\n  --scan-only               Scanner/branch evidence only; always INCONCLUSIVE and not /5 scored.\n  --no-scanners             Skip optional external scanners.\n  --json                    Print final review JSON.\n  --fail-on-blocking        Exit 4 whenever the review is not APPROVE.\n  --timeout <seconds>       Per scanner/provider timeout. Default: 180.\n\nProvider-neutral AI trigger:\n  run security-review\n`);
}

function refExists(project, ref) { return Boolean(ref) && gitOk(project, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]); }
function detectBase(project, current, explicit) {
  if (explicit) {
    if (!refExists(project, explicit)) throw new Error(`Base ref does not exist: ${explicit}`);
    return explicit;
  }
  const remoteHead = git(project, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const candidates = unique([process.env.WEB_KIT_SECURITY_BASE, remoteHead, "origin/main", "main", "origin/master", "master", "origin/develop", "develop"]);
  for (const candidate of candidates) {
    if (candidate === current) continue;
    if (refExists(project, candidate)) return candidate;
  }
  const parent = git(project, ["rev-parse", "--verify", "HEAD^"]);
  if (parent) return parent;
  throw new Error("Could not determine a base branch/ref. Re-run with --base <branch>.");
}
function untrackedFiles(project) {
  return gitNul(project, ["ls-files", "--others", "--exclude-standard", "-z"])
    .filter((file) => !isReviewState(file))
    .sort();
}
function readFilePrefix(file, maxBytes) {
  const requested = Math.max(0, Math.floor(Number(maxBytes) || 0));
  if (!requested) return Buffer.alloc(0);
  const buffer = Buffer.alloc(requested);
  const fd = fs.openSync(file, "r");
  try {
    const read = fs.readSync(fd, buffer, 0, requested, 0);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}
function isLikelyBinary(buffer) {
  if (!buffer?.length) return false;
  let suspicious = 0;
  for (const byte of buffer) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / buffer.length > 0.10;
}
function collectUntrackedEvidence(project) {
  const files = untrackedFiles(project);
  const records = [];
  const root = path.resolve(project);
  let capturedTextBytes = 0;

  for (const relative of files.slice(0, UNTRACKED_EVIDENCE_MAX_FILES)) {
    const absolute = path.resolve(project, relative);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      records.push({ path: relative, status: "SKIPPED_OUTSIDE_PROJECT" });
      continue;
    }

    let stat;
    try { stat = fs.lstatSync(absolute); }
    catch (error) {
      records.push({ path: relative, status: "SKIPPED_UNREADABLE", reason: error?.code || "unreadable" });
      continue;
    }
    if (!stat.isFile()) {
      records.push({ path: relative, status: "SKIPPED_NON_REGULAR", size_bytes: stat.size });
      continue;
    }

    let sample;
    try { sample = readFilePrefix(absolute, Math.min(stat.size, UNTRACKED_EVIDENCE_BINARY_SAMPLE_BYTES)); }
    catch (error) {
      records.push({ path: relative, status: "SKIPPED_UNREADABLE", size_bytes: stat.size, reason: error?.code || "unreadable" });
      continue;
    }
    if (isLikelyBinary(sample)) {
      records.push({ path: relative, status: "SKIPPED_BINARY", size_bytes: stat.size });
      continue;
    }

    const remaining = Math.max(0, UNTRACKED_EVIDENCE_MAX_TOTAL_BYTES - capturedTextBytes);
    if (!remaining) {
      records.push({ path: relative, status: "SKIPPED_TOTAL_LIMIT", size_bytes: stat.size });
      continue;
    }
    const captureLimit = Math.min(stat.size, UNTRACKED_EVIDENCE_MAX_BYTES_PER_FILE, remaining);
    let bytes;
    try { bytes = readFilePrefix(absolute, captureLimit); }
    catch (error) {
      records.push({ path: relative, status: "SKIPPED_UNREADABLE", size_bytes: stat.size, reason: error?.code || "unreadable" });
      continue;
    }
    capturedTextBytes += bytes.length;
    records.push({
      path: relative,
      status: "CAPTURED_TEXT",
      size_bytes: stat.size,
      captured_bytes: bytes.length,
      truncated: stat.size > bytes.length,
      content: bytes.toString("utf8"),
    });
  }

  return {
    schema_version: 1,
    limits: {
      max_files: UNTRACKED_EVIDENCE_MAX_FILES,
      max_bytes_per_file: UNTRACKED_EVIDENCE_MAX_BYTES_PER_FILE,
      max_total_bytes: UNTRACKED_EVIDENCE_MAX_TOTAL_BYTES,
    },
    total_untracked_files: files.length,
    represented_files: records.length,
    omitted_files: Math.max(0, files.length - UNTRACKED_EVIDENCE_MAX_FILES),
    captured_text_bytes: capturedTextBytes,
    files: records,
  };
}
function untrackedEvidenceText(evidence) {
  return (evidence?.files || [])
    .filter((item) => item.status === "CAPTURED_TEXT")
    .map((item) => `\n--- WEB KIT UNTRACKED FILE: ${item.path} (${item.captured_bytes}/${item.size_bytes} bytes${item.truncated ? ", truncated" : ""}) ---\n${item.content}`)
    .join("\n");
}
function untrackedEvidenceSummary(evidence) {
  return {
    schema_version: evidence.schema_version,
    limits: evidence.limits,
    total_untracked_files: evidence.total_untracked_files,
    represented_files: evidence.represented_files,
    omitted_files: evidence.omitted_files,
    captured_text_bytes: evidence.captured_text_bytes,
    files: (evidence.files || []).map(({ content, ...metadata }) => metadata),
  };
}
function redactSensitiveText(value) {
  let text = String(value ?? "");
  text = text.replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]");
  text = text.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16})\b/g, "[REDACTED_TOKEN]");
  text = text.replace(/(\b(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|client[_-]?secret|access[_-]?key)\b\s*[:=]\s*)(["'\`])([^"'\`\r\n]*)(\2)/gi, "$1$2[REDACTED]$4");
  text = text.replace(/(\b(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|client[_-]?secret|access[_-]?key)\b\s*[:=]\s*)([^\s#;,]+)/gi, "$1[REDACTED]");
  return text;
}
function reviewerUntrackedEvidence(evidence) {
  return {
    ...untrackedEvidenceSummary(evidence),
    retention: "EPHEMERAL_REDACTED_OUTSIDE_WORKTREE",
    files: (evidence.files || []).map((item) => item.status === "CAPTURED_TEXT"
      ? { ...item, content: redactSensitiveText(item.content), secret_values_redacted: true }
      : { ...item }),
  };
}
function withEphemeralUntrackedEvidence(evidence, action) {
  if (!evidence?.total_untracked_files) return action(null);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-security-untracked-"));
  const evidenceFile = path.join(tempRoot, "untracked-evidence.json");
  try {
    writeJson(evidenceFile, reviewerUntrackedEvidence(evidence));
    try { fs.chmodSync(evidenceFile, 0o600); } catch {}
    return action(evidenceFile);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function changedFiles(project, mergeBase) {
  const committed = gitNul(project, ["diff", "--name-only", "--diff-filter=ACMRTUXB", "-z", `${mergeBase}...HEAD`]);
  const staged = gitNul(project, ["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB", "-z"]);
  const unstaged = gitNul(project, ["diff", "--name-only", "--diff-filter=ACMRTUXB", "-z"]);
  const untracked = untrackedFiles(project);
  return unique([...committed, ...staged, ...unstaged, ...untracked]).filter((file) => !isReviewState(file)).sort();
}
function workingTreeStatus(project) {
  // Disable rename pairing so every NUL record keeps the existing "XY path"
  // format; source/destination paths appear as separate deletion/addition records.
  return gitNul(project, ["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z"])
    .filter((entry) => !isReviewState(entry.slice(3)));
}
function diffText(project, mergeBase, untrackedEvidence) {
  return [
    git(project, ["diff", "--no-ext-diff", "--unified=12", `${mergeBase}...HEAD`]),
    git(project, ["diff", "--cached", "--no-ext-diff", "--unified=12"]),
    git(project, ["diff", "--no-ext-diff", "--unified=12"]),
    untrackedEvidenceText(untrackedEvidence),
  ].filter(Boolean).join("\n");
}
function attackSurface(files, diff, deep) {
  const joined = files.join("\n");
  const result = [];
  for (const area of AREAS) {
    const reasons = [];
    if (deep) reasons.push("deep review requested");
    const pathHits = files.filter((file) => area.paths.test(file)).slice(0, 8);
    if (pathHits.length) reasons.push(`changed paths: ${pathHits.join(", ")}`);
    if (area.text.test(diff) || area.text.test(joined)) reasons.push("related security signals found in changed code/configuration");
    if (reasons.length) result.push({ id: area.id, name: area.name, status: "REVIEW_REQUIRED", reasons, concerns: area.concerns });
  }
  if (!result.some((x) => x.id === "secrets")) {
    const area = AREAS.find((x) => x.id === "secrets");
    result.push({ id: area.id, name: area.name, status: "REVIEW_REQUIRED", reasons: ["baseline branch security check"], concerns: area.concerns });
  }
  if (!result.length) result.push({ id: "general", name: "General Security Invariants", status: "REVIEW_REQUIRED", reasons: ["no specialized surface mapped"], concerns: ["trust boundaries", "input validation", "authorization", "data exposure", "unsafe defaults"] });
  return result;
}

function migrateLegacyBranchState(project, branch, reviewRoot) {
  const legacy = path.join(project, REVIEW_STATE_REL, slug(branch));
  if (path.resolve(legacy) === path.resolve(reviewRoot) || !fs.existsSync(legacy) || fs.existsSync(reviewRoot)) return;
  const latest = readJson(path.join(legacy, "latest.json"), null);
  if (latest?.branch !== branch) return;
  moveTree(legacy, reviewRoot);
}

function hideGeneratedReviewState(project, action) {
  const source = path.join(project, REVIEW_STATE_REL);
  if (!fs.existsSync(source)) return action();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-security-state-"));
  const hidden = path.join(tempRoot, "security-reviews");
  let moved = false;
  try {
    moveTree(source, hidden);
    moved = true;
    return action();
  } finally {
    if (moved && fs.existsSync(hidden)) {
      fs.mkdirSync(path.dirname(source), { recursive: true });
      if (fs.existsSync(source)) fs.rmSync(source, { recursive: true, force: true });
      moveTree(hidden, source);
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function executable(name) {
  const entries = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name, `${name}.bat`] : [name];
  for (const dir of entries) {
    let resolved;
    try { resolved = path.resolve(dir); } catch { continue; }
    for (const candidateName of names) {
      const candidate = path.join(resolved, candidateName);
      try { if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate; } catch {}
    }
  }
  return null;
}
function jsonParse(text, fallback = null) { try { return JSON.parse(String(text || "").trim()); } catch { return fallback; } }
function scanner(name, status, extra = {}) { return { name, status, ...extra }; }
function scannerArtifact(tempDir, name, data) { const file = path.join(tempDir, `${name}.json`); writeJson(file, data); return file; }
function scannerError(r) { return r.error?.message || (r.status !== 0 ? String(r.stderr || "").trim().slice(0, 1200) : null); }

function runScanners(project, tempDir, timeoutMs) {
  fs.mkdirSync(tempDir, { recursive: true });
  const out = [];

  const semgrep = executable("semgrep");
  if (!semgrep) out.push(scanner("semgrep", "SKIPPED", { reason: "semgrep not installed on PATH" }));
  else {
    const r = run(semgrep, ["scan", "--config", "auto", "--json", "--metrics=off", "."], { cwd: project, timeout: timeoutMs });
    const data = jsonParse(r.stdout, { stdout: r.stdout, stderr: r.stderr });
    const count = Array.isArray(data?.results) ? data.results.length : null;
    out.push(scanner("semgrep", !r.error && r.status === 0 ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, temp_artifact: scannerArtifact(tempDir, "semgrep", data), note: scannerError(r) }));
  }

  const osv = executable("osv-scanner");
  if (!osv) out.push(scanner("osv-scanner", "SKIPPED", { reason: "osv-scanner not installed on PATH" }));
  else {
    const r = run(osv, ["scan", "source", "--recursive", "--format", "json", "."], { cwd: project, timeout: timeoutMs });
    const data = jsonParse(r.stdout, { stdout: r.stdout, stderr: r.stderr });
    let count = 0;
    for (const item of data?.results || []) for (const pkg of item?.packages || []) count += (pkg?.vulnerabilities || []).length;
    const recognized = !r.error && (r.status === 0 || r.status === 1);
    out.push(scanner("osv-scanner", recognized ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, temp_artifact: scannerArtifact(tempDir, "osv-scanner", data), note: recognized ? null : scannerError(r) }));
  }

  const gitleaks = executable("gitleaks");
  if (!gitleaks) out.push(scanner("gitleaks", "SKIPPED", { reason: "gitleaks not installed on PATH" }));
  else {
    const raw = path.join(tempDir, `gitleaks-raw-${process.pid}.json`);
    const r = run(gitleaks, ["dir", ".", "--report-format", "json", "--report-path", raw, "--redact", "--exit-code", "0", "--no-banner"], { cwd: project, timeout: timeoutMs });
    const data = fs.existsSync(raw) ? jsonParse(readText(raw), []) : [];
    try { fs.unlinkSync(raw); } catch {}
    const count = Array.isArray(data) ? data.length : null;
    out.push(scanner("gitleaks", !r.error && r.status === 0 ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, temp_artifact: scannerArtifact(tempDir, "gitleaks", data || []), note: scannerError(r) }));
  }

  const trivy = executable("trivy");
  if (!trivy) out.push(scanner("trivy", "SKIPPED", { reason: "trivy not installed on PATH" }));
  else {
    const r = run(trivy, ["fs", "--format", "json", "--scanners", "vuln,misconfig,secret", "--exit-code", "0", "."], { cwd: project, timeout: timeoutMs });
    const data = jsonParse(r.stdout, { stdout: r.stdout, stderr: r.stderr });
    let count = 0;
    for (const item of data?.Results || []) count += (item?.Vulnerabilities || []).length + (item?.Misconfigurations || []).length + (item?.Secrets || []).length;
    out.push(scanner("trivy", !r.error && r.status === 0 ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, temp_artifact: scannerArtifact(tempDir, "trivy", data), note: scannerError(r) }));
  }

  const packageLock = path.join(project, "package-lock.json");
  const npm = executable("npm");
  if (!fs.existsSync(packageLock)) out.push(scanner("npm-audit", "SKIPPED", { reason: "package-lock.json not present" }));
  else if (!npm) out.push(scanner("npm-audit", "SKIPPED", { reason: "npm not available" }));
  else {
    const r = run(npm, ["audit", "--json", "--audit-level=low"], { cwd: project, timeout: timeoutMs });
    const data = jsonParse(r.stdout, { stdout: r.stdout, stderr: r.stderr });
    const meta = data?.metadata?.vulnerabilities || {};
    const count = Number(meta.total ?? Object.entries(meta).filter(([key]) => key !== "total").reduce((sum, [, value]) => sum + (Number(value) || 0), 0));
    const recognized = !r.error && (r.status === 0 || r.status === 1);
    out.push(scanner("npm-audit", recognized ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, temp_artifact: scannerArtifact(tempDir, "npm-audit", data), note: recognized ? null : scannerError(r) }));
  }

  const pnpmLock = path.join(project, "pnpm-lock.yaml");
  const pnpm = executable("pnpm");
  if (!fs.existsSync(pnpmLock)) out.push(scanner("pnpm-audit", "SKIPPED", { reason: "pnpm-lock.yaml not present" }));
  else if (!pnpm) out.push(scanner("pnpm-audit", "SKIPPED", { reason: "pnpm not available" }));
  else {
    const r = run(pnpm, ["audit", "--json"], { cwd: project, timeout: timeoutMs });
    const data = jsonParse(r.stdout, { stdout: r.stdout, stderr: r.stderr });
    const meta = data?.metadata?.vulnerabilities || {};
    const count = Number(meta.total ?? Object.entries(meta).filter(([key]) => key !== "total").reduce((sum, [, value]) => sum + (Number(value) || 0), 0));
    const recognized = !r.error && (r.status === 0 || r.status === 1);
    out.push(scanner("pnpm-audit", recognized ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, temp_artifact: scannerArtifact(tempDir, "pnpm-audit", data), note: recognized ? null : scannerError(r) }));
  }
  return out;
}

function persistScannerArtifacts(project, runtimeDir, reviewNumber, scanners) {
  const reviewArtifactDir = path.join(runtimeDir, `review-${String(reviewNumber).padStart(3, "0")}`);
  fs.mkdirSync(reviewArtifactDir, { recursive: true });
  return scanners.map((item) => {
    if (!item.temp_artifact || !fs.existsSync(item.temp_artifact)) {
      const { temp_artifact, ...rest } = item;
      return rest;
    }
    const target = path.join(reviewArtifactDir, `${item.name}.json`);
    fs.copyFileSync(item.temp_artifact, target);
    const bytes = fs.readFileSync(target);
    const { temp_artifact, ...rest } = item;
    return {
      ...rest,
      artifact: posix(path.relative(project, target)),
      artifact_review: reviewNumber,
      artifact_sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      artifact_size: bytes.length,
    };
  });
}

function providerOverride(name) { return process.env[{ codex: "WEB_KIT_SECURITY_CODEX_BIN", claude: "WEB_KIT_SECURITY_CLAUDE_BIN", gemini: "WEB_KIT_SECURITY_GEMINI_BIN" }[name]] || null; }
function resolveProviderExecutable(name) {
  const override = providerOverride(name);
  if (override) return path.resolve(override);
  const webKitBin = path.resolve(process.env.WEB_KIT_HOME || path.join(os.homedir(), ".web-kit"), "bin");
  const entries = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name, `${name}.bat`] : [name];
  for (const dir of entries) {
    let resolved;
    try { resolved = path.resolve(dir); } catch { continue; }
    if (resolved.toLowerCase() === webKitBin.toLowerCase()) continue;
    for (const candidateName of names) {
      const candidate = path.join(resolved, candidateName);
      try { if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate; } catch {}
    }
  }
  return null;
}
function chooseProvider(requested) {
  if (requested !== "auto") {
    const providerExecutable = resolveProviderExecutable(requested);
    if (!providerExecutable) throw new ReviewerFailure(`Security reviewer provider '${requested}' was not found outside the Web Kit shim directory.`);
    return { name: requested, executable: providerExecutable };
  }
  for (const name of ["codex", "claude", "gemini"]) {
    const providerExecutable = resolveProviderExecutable(name);
    if (providerExecutable) return { name, executable: providerExecutable };
  }
  throw new ReviewerFailure("No supported headless AI reviewer found. Install/authenticate Codex, Claude, or Gemini CLI, or use --scan-only.");
}
function resolveNodeScriptFromCmd(file) {
  if (process.platform !== "win32" || !/\.cmd$/i.test(file)) return null;
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  const matches = [...text.matchAll(/"([^"\r\n]+\.(?:mjs|cjs|js))"/gi)];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    let candidate = matches[i][1];
    const base = `${path.dirname(file)}${path.sep}`;
    candidate = candidate.replace(/%~?dp0%?/ig, base);
    if (!path.isAbsolute(candidate)) candidate = path.resolve(path.dirname(file), candidate);
    try { if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate; } catch {}
  }
  return null;
}
function launchSpec(file, args) {
  if (/\.(mjs|cjs|js)$/i.test(file)) return { command: process.execPath, args: [file, ...args], shell: false };
  const nodeScript = resolveNodeScriptFromCmd(file);
  if (nodeScript) return { command: process.execPath, args: [nodeScript, ...args], shell: false };
  return { command: file, args, shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(file) };
}
function parseJsonObject(text) {
  if (typeof text !== "string" || !text) return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const direct = jsonParse(cleaned, null);
  if (direct && typeof direct === "object") return direct;
  const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}");
  return start >= 0 && end > start ? jsonParse(cleaned.slice(start, end + 1), null) : null;
}
function reviewerPrompt(contextRel, ephemeralUntrackedEvidenceFile, previousRel) {
  return `Act as the independent Web Kit Security PR Reviewer.\n\nREAD-ONLY REVIEW: do not modify files, fix findings, commit, or alter repository state.\n\nRead first:\n- .agent-core/agents/security-reviewer.md\n- .agent-core/rules/security-review.md\n- ${contextRel}\n${ephemeralUntrackedEvidenceFile ? `- ${ephemeralUntrackedEvidenceFile} (EPHEMERAL_UNTRACKED_EVIDENCE: redacted bounded untracked-file text outside the worktree; inspect CAPTURED_TEXT entries; this file is deleted after the review)` : ""}\n${previousRel ? `- ${previousRel} (previous review; verify every previous finding and never silently drop one)` : ""}\n\nThe generated .agent-core/security-reviews directory is review state/evidence, not product code; do not treat its generated files as branch changes or vulnerability evidence.\n\nReview the current branch against the exact base/merge-base recorded in the context. Inspect the actual branch diff and every surrounding source/configuration/dependency needed to validate trust boundaries and exploitability.\n\nRequirements:\n1. Cover every REVIEW_REQUIRED attack surface and expand to any additional related surface discovered while tracing affected code.\n2. Check all relevant classes, not merely OWASP Top 10: auth/authz, IDOR/BOLA/BFLA, tenant isolation, sessions/JWT/OAuth, injection, XSS, CSRF/CORS, SSRF, uploads/filesystem, secrets, crypto, dependencies/supply chain, containers/IaC/cloud, CI/CD, privacy/logging, abuse/DoS, realtime, business logic, concurrency/idempotency, deserialization/XXE/prototype pollution, cache isolation, and framework/language-specific risks when relevant.\n3. Follow changed code into middleware, authorization, validation, data access, configuration and callers/callees when those control security.\n4. Read scanner artifacts listed in the context when present. Missing/failed scanners are limitations, never proof of safety. Verify high-impact scanner findings in source when possible.\n5. Use OWASP Web/API and CWE where appropriate. Include CVE/GHSA/OSV identifiers only when actual advisory/scanner evidence supports them. Never invent an advisory.\n6. Prefer evidence-backed, realistically exploitable findings over generic best-practice noise.\n7. Return ALL findings in this one review.\n8. On re-review, re-check every previous SEC finding, including previously resolved findings. Return one prior_findings disposition per previous fingerprint with specific source evidence. Use OPEN and re-emit the same fingerprint when present; use RESOLVED only after verifying the fix; use UNVERIFIED when blocked. Omission never resolves a finding.\n9. Do not calculate the /5 rating or merge decision; Web Kit owns those deterministically.\n10. Report COMPLETE only after reading every changed file (including its diff) and the required surrounding source, assessing every REVIEW_REQUIRED surface, and verifying every prior finding. List each source input in files_reviewed with specific evidence. Use PARTIAL or BLOCKED if sandbox, permissions, tools, or source access prevent completion; empty findings never indicate completion. Explain missing coverage in limitations. Optional scanner unavailability alone need not prevent a completed source review. For a mapped surface found inapplicable, report NOT_APPLICABLE with source-based notes.\n11. Report current execution or source-access failures in review_failures as {stage: EXECUTION|SOURCE_ACCESS, message: specific failure}; return [] only when none occurred. Any current failure prevents COMPLETE. Quoted diagnostics from source code, tests, or prior reports are evidence, not current failures; keep them separate from review_failures.\n\nReturn ONLY this JSON shape, no markdown fences:\n{\n  \"review_status\": \"COMPLETE|PARTIAL|BLOCKED\",\n  \"review_failures\": [],\n  \"summary\": \"short assessment\",\n  \"files_reviewed\": [{\"file\":\"relative/path\",\"evidence\":\"specific source/diff inspected\"}],\n  \"prior_findings\": [{\"fingerprint\":\"previous stable fingerprint\",\"status\":\"OPEN|RESOLVED|UNVERIFIED\",\"evidence\":\"specific recheck evidence\"}],\n  \"limitations\": [\"coverage limitation\"],\n  \"coverage\": [{\"area\":\"area\",\"status\":\"REVIEWED|NOT_APPLICABLE|LIMITED\",\"notes\":\"what was checked\"}],\n  \"findings\": [{\n    \"fingerprint\": \"stable-lowercase-id\",\n    \"title\": \"specific vulnerability\",\n    \"severity\": \"CRITICAL|HIGH|MEDIUM|LOW|INFO\",\n    \"confidence\": \"HIGH|MEDIUM|LOW\",\n    \"category\": \"category\",\n    \"file\": \"relative/path\",\n    \"line\": 123,\n    \"owasp\": [\"supported mapping\"],\n    \"cwe\": [\"CWE-...\"],\n    \"advisories\": [\"only verified CVE/GHSA/OSV ids\"],\n    \"evidence\": \"specific evidence without secret values\",\n    \"attack_scenario\": \"realistic abuse path\",\n    \"impact\": \"impact\",\n    \"recommendation\": \"specific fix\",\n    \"validation\": \"specific regression test/verification\"\n  }]\n}`;
}
function invokeProvider(provider, project, prompt, timeoutMs) {
  const env = { ...process.env, WEB_KIT_SECURITY_REVIEW_ACTIVE: "1", WEB_KIT_SECURITY_PROJECT_ROOT: project, WEB_KIT_CONTEXT_SUPERVISOR_BYPASS: "1" };
  let args;
  if (provider.name === "codex") args = ["exec", "--json", "--sandbox", "read-only", "-C", project, prompt];
  else if (provider.name === "claude") args = ["-p", prompt, "--output-format", "json", "--permission-mode", "plan"];
  else args = ["-p", prompt, "--output-format", "json", "--approval-mode", "plan"];
  const spec = launchSpec(provider.executable, args);
  const r = run(spec.command, spec.args, { cwd: project, env, timeout: timeoutMs, shell: spec.shell });
  if (r.error || r.status !== 0) throw new ReviewerFailure(`${provider.name} security reviewer failed: ${r.error?.message || String(r.stderr || "").slice(0, 2000) || `exit ${r.status}`}`);
  if (sandboxSetupFailure(r.stderr)) throw new ReviewerFailure(`${provider.name} reviewer sandbox setup failed: ${String(r.stderr).slice(0, 2000)}`);

  let text = "";
  if (provider.name === "codex") {
    for (const line of String(r.stdout || "").split(/\r?\n/)) {
      const event = jsonParse(line, null);
      if (!event) continue;
      if (["error", "turn.failed", "item.failed"].includes(event.type) || event.item?.type === "error") {
        throw new ReviewerFailure(`${provider.name} reported a reviewer execution failure: ${JSON.stringify(event.error || event.message || event.item || event).slice(0, 2000)}`);
      }
      if ((event.item?.status === "failed" || (Number.isInteger(event.item?.exit_code) && event.item.exit_code !== 0))
        && sandboxSetupFailure(JSON.stringify(event.item))) {
        const diagnostic = event.item.aggregated_output || event.item.error || event.item.message || "sandbox execution unavailable";
        throw new ReviewerFailure(`${provider.name} reviewer sandbox failed: ${(typeof diagnostic === "string" ? diagnostic : JSON.stringify(diagnostic)).slice(0, 2000)}`);
      }
      if (event.type === "item.completed" && event.item && ["agent_message", "assistant_message", "message"].includes(event.item.type) && typeof event.item.text === "string") text = event.item.text;
      if (event.type === "message" && event.role === "assistant" && typeof event.content === "string") text = event.content;
    }
  } else {
    const outer = jsonParse(r.stdout, null);
    if (!reviewObject(outer)) throw new ReviewerFailure(`${provider.name} returned invalid security-review envelope; expected a JSON object.`);
    for (const key of ["subtype", "result", "response"]) {
      if (key in outer && typeof outer[key] !== "string") throw new ReviewerFailure(`${provider.name} returned invalid security-review envelope; ${key} must be a string.`);
    }
    if (outer.is_error === true || outer.error || (typeof outer.subtype === "string" && /^error(?:_|$)/i.test(outer.subtype))) {
      throw new ReviewerFailure(`${provider.name} reported a reviewer execution failure: ${JSON.stringify(outer.error || outer.errors || outer.result || outer).slice(0, 2000)}`);
    }
    text = provider.name === "claude" ? (outer.result ?? outer.response ?? r.stdout) : (outer.response ?? outer.result ?? r.stdout);
  }
  const parsed = parseJsonObject(text);
  if (!parsed || !Array.isArray(parsed.findings) || !Array.isArray(parsed.coverage)) throw new ReviewerFailure(`${provider.name} returned invalid security-review JSON; findings[] and coverage[] are required.`);
  return parsed;
}

const reviewText = (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 16_000;
const reviewObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sourcePath = (value) => typeof value === "string" && value.length > 0 && value.length <= 4096
  && !path.posix.isAbsolute(value) && !/^[a-zA-Z]:/.test(value) && !value.includes("\0")
  && (process.platform !== "win32" || !value.includes("\\"))
  && !value.split("/").some((part) => !part || part === "." || part === "..");

function sandboxSetupFailure(value) {
  return /\bSetNamedSecurityInfoW\b|\b(?:sandbox (?:setup|initiali[sz]ation)|(?:permission|ACL) setup)\b[^\r\n]{0,120}\b(?:failed|failure|denied|error)\b/i.test(String(value || ""));
}

function reviewBlockedText(value) {
  // A conservative legacy check for direct statements about this review. Do not
  // search source/test evidence for phrases quoted from the code being reviewed.
  return typeof value === "string" && /^\s*(?:(?:(?:the|this|current|independent|security|source)\s+){0,4}(?:review|inspection)\s+(?:(?:was|is|remains)\s+)?(?:impossible|blocked|incomplete|not (?:performed|completed))\b|(?:I|we|(?:the )?reviewer)\s+(?:could not|cannot|can't|couldn't|was unable to|were unable to|am unable to|are unable to)\s+(?:read|access|inspect|review|verify|complete|perform|conduct|open)\b|(?:unable|failed) to (?:read|access|inspect|review) (?:any |the |required |source |repository |project |changed )*(?:files?|code|sources?|diff|repository)\b|(?:(?:Windows\s+)?sandbox (?:setup|initiali[sz]ation)|(?:permission|ACL) setup)\s+(?:(?:has|had|was|is)\s+)?(?:failed|denied|unavailable|error(?=:))\b|SetNamedSecurityInfoW(?:\([^)]*\))?\s*[:,]\s*(?:error|failed|failure|access is denied)\b)/i.test(value);
}

function assessReviewCompletion(model, context, previous) {
  const issues = [];
  if (model.review_status !== "COMPLETE") issues.push(`Reviewer did not report COMPLETE (reported ${typeof model.review_status === "string" ? model.review_status.slice(0, 80) : "missing or invalid"}).`);
  if (!reviewText(model.summary)) issues.push("Reviewer supplied no valid summary.");
  const lists = {};
  for (const [key, limit] of [["files_reviewed", 5000], ["coverage", 120], ["findings", 1000], ["prior_findings", 1000], ["limitations", 120], ["review_failures", 120]]) {
    const value = model[key];
    if (!Array.isArray(value) || value.length > limit) issues.push(`Reviewer supplied invalid ${key}.`);
    lists[key] = Array.isArray(value) ? value.slice(0, limit) : [];
  }
  if (lists.limitations.some((item) => !reviewText(item))) issues.push("Review limitations must contain nonempty text.");
  for (const failure of lists.review_failures) {
    if (!reviewObject(failure) || !["EXECUTION", "SOURCE_ACCESS"].includes(failure.stage) || !reviewText(failure.message)) {
      issues.push("Invalid current review failure.");
    } else {
      issues.push(`Current review failure (${failure.stage}): ${failure.message}`);
    }
  }
  const reviewed = new Set();
  if (!lists.files_reviewed.length) issues.push("Reviewer supplied no source input evidence.");
  for (const input of lists.files_reviewed) {
    if (!reviewObject(input) || !sourcePath(input.file) || !reviewText(input.evidence) || reviewed.has(input.file)) {
      issues.push("Invalid, duplicate, or unsupported reviewed source input.");
      continue;
    }
    reviewed.add(input.file);
  }
  for (const file of context.changed_files) if (!reviewed.has(file)) issues.push(`Changed file was not reviewed: ${file}`);
  const coverage = new Map();
  for (const area of lists.coverage) {
    if (!reviewObject(area) || !reviewText(area.area) || !reviewText(area.notes) || !["REVIEWED", "NOT_APPLICABLE", "LIMITED"].includes(area.status)) {
      issues.push("Invalid source-security coverage entry.");
      continue;
    }
    const key = area.area.toLowerCase();
    if (coverage.has(key)) issues.push(`Duplicate source-security coverage: ${area.area}`);
    coverage.set(key, area);
    if (area.status === "LIMITED") issues.push(`Source-security coverage is incomplete: ${area.area}`);
  }
  for (const surface of context.attack_surfaces) {
    if (!coverage.has(surface.name.toLowerCase())) issues.push(`Required source-security surface was not reviewed: ${surface.name}`);
  }
  const current = new Set();
  for (const finding of lists.findings) {
    if (!reviewObject(finding) || !reviewText(finding.fingerprint) || !reviewText(finding.title) || !sourcePath(finding.file)
      || !reviewText(finding.evidence) || !SEVERITIES.includes(finding.severity) || !CONFIDENCES.includes(finding.confidence)) {
      issues.push("Invalid or unsupported security finding.");
      continue;
    }
    const key = fingerprint(finding);
    if (current.has(key)) issues.push(`Duplicate finding fingerprint: ${key}`);
    current.add(key);
  }
  const old = new Map((previous?.findings || []).map((finding) => [finding.fingerprint, finding]));
  const dispositions = new Map();
  for (const disposition of lists.prior_findings) {
    if (!reviewObject(disposition) || !old.has(disposition.fingerprint) || dispositions.has(disposition.fingerprint)
      || !["OPEN", "RESOLVED", "UNVERIFIED"].includes(disposition.status) || !reviewText(disposition.evidence)) {
      issues.push("Invalid, duplicate, or unsupported prior finding disposition.");
      continue;
    }
    dispositions.set(disposition.fingerprint, disposition);
    if (disposition.status === "UNVERIFIED") issues.push(`Prior finding was not verified: ${disposition.fingerprint}`);
    else if ((disposition.status === "OPEN") !== current.has(disposition.fingerprint)) issues.push(`Prior finding disposition disagrees with current findings: ${disposition.fingerprint}`);
    const file = old.get(disposition.fingerprint).file;
    if (file && !reviewed.has(file)) issues.push(`Prior finding source was not reviewed: ${file}`);
  }
  for (const key of old.keys()) if (!dispositions.has(key)) issues.push(`Prior finding was not rechecked: ${key}`);
  if ([model.summary, ...lists.limitations].some(reviewBlockedText)) issues.push("Reviewer reported blocked source access or an incomplete review despite its completion claim.");
  return { complete: issues.length === 0, issues: unique(issues), dispositions };
}

function severity(value) { const v = typeof value === "string" ? value.toUpperCase() : "MEDIUM"; return SEVERITIES.includes(v) ? v : "MEDIUM"; }
function confidence(value) { const v = typeof value === "string" ? value.toUpperCase() : "MEDIUM"; return CONFIDENCES.includes(v) ? v : "MEDIUM"; }
function fingerprint(finding) {
  const explicit = typeof finding.fingerprint === "string" ? finding.fingerprint.trim().toLowerCase() : "";
  if (explicit) return explicit.replace(/[^a-z0-9._:/-]+/g, "-").slice(0, 180);
  return hash([finding.category, finding.file, finding.title].map((x) => typeof x === "string" ? x.toLowerCase() : "").join("|")).slice(0, 24);
}
function normalizeFinding(f) {
  const field = (key, fallback = "") => typeof f[key] === "string" ? f[key].trim() : fallback;
  const strings = (key) => Array.isArray(f[key]) ? f[key].filter((value) => typeof value === "string") : [];
  const line = ["number", "string"].includes(typeof f.line) ? Number(f.line) : null;
  return {
    fingerprint: fingerprint(f),
    title: field("title", "Security finding"),
    severity: severity(f.severity),
    confidence: confidence(f.confidence),
    category: field("category", "General Security"),
    file: typeof f.file === "string" && f.file.length ? f.file : null,
    line: Number.isInteger(line) && line > 0 ? line : null,
    owasp: strings("owasp").slice(0, 20),
    cwe: strings("cwe").filter((x) => /^CWE-\d+$/i.test(x)).slice(0, 20),
    advisories: strings("advisories").filter((x) => /^(CVE-|GHSA-|OSV-|GO-|RUSTSEC-|PYSEC-)/i.test(x)).slice(0, 20),
    evidence: field("evidence"),
    attack_scenario: field("attack_scenario"),
    impact: field("impact"),
    recommendation: field("recommendation"),
    validation: field("validation"),
  };
}
function idAllocator(previous) {
  let max = 0;
  for (const f of previous?.findings || []) { const m = String(f.id || "").match(/^SEC-(\d+)$/); if (m) max = Math.max(max, Number(m[1])); }
  return () => `SEC-${String(++max).padStart(3, "0")}`;
}
function blocking(f) { return ACTIVE.has(f.status) && f.confidence !== "LOW" && ["CRITICAL", "HIGH", "MEDIUM"].includes(f.severity); }
function reconcile(raw, previous, number, dispositions) {
  const prev = new Map((previous?.findings || []).map((f) => [f.fingerprint, f]));
  const seen = new Set(); const allocate = idAllocator(previous); const result = [];
  for (const current of (raw || []).map(normalizeFinding)) {
    if (seen.has(current.fingerprint)) continue;
    seen.add(current.fingerprint);
    const old = prev.get(current.fingerprint);
    const status = !old ? (number === 1 ? "OPEN" : "NEW") : old.status === "RESOLVED" ? "REGRESSION" : "STILL_OPEN";
    const item = { ...current, id: old?.id || allocate(), status, first_seen_review: old?.first_seen_review || number, last_seen_review: number, resolved_review: null };
    item.blocking = blocking(item);
    result.push(item);
  }
  for (const old of previous?.findings || []) {
    if (seen.has(old.fingerprint)) continue;
    const disposition = dispositions.get(old.fingerprint);
    if (disposition?.status !== "RESOLVED") throw new Error("Cannot resolve a finding without validated recheck evidence.");
    if (old.status === "RESOLVED") result.push({ ...old, blocking: false });
    else result.push({ ...old, status: "RESOLVED", blocking: false, resolved_review: number, resolution_evidence: disposition.evidence });
  }
  const order = Object.fromEntries(SEVERITIES.map((name, index) => [name, index]));
  return result.sort((a, b) => (a.blocking !== b.blocking ? (a.blocking ? -1 : 1) : order[a.severity] - order[b.severity] || String(a.id).localeCompare(String(b.id))));
}
function preserveUnverifiedFindings(previous) {
  return (previous?.findings || []).map((finding) => {
    const preserved = { ...finding };
    preserved.blocking = blocking(preserved);
    return preserved;
  });
}
function score(findings) {
  const active = findings.filter((f) => ACTIVE.has(f.status));
  if (!active.length) return 5;
  const weights = { CRITICAL: 3, HIGH: 1.5, MEDIUM: 0.55, LOW: 0.15, INFO: 0.04 };
  const confidenceWeight = { HIGH: 1, MEDIUM: 0.75, LOW: 0.5 };
  let value = 5 - active.reduce((sum, f) => sum + weights[f.severity] * confidenceWeight[f.confidence], 0);
  const critical = active.some((f) => f.severity === "CRITICAL" && f.confidence !== "LOW");
  const highs = active.filter((f) => f.severity === "HIGH" && f.confidence !== "LOW").length;
  const medium = active.some((f) => f.severity === "MEDIUM" && f.confidence !== "LOW");
  if (critical) value = Math.min(value, 1.5);
  else if (highs >= 2) value = Math.min(value, 2.0);
  else if (highs === 1) value = Math.min(value, 2.9);
  else if (medium) value = Math.min(value, 3.9);
  else if (active.some((f) => f.severity === "LOW")) value = Math.min(value, 4.7);
  else value = Math.min(value, 4.9);
  return Math.max(0, Math.round(value * 10) / 10);
}
function counts(findings) {
  const result = Object.fromEntries(SEVERITIES.map((name) => [name, 0]));
  for (const f of findings) if (ACTIVE.has(f.status)) result[f.severity] += 1;
  return result;
}
function scannerFindingCount(scanners) { return scanners.filter((s) => s.status === "FINDINGS").reduce((sum, s) => sum + (Number(s.finding_count) || 0), 0); }
function normalizeCoverage(model, surfaces, scanners, scanOnly) {
  const coverage = scanOnly ? surfaces.map((x) => ({ area: x.name, status: "LIMITED", notes: "AI source review skipped by --scan-only." })) : Array.isArray(model?.coverage) ? model.coverage.filter(reviewObject).map((x) => ({
    area: typeof x.area === "string" ? x.area : "Unknown",
    status: typeof x.status === "string" && ["REVIEWED", "NOT_APPLICABLE", "LIMITED"].includes(x.status.toUpperCase()) ? x.status.toUpperCase() : "LIMITED",
    notes: typeof x.notes === "string" ? x.notes.trim() : "",
  })).slice(0, 120) : [];
  if (!scanOnly) {
    const missingRequired = surfaces.filter((s) => !coverage.some((c) => c.area.toLowerCase() === s.name.toLowerCase()));
    for (const surface of missingRequired) coverage.push({ area: surface.name, status: "LIMITED", notes: "Mapped as REVIEW_REQUIRED but reviewer did not explicitly report coverage." });
  }
  for (const s of scanners.filter((x) => ["SKIPPED", "ERROR"].includes(x.status))) coverage.push({ area: `Scanner: ${s.name}`, status: "LIMITED", notes: s.reason || s.note || s.status });
  return coverage;
}
function ratingText(review) { return Number.isFinite(review.rating) ? `${review.rating.toFixed(1)} / 5` : review.scan_only ? "NOT SCORED (scan-only)" : "NOT SCORED (incomplete review)"; }
function markdown(review) {
  const lines = [
    "# Web Kit Security PR Review", "",
    `- **Branch:** \`${review.branch}\``,
    `- **Branch storage key:** \`${review.branch_storage_key}\``,
    `- **Base:** \`${review.base}\``,
    `- **Review:** ${review.review_number} (${review.mode})`,
    `- **Security Rating:** **${ratingText(review)}**`,
    `- **Decision:** **${review.decision}**`,
    `- **Review completion:** ${review.review_status}`,
    `- **Reviewer Provider:** ${review.provider || (review.scan_only ? "scan-only" : "unavailable")}`, "",
    "## Assessment", "", review.summary, "",
    "## Active findings", "",
  ];
  const active = review.findings.filter((f) => ACTIVE.has(f.status));
  if (!active.length) lines.push("No active correlated SEC findings.", "");
  for (const f of active) {
    lines.push(`### ${f.id} — ${f.severity} — ${f.title}`, "", `- **Status:** ${f.status}`, `- **Confidence:** ${f.confidence}`, `- **Blocking:** ${f.blocking ? "YES" : "NO"}`);
    if (f.file) lines.push(`- **Location:** \`${f.file}${f.line ? `:${f.line}` : ""}\``);
    if (f.category) lines.push(`- **Category:** ${f.category}`);
    if (f.owasp.length) lines.push(`- **OWASP:** ${f.owasp.join(", ")}`);
    if (f.cwe.length) lines.push(`- **CWE:** ${f.cwe.join(", ")}`);
    if (f.advisories.length) lines.push(`- **Advisories:** ${f.advisories.join(", ")}`);
    lines.push("");
    for (const [label, value] of [["Evidence", f.evidence], ["Attack scenario", f.attack_scenario], ["Impact", f.impact], ["Recommendation", f.recommendation], ["Required validation", f.validation]]) if (value) lines.push(`**${label}:**`, "", value, "");
  }
  const resolved = review.findings.filter((f) => f.status === "RESOLVED");
  if (resolved.length) { lines.push("## Resolved findings", ""); for (const f of resolved) lines.push(`- ✅ ${f.id} — ${f.title}`); lines.push(""); }
  lines.push("## Security coverage", "");
  for (const c of review.coverage) lines.push(`- **${c.area}:** ${c.status}${c.notes ? ` — ${c.notes}` : ""}`);
  lines.push("", "## Scanner status", "");
  for (const s of review.scanners) lines.push(`- **${s.name}:** ${s.status}${Number.isInteger(s.finding_count) ? ` (${s.finding_count} findings)` : ""}${s.reason ? ` — ${s.reason}` : ""}${s.note ? ` — ${String(s.note).slice(0, 300)}` : ""}`);
  if (review.completion_issues.length) { lines.push("", "## Review completion issues", ""); for (const item of review.completion_issues) lines.push(`- ${item}`); }
  if (review.unverified_findings.length) { lines.push("", "## Findings reported during an incomplete review", ""); for (const finding of review.unverified_findings) lines.push(`- ${finding.severity} — ${finding.title}${finding.file ? ` (${finding.file})` : ""}`); }
  if (review.limitations.length) { lines.push("", "## Limitations", ""); for (const item of review.limitations) lines.push(`- ${item}`); }
  if (review.scan_only) lines.push("", "> Scan-only mode is intentionally INCONCLUSIVE and is not assigned a /5 security rating. Existing SEC lifecycle state is preserved but not re-verified. Run a full security-review to correlate scanner evidence with source-level security reasoning.");
  else if (!review.finding_lifecycle_verified) lines.push("", "> The source review did not complete. Previous SEC lifecycle state is preserved without verification; no approval or security rating was granted. Rerun the review after addressing the completion issues.");
  else lines.push("", "> A 5/5 review means no blocking issue was found in the reviewed scope and available evidence. It is not a guarantee that the software is vulnerability-free.");
  return `${lines.join("\n")}\n`;
}
function printReview(review, latestMd) {
  console.log("\n╔════════════════════════════════════════╗\n║       WEB KIT SECURITY PR REVIEW      ║\n╚════════════════════════════════════════╝\n");
  console.log(`Branch:          ${review.branch}\nBase:            ${review.base}\nReview:          #${review.review_number} (${review.mode})\nSecurity Rating: ${ratingText(review)}\nDecision:        ${review.decision}\nProvider:        ${review.provider || (review.scan_only ? "scan-only" : "unavailable")}\n`);
  const c = review.counts;
  console.log(`Critical: ${c.CRITICAL}  High: ${c.HIGH}  Medium: ${c.MEDIUM}  Low: ${c.LOW}  Info: ${c.INFO}`);
  if (review.scan_only) console.log(`Scanner findings: ${review.scanner_finding_count}\n`); else console.log("");
  const active = review.findings.filter((f) => ACTIVE.has(f.status));
  if (!active.length) console.log(!review.finding_lifecycle_verified ? "• No verified findings from this incomplete review." : "✓ No active security findings.");
  for (const f of active) { console.log(`${f.blocking ? "✗" : "•"} ${f.id}  ${f.severity}  ${f.status}  ${f.title}`); if (f.file) console.log(`  ${f.file}${f.line ? `:${f.line}` : ""}`); }
  for (const f of review.findings.filter((f) => f.status === "RESOLVED" && f.resolved_review === review.review_number)) console.log(`✓ ${f.id}  RESOLVED  ${f.title}`);
  for (const issue of review.completion_issues) console.log(`• Review incomplete: ${issue}`);
  if (!review.finding_lifecycle_verified && !review.scan_only) for (const limitation of review.limitations) console.log(`• Limitation: ${limitation}`);
  for (const finding of review.unverified_findings) console.log(`• Unverified ${finding.severity}: ${finding.title}`);
  console.log(`\nFull review: ${latestMd}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return 0; }
  const project = path.resolve(args.project);
  if (!fs.existsSync(project)) throw new Error(`Project does not exist: ${project}`);
  if (git(project, ["rev-parse", "--is-inside-work-tree"]) !== "true") throw new Error("security-review requires a Git repository.");
  ensureReviewStateGitExcluded(project);

  const branch = git(project, ["branch", "--show-current"]) || `detached-${git(project, ["rev-parse", "--short", "HEAD"]) || "head"}`;
  const storageKey = branchStorageKey(branch);
  const base = detectBase(project, branch, args.base);
  const mergeBase = git(project, ["merge-base", base, "HEAD"]);
  if (!mergeBase) throw new Error(`Could not determine merge-base between ${base} and HEAD.`);
  const head = git(project, ["rev-parse", "HEAD"]);
  const files = changedFiles(project, mergeBase);
  const untrackedEvidence = collectUntrackedEvidence(project);
  const diff = diffText(project, mergeBase, untrackedEvidence);
  const surfaces = attackSurface(files, diff, args.deep);

  const reviewRoot = path.join(project, REVIEW_STATE_REL, storageKey);
  migrateLegacyBranchState(project, branch, reviewRoot);
  const latestJson = path.join(reviewRoot, "latest.json");
  const previous = readJson(latestJson, null);
  const reviewNumber = Number(previous?.review_number || 0) + 1;

  const scanTemp = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-security-scanners-"));
  let scannerResults;
  try {
    scannerResults = args.noScanners
      ? [scanner("external-scanners", "SKIPPED", { reason: "--no-scanners requested" })]
      : hideGeneratedReviewState(project, () => runScanners(project, scanTemp, args.timeoutMs));

    const historyDir = path.join(reviewRoot, "history");
    const runtimeDir = path.join(reviewRoot, "runtime");
    const latestMd = path.join(reviewRoot, "latest.md");
    fs.mkdirSync(historyDir, { recursive: true }); fs.mkdirSync(runtimeDir, { recursive: true });
    const scanners = persistScannerArtifacts(project, runtimeDir, reviewNumber, scannerResults);
    const untrackedEvidenceMetadataFile = untrackedEvidence.total_untracked_files
      ? path.join(runtimeDir, `untracked-evidence-${String(reviewNumber).padStart(3, "0")}.json`)
      : null;
    if (untrackedEvidenceMetadataFile) writeJson(untrackedEvidenceMetadataFile, untrackedEvidenceSummary(untrackedEvidence));
    const untrackedEvidenceMetadataRel = untrackedEvidenceMetadataFile ? posix(path.relative(project, untrackedEvidenceMetadataFile)) : null;

    const context = {
      schema_version: 2,
      review_number: reviewNumber,
      mode: previous ? "rereview" : "initial",
      project,
      branch,
      branch_storage_key: storageKey,
      base,
      merge_base: mergeBase,
      head,
      changed_files: files,
      working_tree_status: workingTreeStatus(project),
      untracked_evidence_metadata_file: untrackedEvidenceMetadataRel,
      untracked_evidence_summary: untrackedEvidenceSummary(untrackedEvidence),
      untracked_raw_evidence_persisted_in_worktree: false,
      review_state_git_excluded: true,
      attack_surfaces: surfaces,
      deep_review: args.deep,
      scan_only: args.scanOnly,
      scanners,
      standards: ["OWASP Web Top 10", "OWASP API Security Top 10", "CWE including CWE Top 25 where relevant", "CVE/GHSA/OSV only with real advisory evidence", "framework/language-specific security", "business-logic and abuse-case analysis"],
      generated_state_excluded_from_branch_scope: `${REVIEW_STATE_PREFIX}**`,
      generated_state_hidden_from_external_scanners: true,
      created_at: nowIso(),
    };
    const contextFile = path.join(runtimeDir, `review-context-${String(reviewNumber).padStart(3, "0")}.json`);
    writeJson(contextFile, context);
    const contextRel = posix(path.relative(project, contextFile));
    const previousRel = previous ? posix(path.relative(project, latestJson)) : null;

    let provider = null;
    let model = { review_status: "SCAN_ONLY", review_failures: [], summary: "Scanner-only branch security evidence collection.", limitations: ["AI source/security reasoning was skipped by --scan-only."], files_reviewed: [], prior_findings: [], coverage: [], findings: [] };
    if (!args.scanOnly) {
      try {
        provider = chooseProvider(args.provider);
        model = withEphemeralUntrackedEvidence(untrackedEvidence, (ephemeralUntrackedEvidenceFile) =>
          invokeProvider(provider, project, reviewerPrompt(contextRel, ephemeralUntrackedEvidenceFile, previousRel), args.timeoutMs));
      } catch (error) {
        if (!(error instanceof ReviewerFailure)) throw error;
        const diagnostic = redactSensitiveText(error.message);
        model = { review_status: "ERROR", review_failures: [{ stage: "EXECUTION", message: diagnostic }], summary: diagnostic, limitations: [diagnostic], files_reviewed: [], prior_findings: [], coverage: [], findings: [] };
      }
    } else {
      for (const s of scanners) if (s.status === "FINDINGS") model.limitations.push(`${s.name} reported ${Number(s.finding_count) || "one or more"} finding(s); a full security-review is required to correlate severity, exploitability, and persistent SEC-* findings.`);
    }

    const completion = args.scanOnly ? { complete: false, issues: [], dispositions: new Map() } : assessReviewCompletion(model, context, previous);
    const findings = completion.complete ? reconcile(model.findings, previous, reviewNumber, completion.dispositions) : preserveUnverifiedFindings(previous);
    const unverifiedFindings = !completion.complete && Array.isArray(model.findings)
      ? model.findings.slice(0, 1000).filter((finding) => reviewObject(finding) && reviewText(finding.title) && reviewText(finding.evidence)).map(normalizeFinding) : [];
    const scanFindings = scannerFindingCount(scanners);
    const rating = completion.complete ? score(findings) : null;
    const decision = !completion.complete ? "INCONCLUSIVE" : findings.some((f) => f.blocking) ? "REQUEST_CHANGES" : "APPROVE";
    const limitations = Array.isArray(model.limitations) ? model.limitations.filter(reviewText).slice(0, 120) : [];
    for (const s of scanners) {
      if (s.status === "SKIPPED") limitations.push(`${s.name}: ${s.reason || "scanner unavailable"}`);
      if (s.status === "ERROR") limitations.push(`${s.name}: scanner error; ${s.note || `exit ${s.exit_code}`}`);
    }
    if (args.scanOnly) limitations.push("Scan-only mode never changes SEC lifecycle state, never grants APPROVE, and is intentionally not assigned a /5 rating; run a full security-review for lifecycle verification and a merge decision.");

    const review = {
      schema_version: 2,
      review_number: reviewNumber,
      mode: previous ? "rereview" : "initial",
      branch,
      branch_storage_key: storageKey,
      base,
      merge_base: mergeBase,
      head,
      changed_files: files,
      attack_surfaces: surfaces,
      untracked_evidence_metadata_file: untrackedEvidenceMetadataRel,
      untracked_raw_evidence_persisted_in_worktree: false,
      review_state_git_excluded: true,
      scan_only: args.scanOnly,
      review_status: completion.complete ? "COMPLETE" : args.scanOnly ? "SCAN_ONLY" : ["PARTIAL", "BLOCKED", "ERROR"].includes(model.review_status) ? model.review_status : "INCOMPLETE",
      completion_issues: completion.issues,
      review_failures: Array.isArray(model.review_failures) ? model.review_failures.slice(0, 120) : [],
      files_reviewed: Array.isArray(model.files_reviewed) ? model.files_reviewed.slice(0, 5000) : [],
      prior_findings: Array.isArray(model.prior_findings) ? model.prior_findings.slice(0, 1000) : [],
      finding_lifecycle_verified: completion.complete,
      provider: provider?.name || (!args.scanOnly && args.provider !== "auto" ? args.provider : null),
      scanners,
      scanner_finding_count: scanFindings,
      summary: typeof model.summary === "string" ? model.summary.trim() : "Reviewer supplied an invalid assessment summary.",
      limitations: unique(limitations),
      coverage: normalizeCoverage(model, surfaces, scanners, args.scanOnly),
      findings,
      unverified_findings: unverifiedFindings,
      counts: counts(findings),
      rating,
      rating_scale: 5,
      rating_status: args.scanOnly ? "NOT_SCORED_SCAN_ONLY" : completion.complete ? "SCORED" : "NOT_SCORED_INCOMPLETE_REVIEW",
      decision,
      approval_eligible: completion.complete,
      blocking_findings: findings.filter((f) => f.blocking).map((f) => f.id),
      created_at: nowIso(),
      disclaimer: "This review is evidence-based risk assessment, not a guarantee that every vulnerability has been found.",
    };

    const historyJson = path.join(historyDir, `review-${String(reviewNumber).padStart(3, "0")}.json`);
    const historyMd = path.join(historyDir, `review-${String(reviewNumber).padStart(3, "0")}.md`);
    writeJson(historyJson, review); writeText(historyMd, markdown(review));
    writeJson(latestJson, review); writeText(latestMd, markdown(review));

    if (args.json) console.log(JSON.stringify(review, null, 2)); else printReview(review, posix(path.relative(project, latestMd)));
    if (!args.scanOnly && !completion.complete) return 4;
    if (args.failOnBlocking && decision !== "APPROVE") return 4;
    return 0;
  } finally {
    fs.rmSync(scanTemp, { recursive: true, force: true });
  }
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(`[Web Kit] Security Review error: ${error.message}`);
  process.exitCode = 1;
});
