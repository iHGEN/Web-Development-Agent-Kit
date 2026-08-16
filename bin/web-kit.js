#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8")
);

const VERSION = packageJson.version;
const DEFAULT_REPO = "iHGEN/Web-Development-Agent-Kit";
const DEFAULT_REF = `v${VERSION}`;
const bootstrap = join(__dirname, "..", "bootstrap", "remote-install.py");
const rawArgs = process.argv.slice(2);

const ACTIONS = new Set(["install", "update", "doctor", "scan"]);

function printHelp() {
  console.log(`
iHGEN Web Development Agent Kit

Usage:
  npx @ihgen/web-kit
  npx @ihgen/web-kit install
  npx @ihgen/web-kit update
  npx @ihgen/web-kit doctor
  npx @ihgen/web-kit scan

Options passed through to the remote runner:
  --project <path>       Target project. Defaults to current directory.
  --ref <git-ref>        Override GitHub tag/branch/commit.
  --repo <owner/repo>    Override source repository.
  --source <zip-url>     Use a direct ZIP source instead of GitHub.
  --sha256 <hash>        Verify downloaded archive.
  --force-agents         Replace an existing non-managed AGENTS.md during install.

Examples:
  npx @ihgen/web-kit
  npx @ihgen/web-kit doctor
  npx @ihgen/web-kit scan --project ../my-app
  npx @ihgen/web-kit install --ref main

Package version: ${VERSION}
Default GitHub ref: ${DEFAULT_REF}
`);
}

function hasOption(args, name) {
  return args.some((arg, i) => arg === name || arg.startsWith(`${name}=`));
}

function findPython() {
  const candidates = process.platform === "win32"
    ? [
        ["py", ["-3"]],
        ["python", []],
        ["python3", []]
      ]
    : [
        ["python3", []],
        ["python", []]
      ];

  for (const [command, prefix] of candidates) {
    const result = spawnSync(command, [...prefix, "--version"], {
      stdio: "ignore"
    });

    if (!result.error && result.status === 0) {
      return { command, prefix };
    }
  }

  return null;
}

if (rawArgs.includes("--help") || rawArgs.includes("-h") || rawArgs[0] === "help") {
  printHelp();
  process.exit(0);
}

if (rawArgs.includes("--version") || rawArgs.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

const args = [...rawArgs];
let action = "install";
if (args.length > 0 && ACTIONS.has(args[0])) {
  action = args.shift();
}

if (args.length > 0 && !args[0].startsWith("-") && !ACTIONS.has(args[0])) {
  console.error(`Unknown command: ${args[0]}`);
  printHelp();
  process.exit(2);
}

const python = findPython();
if (!python) {
  console.error(`
Python 3 is required by the Web Development Agent Kit bootstrapper.
Install Python 3 and run the command again.
`);
  process.exit(1);
}

const runnerArgs = [
  ...python.prefix,
  bootstrap,
  "--action",
  action
];

if (!hasOption(args, "--repo") && !hasOption(args, "--source")) {
  runnerArgs.push("--repo", DEFAULT_REPO);
}

if (!hasOption(args, "--ref") && !hasOption(args, "--source")) {
  runnerArgs.push("--ref", DEFAULT_REF);
}

if (!hasOption(args, "--project")) {
  runnerArgs.push("--project", process.cwd());
}

runnerArgs.push(...args);

console.log(`
╔════════════════════════════════════════╗
║     iHGEN Web Development Agent Kit   ║
╚════════════════════════════════════════╝

Action:  ${action}
Version: ${VERSION}
Project: ${hasOption(args, "--project") ? "custom --project path" : process.cwd()}
Source:  ${hasOption(args, "--source") ? "custom ZIP source" : `${DEFAULT_REPO}@${hasOption(args, "--ref") ? "custom ref" : DEFAULT_REF}`}
`);

const result = spawnSync(python.command, runnerArgs, {
  stdio: "inherit"
});

if (result.error) {
  console.error(`Failed to run Web Kit: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (action === "install" || action === "update") {
  console.log(`
✓ Web Development Agent Kit ${action === "install" ? "installed" : "updated"}.
✓ Project-aware AGENTS context generated.
✓ Agents, routing, validators, and detected skills are ready.
`);
}
