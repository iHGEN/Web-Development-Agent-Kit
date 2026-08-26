#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const SEVERITIES = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
const CONFIDENCES = new Set(["HIGH", "MEDIUM", "LOW"]);
const PROVIDERS = new Set(["auto", "codex", "claude", "gemini"]);
const ACTIVE_STATUSES = new Set(["OPEN", "STILL_OPEN", "NEW", "REGRESSION"]);
const SECURITY_AREAS = [
  { id: "authentication", name: "Authentication", paths: /(auth|login|signin|signup|register|password|credential|identity|mfa|2fa|verify|account)/i, text: /(password|credential|login|sign.?in|authenticate|mfa|2fa|otp|verification)/i, concerns: ["credential handling", "brute force", "account enumeration", "password reset", "MFA bypass", "authentication bypass"] },
  { id: "authorization", name: "Authorization & Multi-tenancy", paths: /(permission|role|rbac|acl|policy|tenant|organization|workspace|member|admin|owner)/i, text: /(authorize|authorization|permission|role|tenant|owner|admin|isAdmin|can[A-Z_]|policy)/i, concerns: ["IDOR/BOLA", "BFLA", "tenant isolation", "privilege escalation", "ownership validation", "missing server-side authorization"] },
  { id: "sessions", name: "Sessions, JWT & OAuth", paths: /(session|jwt|token|oauth|oidc|cookie|refresh)/i, text: /(jwt|bearer|access.?token|refresh.?token|session|cookie|oauth|oidc|sameSite|httpOnly)/i, concerns: ["token validation", "algorithm confusion", "session fixation", "revocation", "expiration", "cookie security", "OAuth/OIDC state and redirect validation"] },
  { id: "api", name: "API & Input Validation", paths: /(^|\/)(api|routes?|controllers?|handlers?|endpoints?|rpc|graphql)(\/|$)/i, text: /(req\.|request\.|params|query|body|headers|router\.|app\.(get|post|put|patch|delete)|graphql|resolver)/i, concerns: ["untrusted input", "mass assignment", "excessive data exposure", "unsafe methods", "schema validation", "API authorization"] },
  { id: "database", name: "Database & Data Access", paths: /(db|database|repository|repositories|models?|orm|prisma|drizzle|sequelize|typeorm|mongoose|sql|migration)/i, text: /(select |insert |update |delete |query\(|execute\(|prisma\.|drizzle|mongoose|sequelize|typeorm|transaction)/i, concerns: ["SQL/NoSQL injection", "tenant isolation", "unsafe queries", "transaction integrity", "mass assignment", "data exposure"] },
  { id: "injection", name: "Injection & Code Execution", paths: /(shell|exec|command|template|render|query|script)/i, text: /(exec\(|spawn\(|system\(|eval\(|Function\(|child_process|shell|rawQuery|queryRaw|innerHTML|template)/i, concerns: ["SQL injection", "NoSQL injection", "OS command injection", "template injection", "code evaluation", "LDAP/header injection"] },
  { id: "browser", name: "Browser Security & XSS", paths: /(components?|pages?|views?|frontend|client|browser|ui|templates?)/i, text: /(innerHTML|dangerouslySetInnerHTML|document\.write|postMessage|location\.|window\.open|href=|src=|sanitize)/i, concerns: ["stored/reflected/DOM XSS", "unsafe HTML", "open redirect", "postMessage trust", "clickjacking", "CSP", "client-side secret/token exposure"] },
  { id: "csrf_cors", name: "CSRF, CORS & Browser Boundaries", paths: /(cors|csrf|middleware|server|api|auth)/i, text: /(cors|csrf|sameSite|Access-Control-Allow|origin|credentials:\s*true)/i, concerns: ["CSRF", "overbroad CORS", "credentialed wildcard origins", "origin validation", "unsafe state-changing GET"] },
  { id: "network", name: "SSRF & Outbound Networking", paths: /(http|network|fetch|proxy|webhook|callback|url|integration|client)/i, text: /(fetch\(|axios|http\.request|https\.request|request\(|webhook|callback|new URL|proxy)/i, concerns: ["SSRF", "DNS rebinding", "internal service access", "unsafe redirect following", "TLS verification", "webhook authenticity"] },
  { id: "files", name: "File Upload & Filesystem", paths: /(upload|file|storage|media|asset|archive|zip|image|document)/i, text: /(multipart|upload|filename|path\.join|readFile|writeFile|createReadStream|extract|unzip|mime|content-type)/i, concerns: ["unrestricted upload", "MIME spoofing", "path traversal", "zip slip", "archive bombs", "overwrite", "public data exposure", "malicious SVG/content"] },
  { id: "secrets", name: "Secrets & Credentials", paths: /(\.env|secret|credential|config|settings|key|token)/i, text: /(api[_-]?key|secret|password|private[_-]?key|access[_-]?key|client[_-]?secret|token\s*[:=])/i, concerns: ["hard-coded secrets", "secret leakage", "unsafe logging", "credential scope", "private key exposure"] },
  { id: "crypto", name: "Cryptography", paths: /(crypto|hash|encrypt|decrypt|sign|certificate|tls)/i, text: /(md5|sha1|crypto\.|encrypt|decrypt|cipher|randomBytes|Math\.random|sign\(|verify\()/i, concerns: ["weak algorithms", "predictable randomness", "nonce/IV reuse", "key management", "signature verification", "TLS validation"] },
  { id: "dependencies", name: "Dependencies & Supply Chain", paths: /(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements|poetry\.lock|uv\.lock|go\.mod|go\.sum|Cargo\.lock|composer\.lock|Gemfile\.lock|pom\.xml|gradle|packages\.lock\.json)/i, text: /(dependencies|devDependencies|packageManager|registry|postinstall|preinstall|resolution|override)/i, concerns: ["known CVE/GHSA/OSV advisories", "dependency confusion", "typosquatting", "malicious lifecycle scripts", "unsafe version downgrade", "untrusted package sources"] },
  { id: "containers_iac", name: "Containers, IaC & Cloud", paths: /(Dockerfile|docker-compose|compose\.ya?ml|k8s|kubernetes|helm|terraform|\.tf$|cloudformation|pulumi|deployment|service\.ya?ml|ingress)/i, text: /(FROM |USER |privileged|cap_add|hostNetwork|securityContext|terraform|iam|publicAccess|0\.0\.0\.0|LoadBalancer)/i, concerns: ["root/privileged workloads", "exposed services", "weak IAM", "insecure defaults", "secret mounts", "public buckets/databases", "container/image risk"] },
  { id: "cicd", name: "CI/CD & Repository Automation", paths: /(^|\/)(\.github\/workflows|\.gitlab-ci|Jenkinsfile|azure-pipelines|circleci|buildkite|ci)(\/|$|\.)/i, text: /(pull_request_target|permissions:|secrets\.|GITHUB_TOKEN|uses:|run:|workflow_call|workflow_dispatch)/i, concerns: ["untrusted PR execution", "workflow command injection", "overbroad token permissions", "unpinned actions", "secret exfiltration", "artifact poisoning"] },
  { id: "logging_privacy", name: "Logging, Privacy & Sensitive Data", paths: /(log|audit|telemetry|analytics|monitor|observability|error)/i, text: /(console\.log|logger\.|log\(|telemetry|analytics|sentry|error\(|stack)/i, concerns: ["PII/credential leakage", "verbose errors", "security-event audit gaps", "log injection", "retention/privacy"] },
  { id: "abuse", name: "Rate Limiting, Abuse & DoS", paths: /(rate|limit|queue|worker|search|login|api|upload|export|report)/i, text: /(rateLimit|throttle|limit|timeout|queue|pagination|pageSize|retry|loop|while\s*\()/i, concerns: ["brute force", "resource exhaustion", "unbounded queries", "request-size abuse", "retry storms", "algorithmic complexity"] },
  { id: "realtime", name: "WebSockets & Realtime", paths: /(websocket|socket|realtime|ws|sse|channel|room)/i, text: /(WebSocket|socket\.|io\.|subscribe|publish|channel|room|SSE|EventSource)/i, concerns: ["connection authentication", "message authorization", "room isolation", "replay", "flooding", "origin validation"] },
  { id: "business_logic", name: "Business Logic, Concurrency & Transactions", paths: /(payment|billing|order|checkout|balance|wallet|credit|booking|reservation|inventory|workflow|state|transaction)/i, text: /(payment|amount|price|balance|credit|booking|reserve|inventory|status|transition|transaction|idempot)/i, concerns: ["workflow bypass", "price/amount tampering", "double-spend", "race conditions", "idempotency", "state-transition abuse", "TOCTOU"] },
  { id: "deserialization", name: "Deserialization & Dynamic Data", paths: /(serialize|deserialize|yaml|xml|template|parser|import)/i, text: /(deserialize|unserialize|yaml\.load|XML|DOMParser|JSON\.parse|pickle|marshal|ObjectInputStream|template)/i, concerns: ["unsafe deserialization", "XXE", "prototype pollution", "parser bombs", "template injection"] },
  { id: "cache", name: "Cache & Shared-State Boundaries", paths: /(cache|redis|memcache|cdn|edge)/i, text: /(redis|cache|ttl|keyPrefix|invalidate|cdn|vary|etag)/i, concerns: ["cross-user cache leakage", "cache poisoning", "tenant key collisions", "stale authorization data", "sensitive response caching"] },
];

function nowIso() { return new Date().toISOString(); }
function readJson(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function readText(file, fallback = "") { try { return fs.readFileSync(file, "utf8"); } catch { return fallback; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function writeText(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value.endsWith("\n") ? value : `${value}\n`, "utf8"); }
function slug(value) { const out = String(value || "detached").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""); return out || "detached"; }
function sha(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout ?? 120_000,
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
    shell: options.shell ?? (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)),
  });
}
function git(project, args, fallback = "") { const result = run("git", args, { cwd: project, timeout: 60_000 }); return !result.error && result.status === 0 ? String(result.stdout || "").trim() : fallback; }
function gitOk(project, args) { const result = run("git", args, { cwd: project, timeout: 60_000 }); return !result.error && result.status === 0; }
function parseArgs(argv) {
  const out = { project: ".", base: null, provider: process.env.WEB_KIT_SECURITY_PROVIDER || "auto", deep: false, scanOnly: false, noScanners: false, json: false, failOnBlocking: false, timeoutMs: 180_000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => argv[++i] ?? null;
    if (arg === "--project") out.project = value() || ".";
    else if (arg.startsWith("--project=")) out.project = arg.slice(10);
    else if (arg === "--base") out.base = value();
    else if (arg.startsWith("--base=")) out.base = arg.slice(7);
    else if (arg === "--provider") out.provider = value() || "auto";
    else if (arg.startsWith("--provider=")) out.provider = arg.slice(11);
    else if (arg === "--deep") out.deep = true;
    else if (arg === "--scan-only") out.scanOnly = true;
    else if (arg === "--no-scanners") out.noScanners = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--fail-on-blocking") out.failOnBlocking = true;
    else if (arg === "--timeout") out.timeoutMs = Math.max(10_000, Number(value() || 180) * 1000);
    else if (arg.startsWith("--timeout=")) out.timeoutMs = Math.max(10_000, Number(arg.slice(10) || 180) * 1000);
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown security-review option: ${arg}`);
  }
  out.provider = String(out.provider || "auto").toLowerCase();
  if (!PROVIDERS.has(out.provider)) throw new Error(`Unsupported provider: ${out.provider}. Use auto, codex, claude, or gemini.`);
  if (!Number.isFinite(out.timeoutMs)) out.timeoutMs = 180_000;
  return out;
}
function printHelp() {
  console.log(`Web Kit Security PR Reviewer\n\nUsage:\n  node .agent-core/bin/security-review.mjs [options]\n\nOptions:\n  --project <path>          Project root. Default: current directory.\n  --base <branch/ref>       Base branch/ref. Auto-detected when omitted.\n  --provider <name>         auto | codex | claude | gemini. Default: auto.\n  --deep                    Review every security area, not only mapped attack surfaces.\n  --scan-only               Run scanners/branch analysis without an AI reviewer.\n  --no-scanners             Skip external security scanners.\n  --json                    Print final review as JSON.\n  --fail-on-blocking        Exit non-zero when decision is REQUEST_CHANGES.\n  --timeout <seconds>       Per scanner/provider timeout. Default: 180.\n\nProvider-neutral AI trigger:\n  run security-review\n`);
}
function refExists(project, ref) { return Boolean(ref) && gitOk(project, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]); }
function detectBase(project, current, explicit) {
  if (explicit) { if (!refExists(project, explicit)) throw new Error(`Base ref does not exist: ${explicit}`); return explicit; }
  const remoteHead = git(project, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const candidates = [process.env.WEB_KIT_SECURITY_BASE, remoteHead, "origin/main", "main", "origin/master", "master", "origin/develop", "develop"].filter(Boolean);
  for (const candidate of candidates) {
    const short = String(candidate).replace(/^origin\//, "");
    if (short === current) continue;
    if (refExists(project, candidate)) return candidate;
  }
  const parent = git(project, ["rev-parse", "--verify", "HEAD^"]);
  if (parent) return parent;
  throw new Error("Could not determine a base branch/ref. Re-run with --base <branch>.");
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function changedFiles(project, mergeBase) {
  const committed = git(project, ["diff", "--name-only", "--diff-filter=ACMRTUXB", `${mergeBase}...HEAD`]).split(/\r?\n/).filter(Boolean);
  const unstaged = git(project, ["diff", "--name-only", "--diff-filter=ACMRTUXB"]).split(/\r?\n/).filter(Boolean);
  const staged = git(project, ["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"]).split(/\r?\n/).filter(Boolean);
  const untracked = git(project, ["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/).filter(Boolean);
  return unique([...committed, ...staged, ...unstaged, ...untracked]).sort();
}
function diffText(project, mergeBase) {
  return [git(project, ["diff", "--no-ext-diff", "--unified=12", `${mergeBase}...HEAD`]), git(project, ["diff", "--cached", "--no-ext-diff", "--unified=12"]), git(project, ["diff", "--no-ext-diff", "--unified=12"])].filter(Boolean).join("\n");
}
function mapAttackSurface(files, diff, deep) {
  const fileText = files.join("\n");
  const applicable = [];
  for (const area of SECURITY_AREAS) {
    const reasons = [];
    if (deep) reasons.push("deep review requested");
    const pathHits = files.filter((file) => area.paths.test(file)).slice(0, 8);
    if (pathHits.length) reasons.push(`changed paths: ${pathHits.join(", ")}`);
    if (area.text.test(diff) || area.text.test(fileText)) reasons.push("changed code/config contains related security signals");
    if (reasons.length) applicable.push({ id: area.id, name: area.name, status: "REVIEW_REQUIRED", reasons, concerns: area.concerns });
  }
  if (!applicable.some((a) => a.id === "secrets")) applicable.push({ id: "secrets", name: "Secrets & Credentials", status: "REVIEW_REQUIRED", reasons: ["baseline branch review check"], concerns: SECURITY_AREAS.find((a) => a.id === "secrets").concerns });
  if (!applicable.length) applicable.push({ id: "general", name: "General Security Invariants", status: "REVIEW_REQUIRED", reasons: ["branch contains changes but no specialized surface was mapped"], concerns: ["trust boundaries", "input validation", "authorization", "data exposure", "unsafe defaults"] });
  return applicable;
}
function executableExists(command) {
  const safe = command.replace(/[^a-zA-Z0-9._-]/g, "");
  const check = process.platform === "win32" ? run("where.exe", [safe], { timeout: 10_000 }) : run("sh", ["-lc", `command -v ${safe}`], { timeout: 10_000 });
  return !check.error && check.status === 0;
}
function scannerRecord(name, status, details = {}) { return { name, status, ...details }; }
function safeJsonParse(text, fallback = null) { try { return JSON.parse(String(text || "").trim()); } catch { return fallback; } }
function runScanners(project, runtimeDir, timeoutMs) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const results = [];
  const save = (name, data) => { const file = path.join(runtimeDir, `${name}.json`); writeJson(file, data); return path.relative(project, file).split(path.sep).join("/"); };

  if (executableExists("semgrep")) {
    const r = run("semgrep", ["scan", "--config", "auto", "--json", "--metrics=off", "."], { cwd: project, timeout: timeoutMs });
    const parsed = safeJsonParse(r.stdout, {}); const count = Array.isArray(parsed?.results) ? parsed.results.length : null;
    results.push(scannerRecord("semgrep", r.error ? "ERROR" : r.status === 0 ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, output: save("semgrep", parsed || { stdout: r.stdout, stderr: r.stderr }), note: r.error?.message || (r.status !== 0 ? String(r.stderr || "").slice(0, 1200) : null) }));
  } else results.push(scannerRecord("semgrep", "SKIPPED", { reason: "semgrep not installed on PATH" }));

  if (executableExists("osv-scanner")) {
    const r = run("osv-scanner", ["scan", "source", "--recursive", "--format", "json", "."], { cwd: project, timeout: timeoutMs });
    const parsed = safeJsonParse(r.stdout, {}); let count = 0;
    for (const result of parsed?.results || []) for (const pkg of result?.packages || []) count += (pkg?.vulnerabilities || []).length;
    results.push(scannerRecord("osv-scanner", r.error ? "ERROR" : (r.status === 0 || r.status === 1) ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, output: save("osv-scanner", parsed || { stdout: r.stdout, stderr: r.stderr }), note: r.error?.message || ((r.status !== 0 && r.status !== 1) ? String(r.stderr || "").slice(0, 1200) : null) }));
  } else results.push(scannerRecord("osv-scanner", "SKIPPED", { reason: "osv-scanner not installed on PATH" }));

  if (executableExists("gitleaks")) {
    const report = path.join(runtimeDir, "gitleaks-raw.json");
    const r = run("gitleaks", ["dir", ".", "--report-format", "json", "--report-path", report, "--redact", "--exit-code", "0", "--no-banner"], { cwd: project, timeout: timeoutMs });
    const parsed = fs.existsSync(report) ? safeJsonParse(readText(report), []) : []; const count = Array.isArray(parsed) ? parsed.length : null;
    results.push(scannerRecord("gitleaks", r.error ? "ERROR" : r.status === 0 ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, output: save("gitleaks", parsed || []), note: r.error?.message || (r.status !== 0 ? String(r.stderr || "").slice(0, 1200) : null) }));
    try { fs.unlinkSync(report); } catch {}
  } else results.push(scannerRecord("gitleaks", "SKIPPED", { reason: "gitleaks not installed on PATH" }));

  if (executableExists("trivy")) {
    const r = run("trivy", ["fs", "--format", "json", "--scanners", "vuln,misconfig,secret", "--exit-code", "0", "."], { cwd: project, timeout: timeoutMs });
    const parsed = safeJsonParse(r.stdout, {}); let count = 0;
    for (const result of parsed?.Results || []) { count += (result?.Vulnerabilities || []).length; count += (result?.Misconfigurations || []).length; count += (result?.Secrets || []).length; }
    results.push(scannerRecord("trivy", r.error ? "ERROR" : r.status === 0 ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, output: save("trivy", parsed || { stdout: r.stdout, stderr: r.stderr }), note: r.error?.message || (r.status !== 0 ? String(r.stderr || "").slice(0, 1200) : null) }));
  } else results.push(scannerRecord("trivy", "SKIPPED", { reason: "trivy not installed on PATH" }));

  const packageLock = path.join(project, "package-lock.json");
  if (fs.existsSync(packageLock) && executableExists("npm")) {
    const r = run(process.platform === "win32" ? "npm.cmd" : "npm", ["audit", "--json", "--audit-level=low"], { cwd: project, timeout: timeoutMs });
    const parsed = safeJsonParse(r.stdout, {}); const vuln = parsed?.metadata?.vulnerabilities || {}; const count = Object.values(vuln).reduce((sum, value) => sum + (Number(value) || 0), 0);
    results.push(scannerRecord("npm-audit", r.error ? "ERROR" : (r.status === 0 || r.status === 1) ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, output: save("npm-audit", parsed || { stdout: r.stdout, stderr: r.stderr }), note: r.error?.message || ((r.status !== 0 && r.status !== 1) ? String(r.stderr || "").slice(0, 1200) : null) }));
  } else results.push(scannerRecord("npm-audit", "SKIPPED", { reason: fs.existsSync(packageLock) ? "npm not available" : "package-lock.json not present" }));

  const pnpmLock = path.join(project, "pnpm-lock.yaml");
  if (fs.existsSync(pnpmLock) && executableExists("pnpm")) {
    const cmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm"; const r = run(cmd, ["audit", "--json"], { cwd: project, timeout: timeoutMs });
    const parsed = safeJsonParse(r.stdout, {}); const count = Number(parsed?.metadata?.vulnerabilities?.total ?? parsed?.metadata?.vulnerabilities ?? 0) || 0;
    results.push(scannerRecord("pnpm-audit", r.error ? "ERROR" : (r.status === 0 || r.status === 1) ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, output: save("pnpm-audit", parsed || { stdout: r.stdout, stderr: r.stderr }), note: r.error?.message || ((r.status !== 0 && r.status !== 1) ? String(r.stderr || "").slice(0, 1200) : null) }));
  } else results.push(scannerRecord("pnpm-audit", "SKIPPED", { reason: fs.existsSync(pnpmLock) ? "pnpm not available" : "pnpm-lock.yaml not present" }));
  return results;
}
function providerOverride(provider) { const env = { codex: "WEB_KIT_SECURITY_CODEX_BIN", claude: "WEB_KIT_SECURITY_CLAUDE_BIN", gemini: "WEB_KIT_SECURITY_GEMINI_BIN" }[provider]; return env ? process.env[env] : null; }
function resolveExecutable(name) {
  const direct = providerOverride(name); if (direct) return path.resolve(direct);
  if (process.platform === "win32") { const r = run("where.exe", [name], { timeout: 10_000 }); const line = String(r.stdout || "").split(/\r?\n/).find(Boolean); return !r.error && r.status === 0 && line ? line.trim() : null; }
  const r = run("sh", ["-lc", `command -v ${name}`], { timeout: 10_000 }); const line = String(r.stdout || "").split(/\r?\n/).find(Boolean); return !r.error && r.status === 0 && line ? line.trim() : null;
}
function chooseProvider(requested) {
  if (requested !== "auto") { const executable = resolveExecutable(requested); if (!executable) throw new Error(`Security reviewer provider '${requested}' is not available on PATH.`); return { name: requested, executable }; }
  for (const name of ["codex", "claude", "gemini"]) { const executable = resolveExecutable(name); if (executable) return { name, executable }; }
  throw new Error("No supported headless AI reviewer found. Install/authenticate Codex, Claude, or Gemini CLI, or use --scan-only.");
}
function providerLaunch(file, args) { if (/\.(mjs|cjs|js)$/i.test(file)) return { command: process.execPath, args: [file, ...args], shell: false }; return { command: file, args, shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(file) }; }
function parseJsonObject(text) {
  if (!text) return null; const trimmed = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""); const direct = safeJsonParse(trimmed, null); if (direct && typeof direct === "object") return direct;
  const start = trimmed.indexOf("{"); const end = trimmed.lastIndexOf("}"); return start >= 0 && end > start ? safeJsonParse(trimmed.slice(start, end + 1), null) : null;
}
function buildPrompt(contextRel, previousRel) {
  return `Act as the independent Web Kit Security PR Reviewer.\n\nThis is a READ-ONLY security review. Do not modify files, do not fix findings, do not commit, and do not alter repository state.\n\nFirst read:\n- .agent-core/agents/security-reviewer.md\n- .agent-core/rules/security-review.md\n- ${contextRel}\n${previousRel ? `- ${previousRel} (previous review; verify every previous finding and do not silently drop one)` : ""}\n\nReview the CURRENT branch against the exact base/merge-base recorded in the context file. Inspect the actual git diff and all surrounding source/configuration needed to validate trust boundaries and exploitability.\n\nRequired behavior:\n1. Cover every attack surface marked REVIEW_REQUIRED in the context and expand to additional related surfaces discovered while tracing affected code.\n2. Check all relevant vulnerability classes, not just OWASP Top 10: auth/authz, IDOR/BOLA/BFLA, sessions/JWT/OAuth, injection, XSS, CSRF/CORS, SSRF, uploads/filesystem, secrets, crypto, dependencies/supply-chain, containers/IaC/cloud, CI/CD, privacy/logging, abuse/DoS, realtime, business logic, concurrency, deserialization, cache isolation, and framework/language-specific issues when relevant.\n3. Follow changed code into related middleware, data access, validation, authorization, configuration, and dependency boundaries. Do not limit reasoning to the textual diff when surrounding code controls security.\n4. Use scanner artifacts recorded in the context as evidence, but independently verify high-impact findings in source when possible. Scanner failures or missing scanners are coverage limitations, not proof of safety.\n5. Map findings to OWASP Web/API categories and CWE when appropriate. Attach CVE/GHSA/OSV identifiers only when a real scanner/advisory/source supports them. Never invent an advisory.\n6. Prefer concrete, realistically exploitable findings over generic checklist noise. Include evidence, attack scenario, impact, recommendation, and required validation.\n7. Return ALL findings in one review.\n8. If a previous review exists, re-review every prior finding. The engine will reconcile persistent SEC-* IDs by fingerprint.\n9. Do not calculate the final /5 rating or merge decision; Web Kit calculates those deterministically.\n\nReturn ONLY one JSON object, no markdown fences:\n{\n  \"summary\": \"short security assessment\",\n  \"limitations\": [\"coverage limitations, missing runtime evidence, scanner gaps\"],\n  \"coverage\": [{ \"area\": \"security area\", \"status\": \"REVIEWED|NOT_APPLICABLE|LIMITED\", \"notes\": \"what was checked and why\" }],\n  \"findings\": [{\n    \"fingerprint\": \"stable-lowercase-identifier-that-remains-the-same-after-a-fix\",\n    \"title\": \"specific vulnerability title\",\n    \"severity\": \"CRITICAL|HIGH|MEDIUM|LOW|INFO\",\n    \"confidence\": \"HIGH|MEDIUM|LOW\",\n    \"category\": \"security category\",\n    \"file\": \"repository-relative/path\",\n    \"line\": 123,\n    \"owasp\": [\"A01:2021 Broken Access Control\"],\n    \"cwe\": [\"CWE-639\"],\n    \"advisories\": [\"CVE/GHSA/OSV only when verified\"],\n    \"evidence\": \"source/scanner evidence without exposing secret values\",\n    \"attack_scenario\": \"realistic exploit/abuse path\",\n    \"impact\": \"security impact\",\n    \"recommendation\": \"specific remediation\",\n    \"validation\": \"specific test or verification required\"\n  }]\n}`;
}
function invokeProvider(provider, project, prompt, timeoutMs) {
  const env = { ...process.env, WEB_KIT_SECURITY_REVIEW_ACTIVE: "1", WEB_KIT_SECURITY_PROJECT_ROOT: project };
  let args;
  if (provider.name === "codex") args = ["exec", "--json", "--sandbox", "read-only", "-C", project, prompt];
  else if (provider.name === "claude") args = ["-p", prompt, "--output-format", "json", "--permission-mode", "plan"];
  else args = ["-p", prompt, "--output-format", "json", "--approval-mode", "plan"];
  const launch = providerLaunch(provider.executable, args); const result = run(launch.command, launch.args, { cwd: project, env, timeout: timeoutMs, shell: launch.shell, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${provider.name} security reviewer failed: ${result.error?.message || String(result.stderr || "").slice(0, 2000) || `exit ${result.status}`}`);
  let text = "";
  if (provider.name === "codex") {
    for (const line of String(result.stdout || "").split(/\r?\n/)) { const event = safeJsonParse(line, null); if (!event) continue; if (event.type === "item.completed" && event.item && ["agent_message", "assistant_message", "message"].includes(event.item.type) && typeof event.item.text === "string") text = event.item.text; if (event.type === "message" && event.role === "assistant" && typeof event.content === "string") text = event.content; }
  } else { const outer = safeJsonParse(result.stdout, null); text = provider.name === "claude" ? (outer?.result || outer?.response || String(result.stdout || "")) : (outer?.response || outer?.result || String(result.stdout || "")); }
  const parsed = parseJsonObject(text); if (!parsed || !Array.isArray(parsed.findings) || !Array.isArray(parsed.coverage)) throw new Error(`${provider.name} returned an invalid security review payload. Expected JSON with findings[] and coverage[].`); return parsed;
}
function normalizedSeverity(value) { const v = String(value || "MEDIUM").toUpperCase(); return SEVERITIES.has(v) ? v : "MEDIUM"; }
function normalizedConfidence(value) { const v = String(value || "MEDIUM").toUpperCase(); return CONFIDENCES.has(v) ? v : "MEDIUM"; }
function deriveFingerprint(finding) { const existing = String(finding.fingerprint || "").trim().toLowerCase(); return existing ? existing.replace(/[^a-z0-9._:/-]+/g, "-").slice(0, 180) : sha([finding.category, finding.file, finding.title].map((v) => String(v || "").toLowerCase()).join("|")).slice(0, 24); }
function normalizeFinding(finding) {
  return { fingerprint: deriveFingerprint(finding), title: String(finding.title || "Security finding").trim(), severity: normalizedSeverity(finding.severity), confidence: normalizedConfidence(finding.confidence), category: String(finding.category || "General Security").trim(), file: finding.file ? String(finding.file).replace(/\\/g, "/") : null, line: Number.isInteger(Number(finding.line)) && Number(finding.line) > 0 ? Number(finding.line) : null, owasp: Array.isArray(finding.owasp) ? finding.owasp.map(String).slice(0, 20) : [], cwe: Array.isArray(finding.cwe) ? finding.cwe.map(String).slice(0, 20) : [], advisories: Array.isArray(finding.advisories) ? finding.advisories.map(String).filter((v) => /^(CVE-|GHSA-|OSV-|GO-|RUSTSEC-|PYSEC-)/i.test(v)).slice(0, 20) : [], evidence: String(finding.evidence || "").trim(), attack_scenario: String(finding.attack_scenario || "").trim(), impact: String(finding.impact || "").trim(), recommendation: String(finding.recommendation || "").trim(), validation: String(finding.validation || "").trim() };
}
function nextSecurityId(previous) { let max = 0; for (const f of previous?.findings || []) { const match = String(f.id || "").match(/^SEC-(\d+)$/); if (match) max = Math.max(max, Number(match[1])); } return () => `SEC-${String(++max).padStart(3, "0")}`; }
function isBlocking(finding) { if (!ACTIVE_STATUSES.has(finding.status) || finding.confidence === "LOW") return false; return ["CRITICAL", "HIGH", "MEDIUM"].includes(finding.severity); }
function reconcileFindings(raw, previous, reviewNumber) {
  const previousByFp = new Map((previous?.findings || []).map((f) => [f.fingerprint, f])); const seen = new Set(); const allocate = nextSecurityId(previous); const out = [];
  for (const source of raw.map(normalizeFinding)) {
    if (seen.has(source.fingerprint)) continue; seen.add(source.fingerprint); const prior = previousByFp.get(source.fingerprint); let status;
    if (!prior) status = reviewNumber === 1 ? "OPEN" : "NEW"; else if (prior.status === "RESOLVED") status = "REGRESSION"; else status = "STILL_OPEN";
    const item = { ...source, id: prior?.id || allocate(), status, first_seen_review: prior?.first_seen_review || reviewNumber, last_seen_review: reviewNumber, resolved_review: null }; item.blocking = isBlocking(item); out.push(item);
  }
  for (const prior of previous?.findings || []) {
    if (seen.has(prior.fingerprint)) continue;
    if (prior.status === "RESOLVED") out.push({ ...prior, blocking: false }); else out.push({ ...prior, status: "RESOLVED", blocking: false, resolved_review: reviewNumber });
  }
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  return out.sort((a, b) => Boolean(a.blocking) !== Boolean(b.blocking) ? (a.blocking ? -1 : 1) : order[a.severity] !== order[b.severity] ? order[a.severity] - order[b.severity] : String(a.id).localeCompare(String(b.id)));
}
function rating(findings) {
  const active = findings.filter((f) => ACTIVE_STATUSES.has(f.status)); if (!active.length) return 5;
  const multipliers = { HIGH: 1, MEDIUM: 0.75, LOW: 0.5 }; const weights = { CRITICAL: 3.0, HIGH: 1.5, MEDIUM: 0.55, LOW: 0.15, INFO: 0.02 }; let penalty = 0;
  for (const f of active) penalty += weights[f.severity] * multipliers[f.confidence]; let score = Math.max(0, 5 - penalty);
  const critical = active.some((f) => f.severity === "CRITICAL" && f.confidence !== "LOW"); const highs = active.filter((f) => f.severity === "HIGH" && f.confidence !== "LOW").length; const medium = active.some((f) => f.severity === "MEDIUM" && f.confidence !== "LOW");
  if (critical) score = Math.min(score, 1.5); else if (highs >= 2) score = Math.min(score, 2.0); else if (highs === 1) score = Math.min(score, 2.9); else if (medium) score = Math.min(score, 3.9); else if (active.some((f) => f.severity === "LOW")) score = Math.min(score, 4.7);
  return Math.round(score * 10) / 10;
}
function countBySeverity(findings) { const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }; for (const f of findings) if (ACTIVE_STATUSES.has(f.status)) counts[f.severity] += 1; return counts; }
function renderMarkdown(review) {
  const lines = ["# Web Kit Security PR Review", "", `- **Branch:** \`${review.branch}\``, `- **Base:** \`${review.base}\``, `- **Review:** ${review.review_number} (${review.mode})`, `- **Security Rating:** **${review.rating.toFixed(1)} / 5**`, `- **Decision:** **${review.decision}**`, `- **Reviewer Provider:** ${review.provider || "scan-only"}`, "", "## Active findings", ""];
  const active = review.findings.filter((f) => ACTIVE_STATUSES.has(f.status)); if (!active.length) lines.push("No active findings.", "");
  for (const f of active) {
    lines.push(`### ${f.id} — ${f.severity} — ${f.title}`, "", `- **Status:** ${f.status}`, `- **Confidence:** ${f.confidence}`, `- **Blocking:** ${f.blocking ? "YES" : "NO"}`); if (f.file) lines.push(`- **Location:** \`${f.file}${f.line ? `:${f.line}` : ""}\``); if (f.category) lines.push(`- **Category:** ${f.category}`); if (f.owasp.length) lines.push(`- **OWASP:** ${f.owasp.join(", ")}`); if (f.cwe.length) lines.push(`- **CWE:** ${f.cwe.join(", ")}`); if (f.advisories.length) lines.push(`- **Advisories:** ${f.advisories.join(", ")}`); lines.push("");
    if (f.evidence) lines.push("**Evidence:**", "", f.evidence, ""); if (f.attack_scenario) lines.push("**Attack scenario:**", "", f.attack_scenario, ""); if (f.impact) lines.push("**Impact:**", "", f.impact, ""); if (f.recommendation) lines.push("**Recommendation:**", "", f.recommendation, ""); if (f.validation) lines.push("**Required validation:**", "", f.validation, "");
  }
  const resolved = review.findings.filter((f) => f.status === "RESOLVED"); if (resolved.length) { lines.push("## Resolved findings", ""); for (const f of resolved) lines.push(`- ✅ ${f.id} — ${f.title}`); lines.push(""); }
  lines.push("## Security coverage", ""); for (const c of review.coverage || []) lines.push(`- **${c.area}:** ${c.status}${c.notes ? ` — ${c.notes}` : ""}`); lines.push("", "## Scanner status", "");
  for (const s of review.scanners || []) lines.push(`- **${s.name}:** ${s.status}${Number.isInteger(s.finding_count) ? ` (${s.finding_count} findings)` : ""}${s.reason ? ` — ${s.reason}` : ""}${s.note ? ` — ${String(s.note).slice(0, 300)}` : ""}`); lines.push("");
  if (review.limitations?.length) { lines.push("## Limitations", ""); for (const item of review.limitations) lines.push(`- ${item}`); lines.push(""); }
  lines.push("> A 5/5 review means no blocking issue was found in the reviewed branch and available evidence. It is not a guarantee that the software is vulnerability-free."); return `${lines.join("\n")}\n`;
}
function printHuman(review, latestMd) {
  console.log("\n╔════════════════════════════════════════╗\n║       WEB KIT SECURITY PR REVIEW      ║\n╚════════════════════════════════════════╝\n");
  console.log(`Branch:          ${review.branch}\nBase:            ${review.base}\nReview:          #${review.review_number} (${review.mode})\nSecurity Rating: ${review.rating.toFixed(1)} / 5\nDecision:        ${review.decision}\nProvider:        ${review.provider || "scan-only"}\n`);
  const c = review.counts; console.log(`Critical: ${c.CRITICAL}  High: ${c.HIGH}  Medium: ${c.MEDIUM}  Low: ${c.LOW}  Info: ${c.INFO}\n`); const active = review.findings.filter((f) => ACTIVE_STATUSES.has(f.status)); if (!active.length) console.log("✓ No active security findings.");
  for (const f of active) { console.log(`${f.blocking ? "✗" : "•"} ${f.id}  ${f.severity}  ${f.status}  ${f.title}`); if (f.file) console.log(`  ${f.file}${f.line ? `:${f.line}` : ""}`); }
  for (const f of review.findings.filter((f) => f.status === "RESOLVED" && f.resolved_review === review.review_number)) console.log(`✓ ${f.id}  RESOLVED  ${f.title}`); console.log(`\nFull review: ${latestMd}`);
}
async function main() {
  const args = parseArgs(process.argv.slice(2)); if (args.help) { printHelp(); return 0; }
  const project = path.resolve(args.project); if (!fs.existsSync(project)) throw new Error(`Project does not exist: ${project}`); if (git(project, ["rev-parse", "--is-inside-work-tree"]) !== "true") throw new Error("security-review requires a Git repository.");
  const branch = git(project, ["branch", "--show-current"]) || `detached-${git(project, ["rev-parse", "--short", "HEAD"]) || "head"}`; const base = detectBase(project, branch, args.base); const mergeBase = git(project, ["merge-base", base, "HEAD"]); if (!mergeBase) throw new Error(`Could not determine merge-base between ${base} and HEAD.`); const head = git(project, ["rev-parse", "HEAD"]);
  const files = changedFiles(project, mergeBase); const diff = diffText(project, mergeBase); const surfaces = mapAttackSurface(files, diff, args.deep);
  const reviewRoot = path.join(project, ".agent-core", "security-reviews", slug(branch)); const historyDir = path.join(reviewRoot, "history"); const runtimeDir = path.join(reviewRoot, "runtime"); const latestJson = path.join(reviewRoot, "latest.json"); const latestMd = path.join(reviewRoot, "latest.md"); const previous = readJson(latestJson, null); const reviewNumber = Number(previous?.review_number || 0) + 1; fs.mkdirSync(historyDir, { recursive: true }); fs.mkdirSync(runtimeDir, { recursive: true });
  const scanners = args.noScanners ? [scannerRecord("external-scanners", "SKIPPED", { reason: "--no-scanners requested" })] : runScanners(project, runtimeDir, args.timeoutMs);
  const context = { schema_version: 1, review_number: reviewNumber, mode: previous ? "rereview" : "initial", project, branch, base, merge_base: mergeBase, head, changed_files: files, working_tree_status: git(project, ["status", "--short"]).split(/\r?\n/).filter(Boolean), attack_surfaces: surfaces, deep_review: args.deep, scanners, standards: ["OWASP Web Top 10", "OWASP API Security Top 10", "CWE (including CWE Top 25 where relevant)", "CVE/GHSA/OSV only when backed by real advisory evidence", "framework/language-specific security practices", "business-logic and abuse-case analysis"], created_at: nowIso() };
  const contextFile = path.join(runtimeDir, `review-context-${String(reviewNumber).padStart(3, "0")}.json`); writeJson(contextFile, context); const contextRel = path.relative(project, contextFile).split(path.sep).join("/"); const previousRel = previous ? path.relative(project, latestJson).split(path.sep).join("/") : null;
  let provider = null; let modelReview = { summary: "Scanner-only security review.", limitations: [], coverage: surfaces.map((s) => ({ area: s.name, status: "LIMITED", notes: "AI source review skipped by --scan-only." })), findings: [] };
  if (!args.scanOnly) { provider = chooseProvider(args.provider); modelReview = invokeProvider(provider, project, buildPrompt(contextRel, previousRel), args.timeoutMs); } else { modelReview.limitations.push("AI source/security reasoning was not run because --scan-only was requested."); for (const scanner of scanners) if (scanner.status === "FINDINGS") modelReview.limitations.push(`${scanner.name} reported findings; use a full AI review to correlate them into persistent SEC-* findings.`); }
  const findings = reconcileFindings(modelReview.findings || [], previous, reviewNumber); const score = rating(findings); const decision = findings.some((f) => f.blocking) ? "REQUEST_CHANGES" : "APPROVE";
  const review = { schema_version: 1, review_number: reviewNumber, mode: previous ? "rereview" : "initial", branch, base, merge_base: mergeBase, head, changed_files: files, attack_surfaces: surfaces, provider: provider?.name || null, scanners, summary: String(modelReview.summary || "").trim(), limitations: Array.isArray(modelReview.limitations) ? modelReview.limitations.map(String).slice(0, 100) : [], coverage: Array.isArray(modelReview.coverage) ? modelReview.coverage.map((item) => ({ area: String(item.area || "Unknown"), status: ["REVIEWED", "NOT_APPLICABLE", "LIMITED"].includes(String(item.status || "").toUpperCase()) ? String(item.status).toUpperCase() : "LIMITED", notes: String(item.notes || "").trim() })).slice(0, 100) : [], findings, counts: countBySeverity(findings), rating: score, decision, blocking_findings: findings.filter((f) => f.blocking).map((f) => f.id), created_at: nowIso(), disclaimer: "This review is evidence-based risk assessment, not a guarantee that every vulnerability has been found." };
  const historyJson = path.join(historyDir, `review-${String(reviewNumber).padStart(3, "0")}.json`); const historyMd = path.join(historyDir, `review-${String(reviewNumber).padStart(3, "0")}.md`); writeJson(historyJson, review); writeText(historyMd, renderMarkdown(review)); writeJson(latestJson, review); writeText(latestMd, renderMarkdown(review));
  if (args.json) console.log(JSON.stringify(review, null, 2)); else printHuman(review, path.relative(project, latestMd).split(path.sep).join("/")); if (args.failOnBlocking && decision === "REQUEST_CHANGES") return 4; return 0;
}

main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(`[Web Kit] Security Review error: ${error.message}`); process.exitCode = 1; });
