#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const fixture = path.join(repo, "tests", "fixtures", "mock-security-provider.mjs");

function run(command, args, options = {}) {
  const shell = options.shell ?? (process.platform === "win32" && /\.(cmd|bat)$/i.test(command));
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 60_000, ...options, shell });
  if (result.error || result.status !== 0) {
    console.error(result.stdout || "");
    console.error(result.stderr || "");
    throw result.error || new Error(`${command} exited ${result.status}`);
  }
  return result;
}
function assert(value, message) { if (!value) throw new Error(message); }
function json(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function git(project, args) { return run("git", args, { cwd: project }); }
function sha(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function fileSha(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function slug(value) { return String(value || "detached").replace(/\\/g, "/").replace(/^\.\//, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "detached"; }
function storageKey(branch) { return `${slug(branch).slice(0, 96)}--${sha(`branch:${branch}`).slice(0, 10)}`; }
function reviewRoot(project, branch) { return path.join(project, ".agent-core", "security-reviews", storageKey(branch)); }

function providerExecutable(name, tempRoot) {
  if (process.platform !== "win32") return fixture;
  const wrapper = path.join(tempRoot, `${name}.cmd`);
  const node = process.execPath.replace(/"/g, '""');
  const script = fixture.replace(/"/g, '""');
  fs.writeFileSync(wrapper, `@echo off\r\n"${node}" "${script}" %*\r\n`, "utf8");
  return wrapper;
}

function scannerFixture(tempRoot) {
  const bin = path.join(tempRoot, "scanner-bin");
  fs.mkdirSync(bin, { recursive: true });
  const script = path.join(bin, "semgrep-fixture.mjs");
  fs.writeFileSync(script, `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const mode = process.env.WEB_KIT_TEST_SEMGREP_MODE || "pass";
const state = path.join(process.cwd(), ".agent-core", "security-reviews");
let results = [];
if (mode === "findings") results = [{ check_id: "fixture.security.finding", path: "src/admin.js", start: { line: 1 } }];
if (mode === "self-noise" && fs.existsSync(state)) results = [{ check_id: "fixture.review-state-noise", path: ".agent-core/security-reviews/generated.json", start: { line: 1 } }];
process.stdout.write(JSON.stringify({ results }));
`, "utf8");

  if (process.platform === "win32") {
    const wrapper = path.join(bin, "semgrep.cmd");
    const node = process.execPath.replace(/"/g, '""');
    const target = script.replace(/"/g, '""');
    fs.writeFileSync(wrapper, `@echo off\r\n"${node}" "${target}" %*\r\n`, "utf8");
  } else {
    const wrapper = path.join(bin, "semgrep");
    fs.writeFileSync(wrapper, `#!/usr/bin/env sh\nexec "${process.execPath.replace(/"/g, '\\"')}" "${script.replace(/"/g, '\\"')}" "$@"\n`, "utf8");
    fs.chmodSync(wrapper, 0o755);
  }
  return bin;
}

const help = run(process.execPath, [path.join(repo, "bin", "web-kit-entry.js"), "security-review", "--help"], { cwd: repo });
assert(help.stdout.includes("npx @ihgen/web-kit security-review"), "npm security-review command missing from entrypoint help");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-security-review-root-"));
const project = path.join(tempRoot, "project");
fs.mkdirSync(path.join(project, "src"), { recursive: true });
fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "security-review-smoke", version: "1.0.0" }, null, 2));
fs.writeFileSync(path.join(project, "src", "admin.js"), "export function canDelete(req) { return req.user.role === \"admin\"; }\n");

let init = spawnSync("git", ["init", "-b", "main"], { cwd: project, encoding: "utf8", windowsHide: true });
if (init.error || init.status !== 0) {
  run("git", ["init"], { cwd: project });
  run("git", ["checkout", "-b", "main"], { cwd: project });
}
git(project, ["config", "user.email", "security-smoke@example.invalid"]);
git(project, ["config", "user.name", "Web Kit Security Smoke"]);

run(process.execPath, [path.join(repo, "scripts", "agent-kit.mjs"), "install", project], { cwd: repo });
assert(fs.existsSync(path.join(project, ".agent-core", "bin", "security-review.mjs")), "security review engine was not installed");
assert(fs.existsSync(path.join(project, ".agent-core", "rules", "security-review.md")), "security review rule was not installed");
for (const file of [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  path.join(".github", "copilot-instructions.md"),
  path.join(".cursor", "rules", "ihgen-web-kit.mdc"),
]) {
  const text = fs.readFileSync(path.join(project, file), "utf8");
  assert(text.includes("run security-review"), `${file}: provider-neutral security trigger missing`);
}

git(project, ["add", "."]);
git(project, ["commit", "-m", "baseline"]);
git(project, ["checkout", "-b", "ts-admin-security"]);
fs.writeFileSync(path.join(project, "src", "admin.js"), "export function canDelete(req) { return req.body.role === \"admin\"; }\n");
git(project, ["add", "src/admin.js"]);
git(project, ["commit", "-m", "add admin delete authorization"]);

const engine = path.join(project, ".agent-core", "bin", "security-review.mjs");
const baseEnv = {
  ...process.env,
  WEB_KIT_SECURITY_CODEX_BIN: providerExecutable("codex", tempRoot),
  WEB_KIT_SECURITY_CLAUDE_BIN: providerExecutable("claude", tempRoot),
  WEB_KIT_SECURITY_GEMINI_BIN: providerExecutable("gemini", tempRoot),
};

run(process.execPath, [engine, "--project", project, "--base", "main", "--provider", "codex", "--no-scanners"], { cwd: project, env: baseEnv });
const root = reviewRoot(project, "ts-admin-security");
const first = json(path.join(root, "latest.json"));
assert(first.review_number === 1 && first.mode === "initial", "initial security review number/mode mismatch");
assert(first.branch_storage_key === storageKey("ts-admin-security"), "collision-safe branch storage key mismatch");
assert(first.provider === "codex", "Codex security backend was not recorded");
assert(first.decision === "REQUEST_CHANGES", "HIGH authorization finding should request changes");
assert(first.rating > 0 && first.rating <= 2.9, `expected high-risk score <=2.9, got ${first.rating}`);
assert(first.findings.length === 1, "expected exactly one initial security finding");
assert(first.findings[0].id === "SEC-001", "first persistent finding id should be SEC-001");
assert(first.findings[0].status === "OPEN" && first.findings[0].blocking === true, "initial SEC-001 lifecycle/blocking state mismatch");
assert(first.attack_surfaces.some((area) => area.id === "authorization"), "authorization attack surface was not mapped");
assert(!first.changed_files.some((file) => file.startsWith(".agent-core/security-reviews/")), "generated review state polluted initial changed-file scope");
assert(fs.existsSync(path.join(root, "history", "review-001.json")), "initial review history JSON missing");
assert(fs.existsSync(path.join(root, "history", "review-001.md")), "initial review history Markdown missing");

fs.writeFileSync(path.join(project, "src", "admin.js"), "export function canDelete(req) { return req.user.role === \"admin\"; }\n");
git(project, ["add", "src/admin.js"]);
git(project, ["commit", "-m", "enforce server-side admin role"]);

run(process.execPath, [engine, "--project", project, "--base", "main", "--provider", "codex", "--no-scanners"], { cwd: project, env: baseEnv });
const second = json(path.join(root, "latest.json"));
assert(second.review_number === 2 && second.mode === "rereview", "security re-review number/mode mismatch");
assert(second.decision === "APPROVE", "resolved review should approve");
assert(second.rating === 5, `resolved review should rate 5/5, got ${second.rating}`);
const resolved = second.findings.find((finding) => finding.id === "SEC-001");
assert(resolved?.status === "RESOLVED", "SEC-001 was not preserved as RESOLVED");
assert(resolved.blocking === false, "resolved finding remained blocking");
assert(!second.changed_files.some((file) => file.startsWith(".agent-core/security-reviews/")), "generated review state polluted re-review changed-file scope");
assert(fs.existsSync(path.join(root, "history", "review-002.json")), "second review history JSON missing");
assert(fs.readFileSync(path.join(root, "latest.md"), "utf8").includes("5.0 / 5"), "Markdown report missing /5 rating");

run(process.execPath, [engine, "--project", project, "--base", "main", "--provider", "claude", "--no-scanners"], { cwd: project, env: baseEnv });
const third = json(path.join(root, "latest.json"));
assert(third.provider === "claude" && third.decision === "APPROVE", "Claude provider adapter smoke failed");

run(process.execPath, [engine, "--project", project, "--base", "main", "--provider", "gemini", "--no-scanners"], { cwd: project, env: baseEnv });
const fourth = json(path.join(root, "latest.json"));
assert(fourth.provider === "gemini" && fourth.decision === "APPROVE", "Gemini provider adapter smoke failed");
assert(fourth.findings.find((finding) => finding.id === "SEC-001")?.status === "RESOLVED", "resolved finding identity was lost across providers");

// Regression: scan-only can never issue APPROVE/5.0, especially when a scanner reports findings.
const fakeScannerBin = scannerFixture(tempRoot);
const scanEnv = {
  ...baseEnv,
  PATH: `${fakeScannerBin}${path.delimiter}${process.env.PATH || ""}`,
  WEB_KIT_TEST_SEMGREP_MODE: "findings",
};
run(process.execPath, [engine, "--project", project, "--base", "main", "--scan-only"], { cwd: project, env: scanEnv });
const scanOnly = json(path.join(root, "latest.json"));
assert(scanOnly.scan_only === true, "scan-only flag was not persisted");
assert(scanOnly.decision === "INCONCLUSIVE", `scan-only must be INCONCLUSIVE, got ${scanOnly.decision}`);
assert(scanOnly.approval_eligible === false, "scan-only was incorrectly approval eligible");
assert(scanOnly.rating === null && scanOnly.rating_status === "NOT_SCORED_SCAN_ONLY", "scan-only must not receive a misleading /5 rating");
const firstSemgrep = scanOnly.scanners.find((s) => s.name === "semgrep");
assert(firstSemgrep?.status === "FINDINGS", "fake Semgrep finding was not captured");
assert(scanOnly.scanner_finding_count >= 1, "scan-only scanner finding count was not surfaced");
assert(scanOnly.finding_lifecycle_verified === false, "scan-only incorrectly claimed SEC lifecycle verification");
const firstReviewDir = `review-${String(scanOnly.review_number).padStart(3, "0")}`;
assert(firstSemgrep?.artifact?.includes(`/runtime/${firstReviewDir}/semgrep.json`), "scanner artifact is not review-specific");
assert(firstSemgrep?.artifact_review === scanOnly.review_number, "scanner artifact review provenance is missing");
const firstArtifact = path.resolve(project, ...firstSemgrep.artifact.split("/"));
assert(fs.existsSync(firstArtifact), "review-specific Semgrep artifact was not persisted");
const firstArtifactHash = fileSha(firstArtifact);
assert(firstSemgrep.artifact_sha256 === firstArtifactHash, "scanner artifact SHA-256 does not match persisted evidence");
assert(firstSemgrep.artifact_size === fs.statSync(firstArtifact).size, "scanner artifact size metadata does not match persisted evidence");
const firstHistoryPath = path.join(root, "history", `review-${String(scanOnly.review_number).padStart(3, "0")}.json`);
const firstHistoryBefore = json(firstHistoryPath);
assert(firstHistoryBefore.scanners.find((s) => s.name === "semgrep")?.artifact === firstSemgrep.artifact, "immutable history does not reference its own scanner artifact");

// Regression: existing generated review state is hidden from external scanner roots and restored afterward.
const selfNoiseEnv = { ...scanEnv, WEB_KIT_TEST_SEMGREP_MODE: "self-noise" };
assert(fs.existsSync(path.join(project, ".agent-core", "security-reviews")), "expected review state before scanner isolation test");
run(process.execPath, [engine, "--project", project, "--base", "main", "--scan-only"], { cwd: project, env: selfNoiseEnv });
const isolated = json(path.join(root, "latest.json"));
const secondSemgrep = isolated.scanners.find((s) => s.name === "semgrep");
assert(secondSemgrep?.status === "PASS", "generated review state was visible to Semgrep and created self-noise");
assert(fs.existsSync(path.join(project, ".agent-core", "security-reviews")), "review state was not restored after scanner isolation");
assert(isolated.decision === "INCONCLUSIVE" && isolated.rating === null, "scanner-isolation scan-only run became merge-approvable");
assert(secondSemgrep?.artifact !== firstSemgrep.artifact, "later review reused the prior scanner artifact path");
assert(secondSemgrep?.artifact_review === isolated.review_number, "later scanner artifact has wrong review provenance");
assert(fs.existsSync(firstArtifact), "review #1 scanner artifact disappeared after review #2");
assert(fileSha(firstArtifact) === firstArtifactHash, "review #1 scanner artifact bytes changed after review #2");
const firstHistoryAfter = json(firstHistoryPath);
const historicalSemgrep = firstHistoryAfter.scanners.find((s) => s.name === "semgrep");
assert(historicalSemgrep?.artifact === firstSemgrep.artifact, "review #1 history artifact path changed after review #2");
assert(historicalSemgrep?.artifact_sha256 === firstArtifactHash, "review #1 history artifact hash changed after review #2");
assert(fileSha(path.resolve(project, ...historicalSemgrep.artifact.split("/"))) === firstArtifactHash, "review #1 history no longer resolves to its original scanner evidence");

// Regression: valid branch names that sanitize to the same slug must never share review history.
git(project, ["checkout", "main"]);
git(project, ["checkout", "-b", "feature/auth"]);
fs.writeFileSync(path.join(project, "src", "collision-a.js"), "export const collisionA = true;\n");
git(project, ["add", "src/collision-a.js"]);
git(project, ["commit", "-m", "collision branch slash"]);
run(process.execPath, [engine, "--project", project, "--base", "main", "--provider", "codex", "--no-scanners"], { cwd: project, env: baseEnv });
const slashRoot = reviewRoot(project, "feature/auth");
const slashReview = json(path.join(slashRoot, "latest.json"));
assert(slashReview.branch === "feature/auth" && slashReview.review_number === 1, "feature/auth review history was not isolated");

git(project, ["checkout", "main"]);
git(project, ["checkout", "-b", "feature-auth"]);
fs.writeFileSync(path.join(project, "src", "collision-b.js"), "export const collisionB = true;\n");
git(project, ["add", "src/collision-b.js"]);
git(project, ["commit", "-m", "collision branch hyphen"]);
run(process.execPath, [engine, "--project", project, "--base", "main", "--provider", "codex", "--no-scanners"], { cwd: project, env: baseEnv });
const hyphenRoot = reviewRoot(project, "feature-auth");
const hyphenReview = json(path.join(hyphenRoot, "latest.json"));
assert(path.resolve(slashRoot) !== path.resolve(hyphenRoot), "feature/auth and feature-auth collided on one review directory");
assert(storageKey("feature/auth") !== storageKey("feature-auth"), "collision-safe branch keys unexpectedly match");
assert(hyphenReview.branch === "feature-auth" && hyphenReview.review_number === 1, "feature-auth inherited unrelated review history");
assert(slashReview.branch_storage_key !== hyphenReview.branch_storage_key, "branch storage keys did not preserve exact branch identity");
assert(fs.existsSync(path.join(slashRoot, "history", "review-001.json")), "feature/auth history disappeared after reviewing feature-auth");
assert(fs.existsSync(path.join(hyphenRoot, "history", "review-001.json")), "feature-auth history was not written separately");

// Regression: scan-only evidence must not resolve or otherwise mutate a previously active SEC finding.
git(project, ["checkout", "main"]);
git(project, ["checkout", "-b", "scan-only-active"]);
fs.writeFileSync(path.join(project, "src", "admin.js"), "export function canDelete(req) { return req.body.role === \"admin\"; }\n");
git(project, ["add", "src/admin.js"]);
git(project, ["commit", "-m", "introduce active finding for scan-only lifecycle"]);
run(process.execPath, [engine, "--project", project, "--base", "main", "--provider", "codex", "--no-scanners"], { cwd: project, env: baseEnv });
const activeRoot = reviewRoot(project, "scan-only-active");
const activeBeforeScan = json(path.join(activeRoot, "latest.json"));
const activeFindingBefore = activeBeforeScan.findings.find((finding) => finding.id === "SEC-001");
assert(activeFindingBefore?.status === "OPEN" && activeFindingBefore.blocking === true, "active scan-only fixture did not start with OPEN SEC-001");
assert(activeBeforeScan.decision === "REQUEST_CHANGES", "active scan-only fixture should request changes before scan-only");

run(process.execPath, [engine, "--project", project, "--base", "main", "--scan-only"], { cwd: project, env: scanEnv });
const activeAfterScan = json(path.join(activeRoot, "latest.json"));
const activeFindingAfter = activeAfterScan.findings.find((finding) => finding.id === "SEC-001");
assert(activeAfterScan.decision === "INCONCLUSIVE" && activeAfterScan.rating === null, "scan-only with an active finding became merge-approvable");
assert(activeAfterScan.finding_lifecycle_verified === false, "scan-only with prior finding incorrectly claimed lifecycle verification");
assert(activeFindingAfter?.status === "OPEN", `scan-only incorrectly changed prior SEC-001 status to ${activeFindingAfter?.status}`);
assert(activeFindingAfter.blocking === true, "scan-only incorrectly removed blocking state from prior SEC-001");
assert(activeFindingAfter.last_seen_review === activeFindingBefore.last_seen_review, "scan-only incorrectly advanced last_seen_review without AI/source verification");
assert(activeFindingAfter.resolved_review === activeFindingBefore.resolved_review, "scan-only incorrectly resolved a prior SEC finding");

console.log(`Security Review smoke: PASS (${process.platform})`);
