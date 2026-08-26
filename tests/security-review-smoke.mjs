#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

function providerExecutable(name, tempRoot) {
  if (process.platform !== "win32") return fixture;
  const wrapper = path.join(tempRoot, `${name}.cmd`);
  const node = process.execPath.replace(/"/g, '""');
  const script = fixture.replace(/"/g, '""');
  fs.writeFileSync(wrapper, `@echo off\r\n"${node}" "${script}" %*\r\n`, "utf8");
  return wrapper;
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
const root = path.join(project, ".agent-core", "security-reviews", "ts-admin-security");
const first = json(path.join(root, "latest.json"));
assert(first.review_number === 1 && first.mode === "initial", "initial security review number/mode mismatch");
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

console.log(`Security Review smoke: PASS (${process.platform})`);
