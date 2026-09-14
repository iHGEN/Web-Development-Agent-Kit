#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const legacyCli = join(here, "web-kit.js");
const SETUP_VALUE_OPTIONS = new Set(["--project", "--ref", "--repo", "--source", "--sha256"]);
const SETUP_FLAGS = new Set(["--allow-downgrade", "--install-graphify"]);
const REVIEW_VALUE_OPTIONS = new Set(["--base", "--provider", "--timeout"]);
const REVIEW_FLAGS = new Set(["--deep", "--scan-only", "--no-scanners", "--json", "--fail-on-blocking"]);

function runNode(file, args, options = {}) {
  const result = spawnSync(process.execPath, [file, ...args], { stdio: "inherit", windowsHide: true, ...options });
  if (result.error) {
    console.error(`Failed to run Web Kit: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function getOption(args, name) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name) return args[i + 1] ?? null;
    if (args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
  }
  return null;
}

function splitSetupArgs(args) {
  const setup = [];
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const setupValue = [...SETUP_VALUE_OPTIONS].find((name) => arg === name || arg.startsWith(`${name}=`));
    if (setupValue) {
      setup.push(arg);
      if (arg === setupValue && i + 1 < args.length) setup.push(args[++i]);
      continue;
    }
    if (SETUP_FLAGS.has(arg)) {
      setup.push(arg);
      continue;
    }
    rest.push(arg);
  }
  return { setup, rest };
}

function splitSecurityArgs(args) {
  const { setup, rest } = splitSetupArgs(args);
  const review = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const reviewValue = [...REVIEW_VALUE_OPTIONS].find((name) => arg === name || arg.startsWith(`${name}=`));
    if (reviewValue) {
      review.push(arg);
      if (arg === reviewValue && i + 1 < rest.length) review.push(rest[++i]);
      continue;
    }
    if (REVIEW_FLAGS.has(arg) || arg === "--help" || arg === "-h") {
      review.push(arg);
      continue;
    }
    throw new Error(`Unknown security-review option: ${arg}`);
  }
  return { setup, review };
}

function ensureInstalled(project, setup) {
  const setupStatus = runNode(legacyCli, setup);
  if (setupStatus !== 0) return setupStatus;
  return 0;
}

function runSecurityReview(rawArgs) {
  const { setup, review } = splitSecurityArgs(rawArgs);
  const project = resolve(getOption(setup, "--project") || process.cwd());

  if (review.includes("--help") || review.includes("-h")) {
    console.log(`iHGEN Web Kit Security PR Reviewer\n\nUsage:\n  npx @ihgen/web-kit security-review [options]\n\nOptions:\n  --project <path>          Target project. Default: current directory.\n  --base <branch/ref>       Base branch/ref. Auto-detected when omitted.\n  --provider <name>         auto | codex | claude | gemini. Default: auto.\n  --deep                    Review all security surfaces.\n  --scan-only               Scanner/branch analysis only; skip AI review.\n  --no-scanners             Skip optional external scanners.\n  --json                    Print the final review as JSON.\n  --fail-on-blocking        Exit with code 4 when review requests changes.\n  --timeout <seconds>       Per scanner/provider timeout. Default: 180.\n\nInside a capable AI provider:\n  run security-review\n  run security-review deep\n  run security-review base develop\n`);
    return 0;
  }

  const setupStatus = ensureInstalled(project, setup);
  if (setupStatus !== 0) return setupStatus;

  const engine = join(project, ".agent-core", "bin", "security-review.mjs");
  if (!existsSync(engine)) {
    console.error(`Security Review Engine is missing: ${engine}`);
    console.error("Update Web Kit to a version that includes security-review and retry.");
    return 1;
  }

  return runNode(engine, ["--project", project, ...review], { cwd: project });
}

function runWorkProgress(rawArgs, alias = "progress") {
  const { setup, rest } = splitSetupArgs(rawArgs);
  const project = resolve(getOption(setup, "--project") || process.cwd());
  const commandArgs = alias === "status" ? ["show", ...rest] : rest.length ? rest : ["show"];

  const setupStatus = ensureInstalled(project, setup);
  if (setupStatus !== 0) return setupStatus;

  const engine = join(project, ".agent-core", "bin", "work-progress.mjs");
  if (!existsSync(engine)) {
    console.error(`Work Progress Engine is missing: ${engine}`);
    console.error("Update Web Kit to a version that includes implementation-first progress tracking and retry.");
    return 1;
  }

  return runNode(engine, [...commandArgs, "--project", project], { cwd: project });
}

const args = process.argv.slice(2);
if (args[0] === "security-review") {
  try {
    process.exit(runSecurityReview(args.slice(1)));
  } catch (error) {
    console.error(`[Web Kit] ${error.message}`);
    process.exit(2);
  }
}

if (args[0] === "progress" || args[0] === "status") {
  try {
    process.exit(runWorkProgress(args.slice(1), args[0]));
  } catch (error) {
    console.error(`[Web Kit] ${error.message}`);
    process.exit(2);
  }
}

const status = runNode(legacyCli, args);
if ((args.includes("--help") || args.includes("-h") || args[0] === "help") && status === 0) {
  console.log("Security review:\n  npx @ihgen/web-kit security-review\n  Inside AI providers: run security-review\n");
  console.log("Work progress:\n  npx @ihgen/web-kit status\n  npx @ihgen/web-kit status --task-id <id>\n  npx @ihgen/web-kit progress show --task-id <id>\n  npx @ihgen/web-kit progress help\n");
}
process.exit(status);
