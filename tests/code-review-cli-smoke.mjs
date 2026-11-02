#!/usr/bin/env node
// Exercise the public command boundary without installing Web Kit or calling a provider.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-review-cli-"));
const providerHome = path.join(root, "provider-home");
fs.mkdirSync(providerHome);
const harness = path.join(root, "cli");
const project = path.join(root, "project with spaces");
const setupAudit = path.join(root, "unexpected-setup.txt");
const runtimeAudit = path.join(root, "review-invocations.jsonl");
const progressAudit = path.join(root, "progress-invocations.jsonl");
const cli = path.join(harness, "web-kit-entry.js");
const fixtureEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("CODEX_EXEC_SERVER_")));
const env = { ...fixtureEnv, CODEX_HOME: providerHome, WEB_KIT_TEST_SETUP_AUDIT: setupAudit, WEB_KIT_TEST_REVIEW_AUDIT: runtimeAudit, WEB_KIT_TEST_PROGRESS_AUDIT: progressAudit };

function invoke(args, expected = 0, cwd = root, extraEnv = {}) {
  const result = spawnSync(process.execPath, [cli, "code-review", ...args], {
    cwd, env: { ...env, ...extraEnv }, encoding: "utf8", windowsHide: true, timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(setupAudit), false, "code-review must never invoke setup/update");
  return result;
}
function invokeProgress(args, expected = 0, cwd = root) {
  const result = spawnSync(process.execPath, [cli, "progress", ...args], {
    cwd, env, encoding: "utf8", windowsHide: true, timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result;
}
const readInvocations = file => fs.existsSync(file)
  ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
const invocations = () => readInvocations(runtimeAudit);

try {
  // A setup sentinel prevents a regression from attempting network/install operations.
  fs.mkdirSync(harness);
  fs.writeFileSync(path.join(harness, "package.json"), '{"type":"module"}\n');
  fs.copyFileSync(path.join(repo, "bin/web-kit-entry.js"), cli);
  fs.writeFileSync(path.join(harness, "web-kit.js"), 'import fs from "node:fs"; fs.writeFileSync(process.env.WEB_KIT_TEST_SETUP_AUDIT, "unexpected setup"); process.exitCode = 99;\n');

  const help = invoke(["--help", "--project", project]);
  assert.match(help.stdout, /code-review --task-id/);
  assert.match(help.stdout, /Active adapter: Codex; auto selects Codex/);
  assert.match(help.stdout, /--provider claude and --provider gemini return VERIFICATION BLOCKED without launching either/);
  assert.equal(fs.existsSync(project), false, "help must not create an installation");

  fs.mkdirSync(project);
  const missing = invoke(["--project", project, "--task-id", "TASK-1"], 1);
  assert.match(missing.stderr, /Code Review Engine is missing/);
  assert.deepEqual(fs.readdirSync(project), [], "missing engine must not install runtime files");

  const engine = path.join(project, ".agent-core", "bin", "code-review.mjs");
  fs.mkdirSync(path.dirname(engine), { recursive: true });
  fs.writeFileSync(engine, `import fs from "node:fs";
const record = { args: process.argv.slice(2), cwd: process.cwd() };
fs.appendFileSync(process.env.WEB_KIT_TEST_REVIEW_AUDIT, JSON.stringify(record) + "\\n");
console.log(JSON.stringify(record));
process.exitCode = Number(process.env.WEB_KIT_TEST_REVIEW_EXIT || 0);
`);

  const routed = invoke([`--project=${project}`, "--task-id=TASK-1", "--provider=codex", "--timeout", "9", "--json"], 4, root, { WEB_KIT_TEST_REVIEW_EXIT: "4" });
  const record = JSON.parse(routed.stdout);
  assert.equal(record.cwd, project);
  assert.deepEqual(record.args, ["--project", project, "--task-id", "TASK-1", "--provider", "codex", "--timeout", "9", "--json"]);

  const implicitProject = invoke(["--task-id", "TASK-2", "--provider", "auto"], 0, project);
  assert.equal(JSON.parse(implicitProject.stdout).cwd, project);
  assert.deepEqual(JSON.parse(implicitProject.stdout).args, ["--project", project, "--task-id", "TASK-2", "--provider", "auto"]);
  const beforeRejected = invocations().length;
  invoke(["--project", project, "--help"]);
  invoke(["--project", project], 2);
  for (const extra of [["--ref", "main"], ["--source", root], ["--task-id", "TASK-3"], ["--provider", "--json"], ["--timeout="]]) {
    const rejected = invoke(["--project", project, "--task-id", "TASK-1", ...extra], 2);
    assert.equal(rejected.stdout, "", "invalid arguments must not reach the runtime");
  }
  assert.equal(invocations().length, beforeRejected, "help and invalid arguments must not launch a review");
  console.log("Code review CLI smoke: PASS");

  // Progress normally invokes setup. Record that boundary without installing anything.
  fs.writeFileSync(path.join(harness, "web-kit.js"), `import fs from "node:fs";
fs.appendFileSync(process.env.WEB_KIT_TEST_SETUP_AUDIT, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
`);
  fs.writeFileSync(path.join(path.dirname(engine), "work-progress.mjs"), `import fs from "node:fs";
const record = { args: process.argv.slice(2), cwd: process.cwd() };
fs.appendFileSync(process.env.WEB_KIT_TEST_PROGRESS_AUDIT, JSON.stringify(record) + "\\n");
console.log(JSON.stringify(record));
`);
  const check = ["check-require", "--task-id", "TASK-3", "--id", "regression", "--command", "node"];
  const childArgs = [
    "--project", "tsconfig.json", "--ref", "child-branch", "--source", "child-source",
    "--repo", "child-repo", "--sha256", "child-sha", "--allow-downgrade", "--install-graphify",
    "--help", "-h", "--arg", "--project=child-target", "", " \t ", "line\nvalue", "$(literal)", "`literal`",
  ];
  const setup = ["--project", project, "--ref", "feature/check-cli", "--source", path.join(root, "local source")];
  const opaque = invokeProgress([...check, ...childArgs.flatMap(value => ["--arg", value]), ...setup]);
  assert.deepEqual(readInvocations(setupAudit), [{ args: setup, cwd: root }], "check arguments must not affect setup options");
  assert.deepEqual(JSON.parse(opaque.stdout), {
    args: [...check, ...childArgs.map(value => `--arg=${value}`), "--project", project], cwd: project,
  }, "check arguments must retain their exact values and the intended project");

  const equalsArgs = ["--arg=--source=child-source", "--arg=", "--arg= \t "];
  const mixed = invokeProgress(["--project", project, ...check, ...equalsArgs, "--arg", "--help"]);
  assert.deepEqual(readInvocations(setupAudit).at(-1), { args: ["--project", project], cwd: root });
  assert.deepEqual(JSON.parse(mixed.stdout), {
    args: [...check, ...equalsArgs, "--arg=--help", "--project", project], cwd: project,
  }, "setup options before the subcommand and existing equals arguments must work");

  const setupsBeforeInvalid = readInvocations(setupAudit).length;
  const runsBeforeInvalid = readInvocations(progressAudit).length;
  const missingArg = invokeProgress(["--project", project, ...check, "--arg"], 2);
  assert.match(missingArg.stderr, /--arg requires a value/);
  assert.equal(readInvocations(setupAudit).length, setupsBeforeInvalid, "missing child argument must fail before setup");
  assert.equal(readInvocations(progressAudit).length, runsBeforeInvalid, "missing child argument must fail before runtime");
  console.log("Progress check argument CLI smoke: PASS");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
