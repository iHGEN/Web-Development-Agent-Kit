#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const fixture = path.join(repo, "tests", "fixtures", "mock-transparent-provider.mjs");
if (process.platform !== "win32") fs.chmodSync(fixture, 0o755);

function run(command, args, options = {}) {
  const shell = options.shell ?? (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command));
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 45_000, ...options, shell });
  if (result.error || result.status !== 0) {
    console.error(result.stdout || "");
    console.error(result.stderr || "");
    throw result.error || new Error(`${command} exited ${result.status}`);
  }
  return result;
}
function assert(value, message) { if (!value) throw new Error(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function calls(project, provider) {
  const file = path.join(project, ".agent-core", "state", "transparent-test", `${provider}-calls.jsonl`);
  return fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-transparent-home-"));
const webKitHome = path.join(tempHome, ".web-kit");
const commonEnv = {
  ...process.env,
  WEB_KIT_USER_HOME: tempHome,
  WEB_KIT_HOME: webKitHome,
  WEB_KIT_DISABLE_SHELL_PROFILE: "0"
};

function realProvider(provider) {
  if (process.platform !== "win32") return fixture;
  const wrapper = path.join(tempHome, `${provider}-real.cmd`);
  const node = process.execPath.replace(/"/g, '""');
  const script = fixture.replace(/"/g, '""');
  fs.writeFileSync(wrapper, `@echo off\r\n"${node}" "${script}" %*\r\n`, "utf8");
  return wrapper;
}
function shimPath(provider) {
  return path.join(webKitHome, "bin", process.platform === "win32" ? `${provider}.cmd` : provider);
}

const project = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-transparent-project-"));
fs.mkdirSync(path.join(project, "src"), { recursive: true });
fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "transparent-supervisor-smoke" }, null, 2));
fs.writeFileSync(path.join(project, "src", "index.js"), "export const value = 1;\n");
run(process.execPath, [path.join(repo, "scripts", "agent-kit.mjs"), "install", project], { cwd: repo, env: commonEnv });

const setup = path.join(project, ".agent-core", "bin", "supervisor-setup.mjs");
assert(fs.existsSync(setup), "installed supervisor setup is missing");
const firstSetup = run(process.execPath, [setup, "install", "1.1.10"], { cwd: project, env: commonEnv });
const firstStatus = JSON.parse(firstSetup.stdout);
assert(firstStatus.enabled === true, "transparent supervisor was not enabled");
assert(firstStatus.threshold_percent === 50, "default transparent threshold is not 50");
assert(fs.existsSync(path.join(webKitHome, "context-supervisor.mjs")), "user supervisor missing");
assert(fs.existsSync(path.join(webKitHome, "provider-bridge.mjs")), "user provider bridge missing");
assert(fs.existsSync(shimPath("codex")), "codex shim missing");
assert(fs.existsSync(shimPath("claude")), "claude shim missing");

const bashrc = path.join(tempHome, ".bashrc");
const existing = "# project-owned shell content\n";
fs.writeFileSync(bashrc, existing, "utf8");
run(process.execPath, [setup, "install", "1.1.10"], { cwd: project, env: commonEnv });
run(process.execPath, [setup, "install", "1.1.10"], { cwd: project, env: commonEnv });
const bashText = fs.readFileSync(bashrc, "utf8");
assert(bashText.startsWith(existing), "shell profile content was overwritten");
assert((bashText.match(/>>> ihgen-web-kit-context-supervisor >>>/g) || []).length === 1, "shell profile supervisor block duplicated");

if (process.platform !== "win32") {
  const binDir = path.join(webKitHome, "bin");
  const inheritedPath = ["/usr/bin", binDir, "/bin"].join(path.delimiter);
  const sourced = run("bash", ["-c", `. ${JSON.stringify(bashrc)}; printf '%s' \"$PATH\"`], {
    cwd: project,
    env: { ...commonEnv, PATH: inheritedPath },
  });
  assert(String(sourced.stdout).split(path.delimiter)[0] === binDir, "shell profile did not move Web Kit bin to PATH position 1");
}

const preferredStatus = JSON.parse(run(process.execPath, [setup, "status"], {
  cwd: project,
  env: { ...commonEnv, PATH: [path.join(webKitHome, "bin"), process.env.PATH || ""].filter(Boolean).join(path.delimiter) },
}).stdout);
assert(preferredStatus.installed === true, "supervisor status did not detect installed shims");
assert(preferredStatus.path_preferred === true && preferredStatus.path_index === 0, "supervisor status did not detect PATH priority");

for (const provider of ["codex", "claude"]) {
  const envName = provider === "codex" ? "WEB_KIT_REAL_CODEX_BIN" : "WEB_KIT_REAL_CLAUDE_BIN";
  const shim = shimPath(provider);
  const env = {
    ...commonEnv,
    [envName]: realProvider(provider),
    WEB_KIT_TEST_PROVIDER: provider,
    CODEX_HOME: path.join(tempHome, ".codex")
  };

  const result = run(shim, [], { cwd: project, env });
  process.stdout.write(result.stdout || "");
  const providerCalls = calls(project, provider);
  assert(providerCalls.length === 3, `${provider}: expected interactive + handoff + fresh interactive, got ${providerCalls.length}`);
  assert(providerCalls[0].active && !providerCalls[0].isHeadless, `${provider}: first native interactive call was not supervised`);
  assert(providerCalls[1].active && providerCalls[1].handoffMode && providerCalls[1].isHeadless, `${provider}: compact handoff pass missing`);
  assert(providerCalls[2].active && !providerCalls[2].isHeadless, `${provider}: fresh native interactive call missing`);
  assert(fs.existsSync(path.join(project, ".agent-core", "state", "transparent-test", `${provider}-fresh.txt`)), `${provider}: fresh-context bootstrap prompt not received`);

  const handoffRoot = path.join(project, ".agent-core", "state", "context-rollover", "handoffs");
  const latest = fs.readdirSync(handoffRoot)
    .filter((name) => name.endsWith("-latest.json"))
    .map((name) => path.join(handoffRoot, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  const handoff = readJson(latest);
  assert(handoff.provider === provider, `${provider}: wrong handoff provider`);
  assert(Math.round(handoff.observed_context_percent) === 60, `${provider}: expected 60% rollover`);
  assert(handoff.summary.includes("completed the first safe workflow unit"), `${provider}: generated compact handoff summary missing`);
  assert(handoff.next_action === "implement step-2", `${provider}: exact next action was not preserved`);
  assert(handoff.status === "pending", `${provider}: handoff status mismatch`);
}

const outside = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-transparent-outside-"));
const outsideEnv = {
  ...commonEnv,
  WEB_KIT_REAL_CODEX_BIN: realProvider("codex"),
  WEB_KIT_TEST_PROVIDER: "codex"
};
const pass = run(shimPath("codex"), ["hello"], { cwd: outside, env: outsideEnv });
assert(pass.stdout.includes("codex passthrough"), "outside Web-Kit project did not pass through to real provider");
assert(!fs.existsSync(path.join(outside, ".agent-core")), "outside pass-through created Web-Kit project state");

console.log(`Transparent Context Supervisor smoke: PASS (${process.platform})`);
