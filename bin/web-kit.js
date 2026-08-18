#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
const VERSION = packageJson.version;
const DEFAULT_REPO = "iHGEN/Web-Development-Agent-Kit";
const DEFAULT_REF = `v${VERSION}`;
const bootstrap = join(__dirname, "..", "bootstrap", "remote-install.mjs");
const COMMANDS = new Set(["install", "update", "doctor", "scan"]);
const SESSION_SETUP_VALUE_OPTIONS = new Set(["--project", "--ref", "--repo", "--source", "--sha256"]);
const SESSION_SETUP_FLAGS = new Set(["--allow-downgrade", "--install-graphify"]);

function printHelp() {
  console.log(`
iHGEN Web Development Agent Kit

Runtime requirement:
  Node.js + npm only. Web Kit does not require a system Python installation.

Smart usage:
  npx @ihgen/web-kit

Bare execution is idempotent:
  - not installed  -> install
  - older version  -> update
  - same version   -> doctor / health check
  - newer version  -> never downgrade; doctor the installed kit

Explicit commands:
  npx @ihgen/web-kit install
  npx @ihgen/web-kit update
  npx @ihgen/web-kit doctor
  npx @ihgen/web-kit scan
  npx @ihgen/web-kit graphify
  npx @ihgen/web-kit session codex --prompt "<task>"
  npx @ihgen/web-kit session claude --prompt "<task>"

Options:
  --project <path>       Target project. Defaults to current directory.
  --ref <git-ref>        Override GitHub tag/branch/commit.
  --repo <owner/repo>    Override source repository.
  --source <zip-url>     Use a direct ZIP source instead of GitHub.
  --sha256 <hash>        Verify downloaded archive.
  --allow-downgrade      Explicitly permit install/update to an older semantic version.
  --install-graphify     After Web-Kit setup, install/register optional Graphify support.

Automatic session options:
  --prompt <text>                     Original task.
  --prompt-file <path>                Read the task from a file.
  --threshold <percent>               Fresh-context rollover threshold. Default: 50.
  --max-cycles <n>                    Controller safety cap. Default: 100.
  --telemetry-fallback-cycles <n>     Conservative rollover after missing telemetry. Default: 2.
  --task-id <id>                      Optional stable task id.
  --verbose                           Show raw provider telemetry/stderr.

AI instruction files are non-destructive:
  - existing AGENTS.md / CLAUDE.md / GEMINI.md / Copilot / Cursor instructions stay intact;
  - Web Kit adds or refreshes only its marked roles block;
  - missing instruction files are created once with a compact project summary plus roles.

Automatic context rollover:
  - Web Kit owns Codex/Claude through their structured headless modes;
  - below the threshold it resumes the same provider session;
  - at/above the threshold it validates a compact handoff and starts a fresh provider process;
  - no manual /clear or /new command is required.

Graphify is optional. If Graphify is requested and Python is absent, Web Kit bootstraps uv;
uv then manages Graphify's Python runtime. Without Graphify, Web Kit stays fully Node-only.

Examples:
  npx @ihgen/web-kit
  npx @ihgen/web-kit doctor
  npx @ihgen/web-kit scan --project ../my-app
  npx @ihgen/web-kit update --install-graphify
  npx @ihgen/web-kit graphify
  npx @ihgen/web-kit session codex --threshold 50 --prompt "Implement authenticated dashboard API"
  npx @ihgen/web-kit session claude --threshold 50 --prompt-file ./task.md
  npx @ihgen/web-kit install --ref main

Package version: ${VERSION}
Default GitHub ref: ${DEFAULT_REF}
`);
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return {}; }
}
function getOption(args, name) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === name) return args[i + 1] ?? null;
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return null;
}
function hasOption(args, name) { return args.some((arg) => arg === name || arg.startsWith(`${name}=`)); }
function removeFlag(args, name) { return args.filter((arg) => arg !== name); }
function parseSemver(value) {
  const match = String(value ?? "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
function compareSemver(a, b) {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  if (!av || !bv) return null;
  for (let i = 0; i < 3; i += 1) {
    if (av[i] < bv[i]) return -1;
    if (av[i] > bv[i]) return 1;
  }
  return 0;
}
function versionFromRef(ref) { return parseSemver(ref) ? String(ref).replace(/^v/, "") : null; }
function graphifyOnPath() {
  const result = spawnSync("graphify", ["--version"], { stdio: "ignore", windowsHide: true });
  return !result.error && result.status === 0;
}
function runGraphifySetup(projectPath) {
  const setup = join(projectPath, ".agent-core", "rules", "graphify-setup.mjs");
  if (!existsSync(setup)) {
    console.error(`Graphify setup helper is missing: ${setup}`);
    console.error("Run Web Kit update first, then retry `npx @ihgen/web-kit graphify`.");
    return 1;
  }
  console.log(`\nOptional Graphify setup\nProject: ${projectPath}\n`);
  const result = spawnSync(process.execPath, [setup, "--project", projectPath, "--yes"], { stdio: "inherit", windowsHide: true });
  if (result.error) {
    console.error(`Failed to run Graphify setup: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}
function runSessionController(projectPath, sessionArgs) {
  const controller = join(projectPath, ".agent-core", "bin", "session-controller.mjs");
  if (!existsSync(controller)) {
    console.error(`Session Controller is missing: ${controller}`);
    console.error("Run Web Kit update first, then retry the session command.");
    return 1;
  }
  const result = spawnSync(process.execPath, [controller, "--project", projectPath, ...sessionArgs], { stdio: "inherit", windowsHide: true });
  if (result.error) {
    console.error(`Failed to run Session Controller: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}
function parseSessionInvocation(rawArgs) {
  if (rawArgs[0] !== "session") return null;
  let index = 1;
  let provider = null;
  if (rawArgs[index] && !rawArgs[index].startsWith("-")) {
    provider = rawArgs[index];
    index += 1;
  }
  const rest = rawArgs.slice(index);
  if (!provider) provider = getOption(rest, "--provider");

  const setupArgs = [];
  const controllerArgs = [];
  if (provider) controllerArgs.push("--provider", provider);

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--") {
      controllerArgs.push(...rest.slice(i));
      break;
    }
    const setupValueName = [...SESSION_SETUP_VALUE_OPTIONS].find((name) => arg === name || arg.startsWith(`${name}=`));
    if (setupValueName) {
      setupArgs.push(arg);
      if (arg === setupValueName && i + 1 < rest.length) setupArgs.push(rest[++i]);
      continue;
    }
    if (SESSION_SETUP_FLAGS.has(arg)) {
      setupArgs.push(arg);
      continue;
    }
    if (arg === "--provider") {
      i += 1;
      continue;
    }
    if (arg.startsWith("--provider=")) continue;
    controllerArgs.push(arg);
    if (["--prompt", "--prompt-file", "--threshold", "--max-cycles", "--telemetry-fallback-cycles", "--task-id"].includes(arg) && i + 1 < rest.length) {
      controllerArgs.push(rest[++i]);
    }
  }
  return { provider, setupArgs, controllerArgs };
}

const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--help") || rawArgs.includes("-h") || rawArgs[0] === "help") {
  printHelp();
  process.exit(0);
}
if (rawArgs.includes("--version") || rawArgs.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

const sessionInvocation = parseSessionInvocation(rawArgs);
let args = sessionInvocation ? [...sessionInvocation.setupArgs] : [...rawArgs];
let graphifyRequested = hasOption(args, "--install-graphify");
args = removeFlag(args, "--install-graphify");
if (!sessionInvocation && args[0] === "graphify") {
  graphifyRequested = true;
  args.shift();
}

let explicitAction = null;
if (args.length > 0 && COMMANDS.has(args[0])) explicitAction = args.shift();
if (args.length > 0 && !args[0].startsWith("-") && !COMMANDS.has(args[0])) {
  console.error(`Unknown command: ${args[0]}`);
  printHelp();
  process.exit(2);
}

const allowDowngrade = hasOption(args, "--allow-downgrade");
args = removeFlag(args, "--allow-downgrade");
const projectOption = getOption(args, "--project");
const projectPath = resolve(projectOption || process.cwd());
const configPath = join(projectPath, ".agent-kit.json");
const sourcePath = join(projectPath, ".agent-kit-source.json");
const projectConfig = existsSync(configPath) ? readJson(configPath) : {};
const sourceConfig = existsSync(sourcePath) ? readJson(sourcePath) : {};
const installed = projectConfig.kit === "web-dev-agent-kit";
const installedVersion = installed && typeof projectConfig.version === "string" ? projectConfig.version : null;
const customRef = getOption(args, "--ref");
const customRepo = getOption(args, "--repo");
const customSource = getOption(args, "--source");
const customSelection = Boolean(customRef || customRepo || customSource);
const requestedVersion = customSource ? null : versionFromRef(customRef || DEFAULT_REF);

let action = explicitAction;
let smartReason = sessionInvocation
  ? "Automatic AI session requested; first ensuring the project Web Kit is current."
  : graphifyRequested
    ? "Graphify setup requested; first ensuring the project Web Kit is current."
    : "Explicit command requested.";
let useSavedSource = false;
let newerProjectWarning = false;

if (!action) {
  if (!installed) {
    action = "install";
    smartReason = sessionInvocation
      ? "Web Kit is not installed; installing it before launching the automatic Session Controller."
      : graphifyRequested ? "Web Kit is not installed; installing it before Graphify setup." : "Web Kit is not installed in this project.";
  } else if (customSelection) {
    const comparison = requestedVersion && installedVersion ? compareSemver(installedVersion, requestedVersion) : null;
    if (comparison !== null && comparison > 0 && !allowDowngrade) {
      console.error(`\nRefusing downgrade.\nInstalled Web Kit: ${installedVersion}\nRequested Web Kit: ${requestedVersion}\n\nUse --allow-downgrade only if you intentionally want to downgrade.\n`);
      process.exit(3);
    }
    if (comparison === 0) {
      action = "doctor";
      smartReason = "Selected version is already installed; running health check.";
    } else {
      action = "update";
      smartReason = "Custom source/ref selected for an existing installation; refreshing the managed kit.";
    }
  } else if (installedVersion) {
    const comparison = compareSemver(installedVersion, VERSION);
    if (comparison === -1) {
      action = "update";
      smartReason = `Installed Web Kit ${installedVersion} is older than npm CLI ${VERSION}.`;
    } else if (comparison === 0) {
      action = "doctor";
      useSavedSource = Boolean(sourceConfig.source || sourceConfig.repo);
      smartReason = sessionInvocation
        ? `Web Kit ${VERSION} is already installed; checking it before launching the Session Controller.`
        : graphifyRequested ? `Web Kit ${VERSION} is already installed; checking it before Graphify setup.` : `Web Kit ${VERSION} is already installed; running health check.`;
    } else if (comparison === 1) {
      action = "doctor";
      useSavedSource = Boolean(sourceConfig.source || sourceConfig.repo);
      newerProjectWarning = true;
      smartReason = `Project Web Kit ${installedVersion} is newer than npm CLI ${VERSION}; no downgrade will be performed.`;
    } else {
      action = "doctor";
      useSavedSource = Boolean(sourceConfig.source || sourceConfig.repo);
      smartReason = "Installed Web Kit version could not be compared safely; running health check without changing it.";
    }
  } else {
    action = "doctor";
    useSavedSource = Boolean(sourceConfig.source || sourceConfig.repo);
    smartReason = "Web Kit markers exist but the installed version is unknown; running health check without changing it.";
  }
}

if (installed && installedVersion && (action === "install" || action === "update") && requestedVersion) {
  const comparison = compareSemver(installedVersion, requestedVersion);
  if (comparison !== null && comparison > 0 && !allowDowngrade) {
    console.error(`\nRefusing downgrade.\nInstalled Web Kit: ${installedVersion}\nRequested Web Kit: ${requestedVersion}\n\nUse --allow-downgrade only if you intentionally want to downgrade.\n`);
    process.exit(3);
  }
}
if (newerProjectWarning && !useSavedSource) {
  console.log(`\n⚠ Project Web Kit ${installedVersion} is newer than this npm CLI (${VERSION}).\nNo downgrade was performed. The project has no remembered Web Kit source, so an automatic doctor run cannot safely load the newer kit.\n`);
  process.exit(0);
}
if (explicitAction && installed && !customSelection && (action === "doctor" || action === "scan") && (sourceConfig.source || sourceConfig.repo)) useSavedSource = true;

const runnerArgs = [bootstrap, "--action", action];
if (!useSavedSource) {
  if (!hasOption(args, "--repo") && !hasOption(args, "--source")) runnerArgs.push("--repo", DEFAULT_REPO);
  if (!hasOption(args, "--ref") && !hasOption(args, "--source")) runnerArgs.push("--ref", DEFAULT_REF);
}
if (!hasOption(args, "--project")) runnerArgs.push("--project", projectPath);
runnerArgs.push(...args);

const sourceLabel = useSavedSource
  ? `remembered project source (${sourceConfig.ref || sourceConfig.source || sourceConfig.repo || "installed version"})`
  : customSource ? "custom ZIP source" : `${customRepo || DEFAULT_REPO}@${customRef || DEFAULT_REF}`;

console.log(`\n╔════════════════════════════════════════╗\n║     iHGEN Web Development Agent Kit   ║\n╚════════════════════════════════════════╝\n\nMode:      ${sessionInvocation ? "session" : explicitAction ? "explicit" : "smart"}\nDecision:  ${action}\nReason:    ${smartReason}\nCLI:       ${VERSION}\nRuntime:   Node.js ${process.version}\nInstalled: ${installedVersion || "not installed"}\nProject:   ${projectPath}\nSource:    ${sourceLabel}\n`);

const result = spawnSync(process.execPath, runnerArgs, { stdio: "inherit", windowsHide: true });
if (result.error) {
  console.error(`Failed to run Web Kit: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

if (action === "install") {
  console.log("\n✓ Web Development Agent Kit installed.\n✓ Existing AI instruction content preserved; managed roles synchronized.\n✓ Node/npm is the only Web Kit runtime requirement.\n");
} else if (action === "update") {
  console.log("\n✓ Web Development Agent Kit updated/refreshed.\n✓ Project discovery, managed AI roles, routing, and detected skills are synchronized.\n✓ No system Python runtime is required by Web Kit.\n");
} else if (action === "doctor") {
  console.log("\n✓ Web Development Agent Kit health check completed.\n✓ No automatic downgrade was performed.\n");
}

if (graphifyRequested) {
  const graphifyStatus = runGraphifySetup(projectPath);
  if (graphifyStatus !== 0) process.exit(graphifyStatus);
} else if (!graphifyOnPath() && !sessionInvocation) {
  console.log(`\nOptional token-saving repository graph:\n  Graphify is not installed on PATH. Web Kit will use the normal routed-context loop.\n  Python is not required. If you opt into Graphify, Web Kit can bootstrap uv and let uv manage Graphify's Python runtime.\n\n  Install/register Graphify for this project:\n\n    npx @ihgen/web-kit@${VERSION} graphify\n\n  Or combine it with an update:\n\n    npx @ihgen/web-kit@${VERSION} update --install-graphify\n`);
}

if (sessionInvocation) {
  const sessionStatus = runSessionController(projectPath, sessionInvocation.controllerArgs);
  process.exit(sessionStatus);
}
