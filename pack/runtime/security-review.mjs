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
const REVIEW_STATE_PREFIX = ".agent-core/security-reviews/";

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
function isReviewState(file) { return posix(file).startsWith(REVIEW_STATE_PREFIX); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }

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
function git(project, args, fallback = "") {
  const r = run("git", args, { cwd: project, timeout: 60_000 });
  return !r.error && r.status === 0 ? String(r.stdout || "").trim() : fallback;
}
function gitOk(project, args) { const r = run("git", args, { cwd: project, timeout: 60_000 }); return !r.error && r.status === 0; }
function gitLines(project, args) { return git(project, args).split(/\r?\n/).map((x) => x.trim()).filter(Boolean); }

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
  console.log(`Web Kit Security PR Reviewer\n\nUsage:\n  node .agent-core/bin/security-review.mjs [options]\n\nOptions:\n  --project <path>          Project root. Default: current directory.\n  --base <branch/ref>       Base branch/ref. Auto-detected when omitted.\n  --provider <name>         auto | codex | claude | gemini.\n  --deep                    Review every security area.\n  --scan-only               Run branch/scanner analysis without AI source review.\n  --no-scanners             Skip optional external scanners.\n  --json                    Print final review JSON.\n  --fail-on-blocking        Exit 4 when REQUEST_CHANGES.\n  --timeout <seconds>       Per scanner/provider timeout. Default: 180.\n\nProvider-neutral AI trigger:\n  run security-review\n`);
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
function changedFiles(project, mergeBase) {
  const committed = gitLines(project, ["diff", "--name-only", "--diff-filter=ACMRTUXB", `${mergeBase}...HEAD`]);
  const staged = gitLines(project, ["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"]);
  const unstaged = gitLines(project, ["diff", "--name-only", "--diff-filter=ACMRTUXB"]);
  const untracked = gitLines(project, ["ls-files", "--others", "--exclude-standard"]);
  return unique([...committed, ...staged, ...unstaged, ...untracked].map(posix)).filter((file) => !isReviewState(file)).sort();
}
function workingTreeStatus(project) {
  return gitLines(project, ["status", "--short"]).filter((line) => {
    const file = posix(line.slice(3).replace(/^"|"$/g, ""));
    return !isReviewState(file);
  });
}
function diffText(project, mergeBase) {
  return [
    git(project, ["diff", "--no-ext-diff", "--unified=12", `${mergeBase}...HEAD`]),
    git(project, ["diff", "--cached", "--no-ext-diff", "--unified=12"]),
    git(project, ["diff", "--no-ext-diff", "--unified=12"]),
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

function executable(name) {
  if (process.platform === "win32") {
    const r = run("where.exe", [name], { timeout: 10_000 });
    return !r.error && r.status === 0 ? String(r.stdout || "").split(/\r?\n/).find(Boolean)?.trim() || null : null;
  }
  const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, "");
  const r = run("sh", ["-lc", `command -v ${safe}`], { timeout: 10_000 });
  return !r.error && r.status === 0 ? String(r.stdout || "").split(/\r?\n/).find(Boolean)?.trim() || null : null;
}
function jsonParse(text, fallback = null) { try { return JSON.parse(String(text || "").trim()); } catch { return fallback; } }
function scanner(name, status, extra = {}) { return { name, status, ...extra }; }
function storeScanner(project, runtimeDir, name, data) {
  const file = path.join(runtimeDir, `${name}.json`);
  writeJson(file, data);
  return posix(path.relative(project, file));
}
function scannerError(r) { return r.error?.message || (r.status !== 0 ? String(r.stderr || "").trim().slice(0, 1200) : null); }
function runScanners(project, runtimeDir, timeoutMs) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const out = [];

  const semgrep = executable("semgrep");
  if (!semgrep) out.push(scanner("semgrep", "SKIPPED", { reason: "semgrep not installed on PATH" }));
  else {
    const r = run(semgrep, ["scan", "--config", "auto", "--json", "--metrics=off", "."], { cwd: project, timeout: timeoutMs });
    const data = jsonParse(r.stdout, { stdout: r.stdout, stderr: r.stderr });
    const count = Array.isArray(data?.results) ? data.results.length : null;
    out.push(scanner("semgrep", !r.error && r.status === 0 ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, artifact: storeScanner(project, runtimeDir, "semgrep", data), note: scannerError(r) }));
  }

  const osv = executable("osv-scanner");
  if (!osv) out.push(scanner("osv-scanner", "SKIPPED", { reason: "osv-scanner not installed on PATH" }));
  else {
    const r = run(osv, ["scan", "source", "--recursive", "--format", "json", "."], { cwd: project, timeout: timeoutMs });
    const data = jsonParse(r.stdout, { stdout: r.stdout, stderr: r.stderr });
    let count = 0;
    for (const item of data?.results || []) for (const pkg of item?.packages || []) count += (pkg?.vulnerabilities || []).length;
    const recognized = !r.error && (r.status === 0 || r.status === 1);
    out.push(scanner("osv-scanner", recognized ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, artifact: storeScanner(project, runtimeDir, "osv-scanner", data), note: recognized ? null : scannerError(r) }));
  }

  const gitleaks = executable("gitleaks");
  if (!gitleaks) out.push(scanner("gitleaks", "SKIPPED", { reason: "gitleaks not installed on PATH" }));
  else {
    const raw = path.join(runtimeDir, `gitleaks-${process.pid}.json`);
    const r = run(gitleaks, ["dir", ".", "--report-format", "json", "--report-path", raw, "--redact", "--exit-code", "0", "--no-banner"], { cwd: project, timeout: timeoutMs });
    const data = fs.existsSync(raw) ? jsonParse(readText(raw), []) : [];
    try { fs.unlinkSync(raw); } catch {}
    const count = Array.isArray(data) ? data.length : null;
    out.push(scanner("gitleaks", !r.error && r.status === 0 ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, artifact: storeScanner(project, runtimeDir, "gitleaks", data || []), note: scannerError(r) }));
  }

  const trivy = executable("trivy");
  if (!trivy) out.push(scanner("trivy", "SKIPPED", { reason: "trivy not installed on PATH" }));
  else {
    const r = run(trivy, ["fs", "--format", "json", "--scanners", "vuln,misconfig,secret", "--exit-code", "0", "."], { cwd: project, timeout: timeoutMs });
    const data = jsonParse(r.stdout, { stdout: r.stdout, stderr: r.stderr });
    let count = 0;
    for (const item of data?.Results || []) count += (item?.Vulnerabilities || []).length + (item?.Misconfigurations || []).length + (item?.Secrets || []).length;
    out.push(scanner("trivy", !r.error && r.status === 0 ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, artifact: storeScanner(project, runtimeDir, "trivy", data), note: scannerError(r) }));
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
    out.push(scanner("npm-audit", recognized ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, artifact: storeScanner(project, runtimeDir, "npm-audit", data), note: recognized ? null : scannerError(r) }));
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
    out.push(scanner("pnpm-audit", recognized ? (count ? "FINDINGS" : "PASS") : "ERROR", { finding_count: count, exit_code: r.status, artifact: storeScanner(project, runtimeDir, "pnpm-audit", data), note: recognized ? null : scannerError(r) }));
  }
  return out;
}

function providerOverride(name) {
  return process.env[{ codex: "WEB_KIT_SECURITY_CODEX_BIN", claude: "WEB_KIT_SECURITY_CLAUDE_BIN", gemini: "WEB_KIT_SECURITY_GEMINI_BIN" }[name]] || null;
}
function resolveProviderExecutable(name) {
  const override = providerOverride(name);
  if (override) return path.resolve(override);
  const wanted = path.resolve(process.env.WEB_KIT_HOME || path.join(os.homedir(), ".web-kit"), "bin");
  const entries = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name, `${name}.bat`] : [name];
  for (const dir of entries) {
    let resolved;
    try { resolved = path.resolve(dir); } catch { continue; }
    if (resolved.toLowerCase() === wanted.toLowerCase()) continue;
    for (const candidateName of names) {
      const candidate = path.join(resolved, candidateName);
      try { if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate; } catch {}
    }
  }
  return null;
}
function chooseProvider(requested) {
  if (requested !== "auto") {
    const executable = resolveProviderExecutable(requested);
    if (!executable) throw new Error(`Security reviewer provider '${requested}' was not found outside the Web Kit shim directory.`);
    return { name: requested, executable };
  }
  for (const name of ["codex", "claude", "gemini"]) {
    const executable = resolveProviderExecutable(name);
    if (executable) return { name, executable };
  }
  throw new Error("No supported headless AI reviewer found. Install/authenticate Codex, Claude, or Gemini CLI, or use --scan-only.");
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
  if (!text) return null;
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const direct = jsonParse(cleaned, null);
  if (direct && typeof direct === "object") return direct;
  const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}");
  return start >= 0 && end > start ? jsonParse(cleaned.slice(start, end + 1), null) : null;
}
function reviewerPrompt(contextRel, previousRel) {
  return `Act as the independent Web Kit Security PR Reviewer.\n\nREAD-ONLY REVIEW: do not modify files, fix findings, commit, or alter repository state.\n\nRead first:\n- .agent-core/agents/security-reviewer.md\n- .agent-core/rules/security-review.md\n- ${contextRel}\n${previousRel ? `- ${previousRel} (previous review; verify every previous finding and never silently drop one)` : ""}\n\nThe generated .agent-core/security-reviews directory is review state/evidence, not product code; do not treat its own generated files as branch changes.\n\nReview the current branch against the exact base/merge-base recorded in the context. Inspect the actual branch diff and every surrounding source/configuration/dependency needed to validate trust boundaries and exploitability.\n\nRequirements:\n1. Cover every REVIEW_REQUIRED attack surface and expand to any additional related surface discovered while tracing affected code.\n2. Check all relevant classes, not merely OWASP Top 10: auth/authz, IDOR/BOLA/BFLA, tenant isolation, sessions/JWT/OAuth, injection, XSS, CSRF/CORS, SSRF, uploads/filesystem, secrets, crypto, dependencies/supply chain, containers/IaC/cloud, CI/CD, privacy/logging, abuse/DoS, realtime, business logic, concurrency/idempotency, deserialization/XXE/prototype pollution, cache isolation, and framework/language-specific risks when relevant.\n3. Follow changed code into middleware, authorization, validation, data access, configuration and callers/callees when those control security.\n4. Read scanner artifacts listed in the context when present. Missing/failed scanners are limitations, never proof of safety. Verify high-impact scanner findings in source when possible.\n5. Use OWASP Web/API and CWE where appropriate. Include CVE/GHSA/OSV identifiers only when actual advisory/scanner evidence supports them. Never invent an advisory.\n6. Prefer evidence-backed, realistically exploitable findings over generic best-practice noise.\n7. Return ALL findings in this one review.\n8. On re-review, re-check every previous SEC finding. Re-emit it with the same stable fingerprint if still present. If absent, the engine marks it RESOLVED.\n9. Do not calculate the /5 rating or merge decision; Web Kit owns those deterministically.\n\nReturn ONLY this JSON shape, no markdown fences:\n{\n  \"summary\": \"short assessment\",\n  \"limitations\": [\"coverage limitation\"],\n  \"coverage\": [{\"area\":\"area\",\"status\":\"REVIEWED|NOT_APPLICABLE|LIMITED\",\"notes\":\"what was checked\"}],\n  \"findings\": [{\n    \"fingerprint\": \"stable-lowercase-id\",\n    \"title\": \"specific vulnerability\",\n    \"severity\": \"CRITICAL|HIGH|MEDIUM|LOW|INFO\",\n    \"confidence\": \"HIGH|MEDIUM|LOW\",\n    \"category\": \"category\",\n    \"file\": \"relative/path\",\n    \"line\": 123,\n    \"owasp\": [\"supported mapping\"],\n    \"cwe\": [\"CWE-...\"],\n    \"advisories\": [\"only verified CVE/GHSA/OSV ids\"],\n    \"evidence\": \"specific evidence without secret values\",\n    \"attack_scenario\": \"realistic abuse path\",\n    \"impact\": \"impact\",\n    \"recommendation\": \"specific fix\",\n    \"validation\": \"specific regression test/verification\"\n  }]\n}`;
}
function invokeProvider(provider, project, prompt, timeoutMs) {
  const env = {
    ...process.env,
    WEB_KIT_SECURITY_REVIEW_ACTIVE: "1",
    WEB_KIT_SECURITY_PROJECT_ROOT: project,
    WEB_KIT_CONTEXT_SUPERVISOR_BYPASS: "1",
  };
  let args;
  if (provider.name === "codex") args = ["exec", "--json", "--sandbox", "read-only", "-C", project, prompt];
  else if (provider.name === "claude") args = ["-p", prompt, "--output-format", "json", "--permission-mode", "plan"];
  else args = ["-p", prompt, "--output-format", "json", "--approval-mode", "plan"];
  const spec = launchSpec(provider.executable, args);
  const r = run(spec.command, spec.args, { cwd: project, env, timeout: timeoutMs, shell: spec.shell });
  if (r.error || r.status !== 0) throw new Error(`${provider.name} security reviewer failed: ${r.error?.message || String(r.stderr || "").slice(0, 2000) || `exit ${r.status}`}`);

  let text = "";
  if (provider.name === "codex") {
    for (const line of String(r.stdout || "").split(/\r?\n/)) {
      const event = jsonParse(line, null);
      if (!event) continue;
      if (event.type === "item.completed" && event.item && ["agent_message", "assistant_message", "message"].includes(event.item.type) && typeof event.item.text === "string") text = event.item.text;
      if (event.type === "message" && event.role === "assistant" && typeof event.content === "string") text = event.content;
    }
  } else {
    const outer = jsonParse(r.stdout, null);
    text = provider.name === "claude" ? (outer?.result || outer?.response || String(r.stdout || "")) : (outer?.response || outer?.result || String(r.stdout || ""));
  }
  const parsed = parseJsonObject(text);
  if (!parsed || !Array.isArray(parsed.findings) || !Array.isArray(parsed.coverage)) throw new Error(`${provider.name} returned invalid security-review JSON; findings[] and coverage[] are required.`);
  return parsed;
}

function severity(value) { const v = String(value || "MEDIUM").toUpperCase(); return SEVERITIES.includes(v) ? v : "MEDIUM"; }
function confidence(value) { const v = String(value || "MEDIUM").toUpperCase(); return CONFIDENCES.includes(v) ? v : "MEDIUM"; }
function fingerprint(finding) {
  const explicit = String(finding.fingerprint || "").trim().toLowerCase();
  if (explicit) return explicit.replace(/[^a-z0-9._:/-]+/g, "-").slice(0, 180);
  return hash([finding.category, finding.file, finding.title].map((x) => String(x || "").toLowerCase()).join("|")).slice(0, 24);
}
function normalizeFinding(f) {
  return {
    fingerprint: fingerprint(f),
    title: String(f.title || "Security finding").trim(),
    severity: severity(f.severity),
    confidence: confidence(f.confidence),
    category: String(f.category || "General Security").trim(),
    file: f.file ? posix(f.file) : null,
    line: Number.isInteger(Number(f.line)) && Number(f.line) > 0 ? Number(f.line) : null,
    owasp: Array.isArray(f.owasp) ? f.owasp.map(String).slice(0, 20) : [],
    cwe: Array.isArray(f.cwe) ? f.cwe.map(String).filter((x) => /^CWE-\d+$/i.test(x)).slice(0, 20) : [],
    advisories: Array.isArray(f.advisories) ? f.advisories.map(String).filter((x) => /^(CVE-|GHSA-|OSV-|GO-|RUSTSEC-|PYSEC-)/i.test(x)).slice(0, 20) : [],
    evidence: String(f.evidence || "").trim(),
    attack_scenario: String(f.attack_scenario || "").trim(),
    impact: String(f.impact || "").trim(),
    recommendation: String(f.recommendation || "").trim(),
    validation: String(f.validation || "").trim(),
  };
}
function idAllocator(previous) {
  let max = 0;
  for (const f of previous?.findings || []) { const m = String(f.id || "").match(/^SEC-(\d+)$/); if (m) max = Math.max(max, Number(m[1])); }
  return () => `SEC-${String(++max).padStart(3, "0")}`;
}
function blocking(f) { return ACTIVE.has(f.status) && f.confidence !== "LOW" && ["CRITICAL", "HIGH", "MEDIUM"].includes(f.severity); }
function reconcile(raw, previous, number) {
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
    if (old.status === "RESOLVED") result.push({ ...old, blocking: false });
    else result.push({ ...old, status: "RESOLVED", blocking: false, resolved_review: number });
  }
  const order = Object.fromEntries(SEVERITIES.map((name, index) => [name, index]));
  return result.sort((a, b) => (a.blocking !== b.blocking ? (a.blocking ? -1 : 1) : order[a.severity] - order[b.severity] || String(a.id).localeCompare(String(b.id))));
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
function normalizeCoverage(model, surfaces, scanners, scanOnly) {
  if (scanOnly) return surfaces.map((x) => ({ area: x.name, status: "LIMITED", notes: "AI source review skipped by --scan-only." }));
  const coverage = Array.isArray(model?.coverage) ? model.coverage.map((x) => ({
    area: String(x.area || "Unknown"),
    status: ["REVIEWED", "NOT_APPLICABLE", "LIMITED"].includes(String(x.status || "").toUpperCase()) ? String(x.status).toUpperCase() : "LIMITED",
    notes: String(x.notes || "").trim(),
  })).slice(0, 120) : [];
  const missingRequired = surfaces.filter((s) => !coverage.some((c) => c.area.toLowerCase() === s.name.toLowerCase()));
  for (const surface of missingRequired) coverage.push({ area: surface.name, status: "LIMITED", notes: "Mapped as REVIEW_REQUIRED but reviewer did not explicitly report coverage." });
  for (const s of scanners.filter((x) => ["SKIPPED", "ERROR"].includes(x.status))) coverage.push({ area: `Scanner: ${s.name}`, status: "LIMITED", notes: s.reason || s.note || s.status });
  return coverage;
}
function markdown(review) {
  const lines = [
    "# Web Kit Security PR Review", "",
    `- **Branch:** \`${review.branch}\``,
    `- **Base:** \`${review.base}\``,
    `- **Review:** ${review.review_number} (${review.mode})`,
    `- **Security Rating:** **${review.rating.toFixed(1)} / 5**`,
    `- **Decision:** **${review.decision}**`,
    `- **Reviewer Provider:** ${review.provider || "scan-only"}`, "",
    "## Active findings", "",
  ];
  const active = review.findings.filter((f) => ACTIVE.has(f.status));
  if (!active.length) lines.push("No active findings.", "");
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
  if (review.limitations.length) { lines.push("", "## Limitations", ""); for (const item of review.limitations) lines.push(`- ${item}`); }
  lines.push("", "> A 5/5 review means no blocking issue was found in the reviewed scope and available evidence. It is not a guarantee that the software is vulnerability-free.");
  return `${lines.join("\n")}\n`;
}
function printReview(review, latestMd) {
  console.log("\n╔════════════════════════════════════════╗\n║       WEB KIT SECURITY PR REVIEW      ║\n╚════════════════════════════════════════╝\n");
  console.log(`Branch:          ${review.branch}\nBase:            ${review.base}\nReview:          #${review.review_number} (${review.mode})\nSecurity Rating: ${review.rating.toFixed(1)} / 5\nDecision:        ${review.decision}\nProvider:        ${review.provider || "scan-only"}\n`);
  const c = review.counts;
  console.log(`Critical: ${c.CRITICAL}  High: ${c.HIGH}  Medium: ${c.MEDIUM}  Low: ${c.LOW}  Info: ${c.INFO}\n`);
  const active = review.findings.filter((f) => ACTIVE.has(f.status));
  if (!active.length) console.log("✓ No active security findings.");
  for (const f of active) { console.log(`${f.blocking ? "✗" : "•"} ${f.id}  ${f.severity}  ${f.status}  ${f.title}`); if (f.file) console.log(`  ${f.file}${f.line ? `:${f.line}` : ""}`); }
  for (const f of review.findings.filter((f) => f.status === "RESOLVED" && f.resolved_review === review.review_number)) console.log(`✓ ${f.id}  RESOLVED  ${f.title}`);
  console.log(`\nFull review: ${latestMd}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return 0; }
  const project = path.resolve(args.project);
  if (!fs.existsSync(project)) throw new Error(`Project does not exist: ${project}`);
  if (git(project, ["rev-parse", "--is-inside-work-tree"]) !== "true") throw new Error("security-review requires a Git repository.");

  const branch = git(project, ["branch", "--show-current"]) || `detached-${git(project, ["rev-parse", "--short", "HEAD"]) || "head"}`;
  const base = detectBase(project, branch, args.base);
  const mergeBase = git(project, ["merge-base", base, "HEAD"]);
  if (!mergeBase) throw new Error(`Could not determine merge-base between ${base} and HEAD.`);
  const head = git(project, ["rev-parse", "HEAD"]);
  const files = changedFiles(project, mergeBase);
  const diff = diffText(project, mergeBase);
  const surfaces = attackSurface(files, diff, args.deep);

  const reviewRoot = path.join(project, ".agent-core", "security-reviews", slug(branch));
  const historyDir = path.join(reviewRoot, "history");
  const runtimeDir = path.join(reviewRoot, "runtime");
  const latestJson = path.join(reviewRoot, "latest.json");
  const latestMd = path.join(reviewRoot, "latest.md");
  const previous = readJson(latestJson, null);
  const reviewNumber = Number(previous?.review_number || 0) + 1;
  fs.mkdirSync(historyDir, { recursive: true }); fs.mkdirSync(runtimeDir, { recursive: true });

  const scanners = args.noScanners ? [scanner("external-scanners", "SKIPPED", { reason: "--no-scanners requested" })] : runScanners(project, runtimeDir, args.timeoutMs);
  const context = {
    schema_version: 1,
    review_number: reviewNumber,
    mode: previous ? "rereview" : "initial",
    project,
    branch,
    base,
    merge_base: mergeBase,
    head,
    changed_files: files,
    working_tree_status: workingTreeStatus(project),
    attack_surfaces: surfaces,
    deep_review: args.deep,
    scanners,
    standards: ["OWASP Web Top 10", "OWASP API Security Top 10", "CWE including CWE Top 25 where relevant", "CVE/GHSA/OSV only with real advisory evidence", "framework/language-specific security", "business-logic and abuse-case analysis"],
    generated_state_excluded_from_branch_scope: REVIEW_STATE_PREFIX,
    created_at: nowIso(),
  };
  const contextFile = path.join(runtimeDir, `review-context-${String(reviewNumber).padStart(3, "0")}.json`);
  writeJson(contextFile, context);
  const contextRel = posix(path.relative(project, contextFile));
  const previousRel = previous ? posix(path.relative(project, latestJson)) : null;

  let provider = null;
  let model = { summary: "Scanner-only branch security analysis.", limitations: ["AI source/security reasoning was skipped by --scan-only."], coverage: [], findings: [] };
  if (!args.scanOnly) {
    provider = chooseProvider(args.provider);
    model = invokeProvider(provider, project, reviewerPrompt(contextRel, previousRel), args.timeoutMs);
  } else {
    for (const s of scanners) if (s.status === "FINDINGS") model.limitations.push(`${s.name} reported findings; run a full security-review to correlate them into SEC-* findings.`);
  }

  const findings = reconcile(model.findings, previous, reviewNumber);
  const rating = score(findings);
  const decision = findings.some((f) => f.blocking) ? "REQUEST_CHANGES" : "APPROVE";
  const limitations = Array.isArray(model.limitations) ? model.limitations.map(String).slice(0, 120) : [];
  for (const s of scanners) {
    if (s.status === "SKIPPED") limitations.push(`${s.name}: ${s.reason || "scanner unavailable"}`);
    if (s.status === "ERROR") limitations.push(`${s.name}: scanner error; ${s.note || `exit ${s.exit_code}`}`);
  }
  if (args.scanOnly && scanners.some((s) => s.status === "FINDINGS")) limitations.push("Scanner-only mode does not grant security approval; scanner findings require correlation in a full review.");

  const review = {
    schema_version: 1,
    review_number: reviewNumber,
    mode: previous ? "rereview" : "initial",
    branch, base, merge_base: mergeBase, head,
    changed_files: files,
    attack_surfaces: surfaces,
    provider: provider?.name || null,
    scanners,
    summary: String(model.summary || "").trim(),
    limitations: unique(limitations),
    coverage: normalizeCoverage(model, surfaces, scanners, args.scanOnly),
    findings,
    counts: counts(findings),
    rating,
    decision,
    blocking_findings: findings.filter((f) => f.blocking).map((f) => f.id),
    created_at: nowIso(),
    disclaimer: "This review is evidence-based risk assessment, not a guarantee that every vulnerability has been found.",
  };

  const historyJson = path.join(historyDir, `review-${String(reviewNumber).padStart(3, "0")}.json`);
  const historyMd = path.join(historyDir, `review-${String(reviewNumber).padStart(3, "0")}.md`);
  writeJson(historyJson, review); writeText(historyMd, markdown(review));
  writeJson(latestJson, review); writeText(latestMd, markdown(review));

  if (args.json) console.log(JSON.stringify(review, null, 2)); else printReview(review, posix(path.relative(project, latestMd)));
  if (args.failOnBlocking && decision === "REQUEST_CHANGES") return 4;
  return 0;
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(`[Web Kit] Security Review error: ${error.message}`);
  process.exitCode = 1;
});
