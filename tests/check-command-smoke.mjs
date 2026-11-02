#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess, { spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { resolveCheckCommand } from "../pack/runtime/check-command.mjs";
import { assertQualityComplete, createQuality, evaluateQuality, runQualityCommand } from "../pack/runtime/quality-pipeline.mjs";
import { reviewContextDigest } from "../pack/runtime/review-contract.mjs";

// Independent literal fixtures from npm/cmd-shim's published generators:
// https://github.com/npm/cmd-shim/blob/v8.0.0/lib/index.js
// https://github.com/npm/cmd-shim/blob/v9.0.2/lib/index.js
// Do not replace these with a template exported by the production parser.
const npm8 = String.raw`@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\node.exe" (
  SET "_prog=%dp0%\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\pnpm\bin\pnpm.cjs" %*
`;
const npm9 = String.raw`@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\node.exe" (
  SET "_prog=%dp0%\node.exe"
) ELSE (
  SET "_prog=node"
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  "%dp0%\node_modules\pnpm\bin\pnpm.cjs" %*
`;

const win = path.win32;
const cwd = String.raw`C:\project space %EXPAND%!&(work)^`;
const bin = String.raw`C:\tools space %EXPAND%!&(bin)^`;
const nodeDir = String.raw`C:\Node Runtime`;
const target = String.raw`node_modules\pnpm\bin\pnpm.cjs`;
const hostileArgs = [
  "", " ", "two words", "\t", 'a"b', "'single quotes'", '\\"', "trailing\\", "\\\\",
  "%PATH%", "%EXPAND%", "!EXPAND!", "^&|<>()", "a;b", "line one\r\nline two", "λ日本語",
  '" & echo injected > INJECTED & "', "; touch INJECTED #", "$(touch INJECTED)", "`touch INJECTED`",
  "--help", "--project", "--arg=", "--",
];

function fixture(body = npm8, options = {}) {
  const files = new Map();
  const key = file => win.normalize(file).toLowerCase();
  const put = (file, value = "") => files.set(key(file), value);
  const remove = file => files.delete(key(file));
  const get = file => {
    if (!files.has(key(file))) throw Object.assign(new Error("Missing fixture: " + file), { code: "ENOENT" });
    return files.get(key(file));
  };
  const fileSystem = {
    statSync(file) {
      const value = get(file);
      if (value instanceof Error) throw value;
      return { isFile: () => value !== null, size: Buffer.byteLength(value || "") };
    },
    readFileSync(file) { return get(file); },
  };
  const env = { Path: `${bin};${nodeDir}`, PATHEXT: ".COM;.EXE;.BAT;.CMD", EXPAND: "must-stay-literal" };
  put(win.join(bin, "pnpm.cmd"), body);
  put(win.join(bin, "pnpm"), "#!/bin/sh\nThis is the POSIX sibling, never a Windows executable.\n");
  put(win.join(bin, target), "console.log(process.argv.slice(2));\n");
  put(win.join(nodeDir, "node.exe"), "native fixture");
  const context = { platform: "win32", cwd, env, fileSystem, ...options };
  return { put, remove, context, launch: (command = "pnpm", args = hostileArgs) => resolveCheckCommand(command, args, context) };
}

const expected = { command: win.join(nodeDir, "node.exe"), args: [win.join(bin, target), ...hostileArgs], shell: false };
for (const body of [npm8, npm9, npm8.replace(/\n/g, "\r\n"), npm9.replace(/\n/g, "\r\n")]) {
  const f = fixture(body);
  for (const command of ["pnpm", "pnpm.cmd", "PNPM.CMD", win.join(bin, "pnpm.cmd")]) {
    assert.deepEqual(f.launch(command), expected, "Bare, explicit, and case-insensitive command lookup must preserve argv.");
  }
  assert.deepEqual(f.launch("pnpm", []).args, [win.join(bin, target)], "No arguments must remain no arguments.");
  assert.notEqual(f.launch().args, hostileArgs, "Resolution must not mutate the registered argument array.");
}

// Lookup honors current directory, PATH order/quotes, and PATHEXT precedence.
{
  const f = fixture();
  f.context.env.Path = `"${bin}";"${nodeDir}"`;
  assert.deepEqual(f.launch(), expected);
  f.put(win.join(bin, "pnpm.exe"), "native fixture");
  assert.deepEqual(f.launch(), { command: win.join(bin, "pnpm.EXE"), args: hostileArgs, shell: false });
  f.context.env.PATHEXT = ".CMD;.EXE";
  assert.deepEqual(f.launch(), expected, "PATHEXT order must not silently select another command.");
  f.put(win.join(cwd, "pnpm.cmd"), "@echo local custom script\n");
  assert.throws(() => f.launch(), { code: "UNSUPPORTED_CHECK_BATCH" }, "An unsupported earlier command must not be bypassed.");
}
{
  const f = fixture();
  delete f.context.env.PATHEXT;
  assert.deepEqual(f.launch(), expected, "Default PATHEXT must locate npm shims.");
  f.context.env.PATH = nodeDir;
  assert.throws(() => f.launch(), { code: "CHECK_COMMAND_NOT_FOUND" }, "Duplicate env keys must follow Node's lexicographic Windows rule.");
}
{
  const f = fixture();
  const localBin = win.join(cwd, "relative tools");
  f.put(win.join(localBin, "pnpm.cmd"), npm8);
  f.put(win.join(localBin, target), "entry point");
  f.context.env.Path = `relative tools;${nodeDir}`;
  const local = { ...expected, args: [win.join(localBin, target), ...hostileArgs] };
  assert.deepEqual(f.launch(), local, "Relative PATH entries must resolve from the check project.");
  assert.deepEqual(f.launch(String.raw`.\relative tools\pnpm.cmd`), local);
  f.put(win.join(localBin, "node.exe"), "sibling native fixture");
  assert.deepEqual(f.launch(), { ...local, command: win.join(localBin, "node.exe") }, "The shim's sibling Node must take precedence.");
}
{
  const f = fixture();
  const uncBin = String.raw`\\server\share space %EXPAND%!&\tools`;
  f.put(win.join(uncBin, "pnpm.cmd"), npm9);
  f.put(win.join(uncBin, target), "entry point");
  assert.deepEqual(f.launch(win.join(uncBin, "pnpm.cmd")), { ...expected, args: [win.join(uncBin, target), ...hostileArgs] });
}

// A wrapper may target an extensionless Node entry, or a literal quoted path
// containing spaces and metacharacters. It must not introduce batch expansion.
for (const entry of [String.raw`..\package\bin\check`, String.raw`..\package space !&()^\entry file.cjs`]) {
  const f = fixture(npm8.replace(target, entry));
  f.put(win.resolve(bin, entry), "entry point");
  assert.deepEqual(f.launch().args, [win.resolve(bin, entry), ...hostileArgs]);
}
for (const entry of [String.raw`%OTHER%\entry.js`, String.raw`C:entry.js`, String.raw`D:\entry.js`, String.raw`\entry.js`, String.raw`\\host\share\entry.js`]) {
  const f = fixture(npm8.replace(target, entry));
  assert.throws(() => f.launch(), /literal relative path/, "Variable/absolute targets must not run a different entry point.");
}

// A target-looking substring is not enough: never discard wrapper behavior.
for (const body of [
  "@echo off\nnode \"%~dp0\\node_modules\\pnpm\\bin\\pnpm.cjs\" %*\n",
  "echo extra setup\n" + npm8,
  npm8 + "echo injected > INJECTED\n",
  npm8.replace("SETLOCAL\n", "SETLOCAL\nSET MODE=required\n"),
  npm8.replace('"%_prog%"  ', '"%_prog%" --require setup.cjs '),
  npm8.replace('SET "_prog=node"', 'SET "_prog=python"'),
  npm8.replace("node.exe", "python.exe"),
  npm8.replace('"%_prog%"  ', '"%_prog%"  "fixed argument" '),
  "x".repeat(64 * 1024 + 1),
]) {
  const f = fixture(body);
  assert.throws(() => f.launch(), error => error.code === "UNSUPPORTED_CHECK_BATCH"
    && error.message.includes("Register node.exe") && error.message.includes("explicit interpreter"));
}
{
  const f = fixture();
  f.put(win.join(bin, "native.bat"), "@echo off\r\necho injected > INJECTED\r\n");
  f.put(win.join(bin, "renamed.bat"), npm8);
  for (const command of ["native.bat", "renamed.bat"]) {
    assert.throws(() => f.launch(command), error => error.code === "UNSUPPORTED_CHECK_BATCH" && /explicit interpreter/.test(error.message));
  }
  f.remove(win.join(bin, target));
  assert.throws(() => f.launch(), /entry point is missing/);
  f.put(win.join(bin, target), null);
  assert.throws(() => f.launch(), /not a file/);
  f.put(win.join(bin, target), "entry point");
  f.remove(win.join(nodeDir, "node.exe"));
  assert.throws(() => f.launch(), /node.exe is missing/);
  f.put(win.join(bin, "pnpm.cmd"), Object.assign(new Error("access denied"), { code: "EACCES" }));
  assert.throws(() => f.launch(), { code: "EACCES" }, "Lookup must not hide access failures by trying another executable.");
}
{
  const f = fixture();
  assert.throws(() => f.launch("missing"), { code: "CHECK_COMMAND_NOT_FOUND" });
  for (const command of ['', "bad\0path", "bad\npath"]) assert.throws(() => f.launch(command), /executable name/);
  for (const command of ['"C:\\tool space\\pnpm.cmd"', "C:pnpm.cmd", "C:"]) assert.throws(() => f.launch(command), /unquoted Windows executable path/);
  assert.throws(() => f.launch("pnpm", ["bad\0arg"]), /NUL/);
  assert.deepEqual(f.launch("native.exe"), { command: "native.exe", args: hostileArgs, shell: false }, "Native executables retain direct spawning.");
  assert.deepEqual(resolveCheckCommand("./tool name.cmd", hostileArgs, { platform: "linux" }), {
    command: "./tool name.cmd", args: hostileArgs, shell: false,
  }, "POSIX .cmd-named executables must retain direct spawning.");
}

// Real subprocess assertions exercise argv quoting on the current host. When
// run on Windows, this also launches both real .cmd fixtures through the resolver.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-check-command-"));
try {
  const project = path.join(temporary, "project space %EXPAND%!&()^");
  fs.mkdirSync(project, { recursive: true });
  const scriptName = process.platform === "win32" ? "argv echo.cjs" : 'argv "quoted" echo.cjs';
  const script = path.join(project, scriptName);
  fs.writeFileSync(script, "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));\n");
  const run = (launch, env = process.env) => {
    const result = spawnSync(launch.command, launch.args, {
      cwd: project, env, shell: launch.shell, windowsHide: true, encoding: "utf8", timeout: 10000,
    });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { args: hostileArgs, cwd: fs.realpathSync(project) });
    assert(!fs.existsSync(path.join(project, "INJECTED")), "Arguments must never execute shell commands.");
  };
  run(resolveCheckCommand(process.execPath, [script, ...hostileArgs], { cwd: project }));
  if (process.platform === "win32") {
    const shimDir = path.join(project, "shim space %EXPAND%!&()^");
    const shim = path.join(shimDir, "pnpm.cmd");
    const entry = path.join(shimDir, "node_modules", "pnpm", "bin", "pnpm.cjs");
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.copyFileSync(script, entry);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:path|pathext)$/i.test(key)));
    env.Path = `${shimDir};${path.dirname(process.execPath)}`;
    env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
    env.EXPAND = "must-stay-literal";
    for (const body of [npm8, npm9]) {
      fs.writeFileSync(shim, body.replace(/\n/g, "\r\n"));
      for (const command of ["pnpm", "pnpm.cmd", shim]) run(resolveCheckCommand(command, hostileArgs, { cwd: project, env }), env);
    }
    const custom = path.join(shimDir, "custom.bat");
    fs.writeFileSync(custom, "@echo off\r\necho injected > INJECTED\r\n");
    assert.throws(() => resolveCheckCommand(custom, hostileArgs, { cwd: project, env }), { code: "UNSUPPORTED_CHECK_BATCH" });
    assert(!fs.existsSync(path.join(project, "INJECTED")));
  }

  // A failed Windows setup retry must supersede stored success even when the
  // registered command and application source did not change. Exercise the
  // pipeline's real persistence/gating path, not only the resolver exception.
  {
    const retryProject = path.join(temporary, "retry project");
    fs.mkdirSync(retryProject);
    fs.writeFileSync(path.join(retryProject, "source.mjs"), "export const stable = true;\n");
    const checkId = "package-manager";
    const missingCommand = win.resolve(temporary, "missing-external-manager", "pnpm.cmd");
    const governance = { plan_required: false, plan_validator_required: false };
    let savedJob = {
      task_id: "WINDOWS-SETUP-RETRY", classification: "SMALL", status: "IMPLEMENTING", pr_bound: false,
      governance, quality: createQuality(governance), evidence: { items: [] },
    };
    const loadJob = () => ({ job: structuredClone(savedJob) });
    const writeJob = (_project, job) => { savedJob = structuredClone(job); };
    const work = (command, ...args) => runQualityCommand(retryProject, command,
      ["--task-id", savedJob.task_id, ...args], loadJob, writeJob);
    work("requirement-add", "--id", "REQ-001", "--description", "Package manager check passes",
      "--acceptance", "A current package-manager check succeeds.");
    work("check-require", "--id", checkId, "--command", missingCommand, "--arg", "--version");

    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    const originalSpawnSync = childProcess.spawnSync;
    const externalLaunches = [];
    try {
      Object.defineProperty(process, "platform", { ...platformDescriptor, value: "win32" });
      childProcess.spawnSync = (command, ...args) => {
        if (command !== "git") {
          externalLaunches.push(command);
          throw new Error("A check with failed setup must never reach process launch.");
        }
        return originalSpawnSync(command, ...args);
      };
      syncBuiltinESMExports();

      const first = work("check-run", "--check", checkId);
      assert.equal(first.status, "FAIL", "Initial setup errors must create failed execution receipts.");
      assert.equal(first.exit_code, null);
      assert.match(first.error, /not found.*explicit interpreter/);
      assert.equal(savedJob.quality.checks.length, 1);

      // Model a persisted historical PASS from before the external shim was
      // removed. Keep the production receipt's source/definition digests so
      // this regression cannot pass merely because either became stale.
      const priorPass = { ...savedJob.quality.checks[0], status: "PASS", exit_code: 0, error: null };
      savedJob.quality.checks = [priorPass];
      work("requirement-verify", "--id", "REQ-001", "--result", "PASS", "--check-script", checkId,
        "--evidence", "Fixture saved receipt from before the external launcher disappeared.");
      assert.equal(evaluateQuality(savedJob, retryProject).ok, true, "The historical fixture must initially satisfy the gate.");
      assert.doesNotThrow(() => assertQualityComplete(savedJob, retryProject));
      const approvedContext = reviewContextDigest(savedJob, retryProject);

      const retried = work("check-run", "--check", checkId);
      assert.equal(retried.status, "FAIL");
      assert.equal(retried.exit_code, null);
      assert.match(retried.error, /not found.*explicit interpreter/);
      assert.equal(savedJob.quality.checks.length, 2, "The failed retry must be appended after the prior PASS.");
      assert.deepEqual(savedJob.quality.checks[0], priorPass, "Keep the historical receipt without treating it as current.");
      const latest = savedJob.quality.checks.at(-1);
      assert.equal(latest.status, "FAIL");
      assert.equal(latest.source_digest, priorPass.source_digest, "The application source must remain unchanged.");
      assert.equal(latest.definition_digest, priorPass.definition_digest, "The registered command must remain unchanged.");
      assert.equal(latest.command, missingCommand);
      assert.deepEqual(latest.args, ["--version"]);
      assert.deepEqual(externalLaunches, [], "Setup failures must be recorded without attempting the command.");
      assert.notEqual(reviewContextDigest(savedJob, retryProject), approvedContext, "A failed retry must invalidate reviewed evidence.");
      const blocked = evaluateQuality(savedJob, retryProject);
      assert.equal(blocked.ok, false);
      assert.equal(blocked.requirements_ok, false);
      assert(blocked.reasons.some(reason => reason.includes("Required check has no current successful execution: " + checkId)));
      assert.throws(() => assertQualityComplete(savedJob, retryProject), /Quality gate blocked DONE/);
      assert.throws(() => work("requirement-verify", "--id", "REQ-001", "--result", "PASS", "--check-script", checkId,
        "--evidence", "An older success must not conceal the failed retry."), /fresh successful executed check/);
    } finally {
      childProcess.spawnSync = originalSpawnSync;
      syncBuiltinESMExports();
      Object.defineProperty(process, "platform", platformDescriptor);
    }
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({
  test: "check-command-smoke", status: "PASS", deterministic_windows_resolution: "PASS", native_argument_round_trip: "PASS",
  setup_retry_invalidates_success: "PASS",
  native_windows_shims: process.platform === "win32" ? "PASS" : "SKIPPED (non-Windows host)",
}));
