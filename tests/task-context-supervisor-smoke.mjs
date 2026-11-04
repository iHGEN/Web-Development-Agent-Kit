#!/usr/bin/env node
// Real installed supervisor/bridge/helper processes with mock CLIs, not live model validation.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureSource = path.join(repo, "tests", "fixtures", "mock-task-context-provider.mjs");
const fixtureSourceBytes = fs.readFileSync(fixtureSource);
const fixtureSourceMode = fs.statSync(fixtureSource).mode;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-task-supervisor-"));
// Make only the disposable copy executable; never chmod the tracked fixture.
const fixture = path.join(root, "mock-task-context-provider.mjs");
fs.copyFileSync(fixtureSource, fixture);
if (process.platform !== "win32") fs.chmodSync(fixture, 0o755);
const userHome = path.join(root, "home");
const webKitHome = path.join(userHome, ".web-kit");
const commonEnv = {
  ...process.env, WEB_KIT_USER_HOME: userHome, WEB_KIT_HOME: webKitHome,
  WEB_KIT_DISABLE_CONTEXT_SUPERVISOR: "0", WEB_KIT_DISABLE_SHELL_PROFILE: "1",
  CLAUDE_CONFIG_DIR: path.join(userHome, ".claude"),
};
for (const name of ["WEB_KIT_CONTEXT_SUPERVISOR_ACTIVE", "WEB_KIT_CONTEXT_SUPERVISOR_BYPASS",
  "WEB_KIT_CONTEXT_SUPERVISOR_HANDOFF", "WEB_KIT_SUPERVISOR_ID", "WEB_KIT_LAUNCH_ID", "WEB_KIT_REVIEW_TASK_ID",
  "WEB_KIT_PROVIDER_WRAPPER_NAME", "WEB_KIT_PROVIDER_WRAPPER_TARGET"]) delete commonEnv[name];

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const jsonLines = file => fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const write = (project, relative, content) => {
  const file = path.join(project, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repo, env: commonEnv, encoding: "utf8", windowsHide: true, timeout: 45000,
    maxBuffer: 2 * 1024 * 1024,
    shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command), ...options,
  });
  assert.ifError(result.error);
  return result;
}
function success(command, args, options = {}) {
  const result = run(command, args, options);
  assert.equal(result.status, 0, args.join(" ") + " failed:\n" + result.stdout + "\n" + result.stderr);
  return result;
}
function actualProvider(provider) {
  if (process.platform !== "win32") return fixture;
  const wrapper = path.join(userHome, provider + "-task-fixture.cmd");
  fs.mkdirSync(userHome, { recursive: true });
  fs.writeFileSync(wrapper, '@echo off\r\n"' + process.execPath.replace(/"/g, '""') + '" "' +
    fixture.replace(/"/g, '""') + '" %*\r\n');
  return wrapper;
}

function createProject(name) {
  const project = path.join(root, name, "project with spaces");
  write(project, "package.json", '{"name":"task-handoff-process-fixture","private":true}\n');
  write(project, "src/feature.js", "export const priceTotal = prices => prices.reduce((total, price) => total + price);\n");
  write(project, "src/unrelated.js", "export const userOwned = 'preserve exactly';\n");
  success(process.execPath, [path.join(repo, "scripts", "agent-kit.mjs"), "install", project]);
  // Exercise the installed helper through an alias in the actual mock native provider.
  if (process.platform !== "win32") fs.symlinkSync("task-handoff.mjs",
    path.join(project, ".agent-core", "bin", "task-handoff-link.mjs"));
  success(process.execPath, [path.join(project, ".agent-core", "bin", "supervisor-setup.mjs"), "install", "task-context-smoke"], { cwd: project });
  const progress = path.join(project, ".agent-core", "bin", "work-progress.mjs");
  success(process.execPath, [progress, "start", "--task-id", "host-handover", "--classification", "SMALL",
    "--local-only", "--title", "Existing builder work", "--next", "OLD_BUILDER_NEXT_ACTION_MUST_NOT_BE_COPIED", "--project", project]);
  success(process.execPath, [progress, "update", "--task-id", "host-handover", "--status", "REVIEWING",
    "--agent", "fixture-builder", "--project", project]);
  write(project, ".agent-core/state/scope/host-handover.json",
    '{"base":"unavailable-old-base","allowed_paths":["src/unrelated.js"]}\n');
  write(project, ".agent-core/state/reviews/pre-existing-review/queue.json",
    '{"tasks":["capacity","handover","loading","joining","recovery","exit","dialogs"],"status":"BLOCKED"}\n');
  write(project, ".agent-core/state/context-handoff.json",
    '{"original_request":"OLD_BUILDER_HANDOFF_MUST_NOT_BE_COPIED","next_action":"continue the seven-item queue"}\n');
  write(project, "fixture-settings.json", JSON.stringify({
    permissions: { deny: ["Bash(project-owned-protected-command)"] },
    statusLine: { type: "command", command: "echo project-owned-status" },
    hooks: {
      Notification: [
        { matcher: "permission_prompt", hooks: [{ type: "command", command: "echo project-owned-notification" }] },
        { matcher: "idle_prompt", hooks: [{ type: "command", command: "echo project-owned-idle" }] },
      ],
      Stop: [{ hooks: [{ type: "command", command: "echo project-owned-stop" }] }],
    },
  }, null, 2) + "\n");
  const preserved = new Map([
    "src/feature.js", "src/unrelated.js", "fixture-settings.json",
    ".agent-core/state/jobs/host-handover.json", ".agent-core/state/scope/host-handover.json",
    ".agent-core/state/reviews/pre-existing-review/queue.json", ".agent-core/state/context-handoff.json",
  ].map(relative => [relative, fs.readFileSync(path.join(project, relative))]));
  return { project, preserved };
}
function assertPreserved(project, files) {
  for (const [relative, content] of files) assert.deepEqual(fs.readFileSync(path.join(project, relative)), content,
    relative + ": task-triggered review changed existing source or workflow state");
}
function reportOnly(job) {
  assert.equal(job.classification, "SMALL");
  assert.equal(job.pr_bound, false);
  assert.equal(job.governance.plan_required, false);
  assert.equal(job.quality.required, false);
  assert.equal(job.review.status, "PENDING", "report delivery approved the source review");
  assert.equal(job.quality.code_review.status, "PENDING", "report delivery produced strict approval evidence");
  assert.equal(job.quality.code_review.report_path, undefined);
  assert.equal(job.evidence.files_changed, 0);
  assert.equal(job.evidence.tests_total, 0);
  assert.equal(job.evidence.build, "UNKNOWN");
}
function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
function assertNewProcess(calls, provider, oldSession, oldSessionOption) {
  assert.equal(calls.length, 2, provider + ": expected exactly builder + fresh native review");
  const [builder, reviewer] = calls;
  assert.equal(builder.phase, "builder");
  assert.equal(reviewer.phase, "reviewer");
  assert.notEqual(builder.pid, reviewer.pid, "review did not start a separate provider process");
  assert.notEqual(builder.launch_id, reviewer.launch_id, "fresh review reused the builder generation");
  assert.notEqual(builder.session_id, reviewer.session_id, "mock native session was reused");
  assert.equal(builder.supervisor_id, reviewer.supervisor_id, "review did not reuse the outer supervisor");
  for (const call of calls) {
    assert(call.active && call.launch_id && call.supervisor_id);
    assert.equal(call.handoff_mode, false, "task trigger attempted old-session handoff capture");
  }
  const fresh = reviewer.args;
  assert(fresh.includes("task-test-model"), "fresh review lost the selected model");
  assert(fresh.includes(provider === "codex" ? "--sandbox" : "--permission-mode"), "fresh review lost permission options");
  assert(fresh.includes(provider === "codex" ? "read-only" : "plan"), "fresh review changed the selected permission mode");
  assert(!fresh.some(arg => ["resume", "--resume", "--continue", "--fork-session", "--session-id"].includes(arg) ||
    /^--(?:resume|session-id)=/.test(arg)), "fresh review received a resume/continuation option");
  if (provider === "claude") assert(!fresh.includes("-c") && !fresh.includes("-r"), "Claude retained a continuation shorthand");
  assert(!fresh.some(arg => arg.includes(oldSession) || arg.includes(oldSessionOption) ||
    arg.includes("ORIGINAL_BUILDER_PROMPT_MUST_NOT_SURVIVE")), "fresh review received the builder prompt or old session argument");
}

const taskIds = new Set();
try {
  const selectedCase = process.argv[2] === "--case" ? process.argv[3] : null;
  assert(process.argv.length === 2 || (process.argv.length === 4 && selectedCase), "Usage: task-context-supervisor-smoke.mjs [--case <provider-scenario>]");
  const scenarios = [
    ["codex", "success"], ["claude", "success"],
    ["codex", "auto-success"], ["claude", "auto-success"],
    ["codex", "auto-incomplete"], ["claude", "auto-incomplete"],
    ["codex", "empty-selection"], ["claude", "empty-selection"],
    ["codex", "no-boundary"], ["claude", "no-boundary"],
    ["codex", "launch-failure"], ["claude", "launch-failure"],
    ["codex", "missing-receipt"], ["claude", "stale-receipt"],
  ].filter(([provider, scenario]) => !selectedCase || provider + "-" + scenario === selectedCase);
  assert(scenarios.length, "Unknown task supervisor case: " + selectedCase);
  for (const [provider, scenario] of scenarios) {
    const name = provider + "-" + scenario;
    const { project, preserved } = createProject(name);
    const logs = path.join(root, name, "observations");
    fs.mkdirSync(logs);
    assert(fs.existsSync(path.join(webKitHome, "task-handoff.mjs")), "task helper was not installed with the user supervisor");
    const helper = path.join(project, ".agent-core", "bin", "task-handoff.mjs");
    if (name === "codex-success") {
      const alias = path.join(project, ".agent-core", "bin", "task-handoff-link.mjs");
      for (const executable of [helper, ...(process.platform === "win32" ? [] : [alias])]) {
        for (const args of [
          ["request-review", "--request", "review these changes", "--selection", "src/feature.js"],
          ["report-ready"],
        ]) {
          const unavailable = run(process.execPath, [executable, ...args], { cwd: project });
          assert.notEqual(unavailable.status, 0, args[0] + " silently succeeded without a supervisor via " + executable);
          assert.match(unavailable.stderr, /no active compatible native supervisor/,
            args[0] + " did not explain the unavailable supervisor via " + executable);
        }
      }
      assert.deepEqual(fs.readdirSync(path.join(project, ".agent-core", "state", "jobs")), ["host-handover.json"]);
      assertPreserved(project, preserved);
    }
    const request = scenario === "empty-selection" ? "review these changes" :
      "  review these changes in src/feature.js\nReport findings and missing evidence; leave existing work and its queue untouched.  ";
    const selection = scenario === "empty-selection" ? "working tree is empty" :
      "Provided current source: src/feature.js; comparison base unavailable; exclude src/unrelated.js.";
    const oldSession = provider + "-builder-" + randomUUID();
    const oldSessionOption = randomUUID();
    const marker = "MOCK_NATIVE_REVIEW_REPORT_" + name;
    const env = {
      ...commonEnv,
      [provider === "codex" ? "WEB_KIT_REAL_CODEX_BIN" : "WEB_KIT_REAL_CLAUDE_BIN"]: actualProvider(provider),
      WEB_KIT_TEST_PROVIDER: provider, WEB_KIT_TASK_TEST_SCENARIO: scenario, WEB_KIT_TASK_TEST_DIR: logs,
      WEB_KIT_TASK_TEST_HELPER_NAME: process.platform === "win32" ? "task-handoff.mjs" : "task-handoff-link.mjs",
      WEB_KIT_TASK_TEST_REQUEST: request, WEB_KIT_TASK_TEST_SELECTION: selection,
      WEB_KIT_TASK_TEST_OLD_SESSION: oldSession, WEB_KIT_TASK_TEST_MARKER: marker,
      CODEX_HOME: path.join(root, name, "codex-state"),
    };
    const prompt = "ORIGINAL_BUILDER_PROMPT_MUST_NOT_SURVIVE";
    const initialArgs = provider === "codex"
      ? ["resume", oldSession, prompt, "--model", "task-test-model", "--sandbox", "read-only"]
      : [
        ...(scenario === "empty-selection" ? ["--continue", "--session-id=" + oldSessionOption] :
          ["--resume", oldSession, "--session-id", oldSessionOption]),
        "--fork-session", "--settings", "fixture-settings.json", prompt,
        "--model", "task-test-model", "--permission-mode", "plan",
      ];
    const shim = path.join(webKitHome, "bin", provider + (process.platform === "win32" ? ".cmd" : ""));
    const result = run(shim, initialArgs, { cwd: project, env });
    const completedAt = Date.now();
    const eventLog = path.join(logs, "events.jsonl");
    const diagnostic = name + ":\n" + result.stdout + "\n" + result.stderr +
      (fs.existsSync(eventLog) ? "\nRecent fixture events:\n" + jsonLines(eventLog).slice(-6).map(item => JSON.stringify(item)).join("\n") : "");
    if (["success", "empty-selection", "auto-success"].includes(scenario)) assert.equal(result.status, 0, diagnostic);
    else if (scenario !== "no-boundary") assert.notEqual(result.status, 0, diagnostic);
    assert(fs.existsSync(path.join(logs, "queued.json")), "request was not queued:\n" + diagnostic);
    const queued = readJson(path.join(logs, "queued.json"));
    assert(!taskIds.has(queued.task_id), "a new request reused a previous review task");
    taskIds.add(queued.task_id);
    assert.notEqual(queued.task_id, "host-handover");
    const taskRoot = path.join(project, ".agent-core", "state", "reviews", queued.task_id);
    const job = readJson(path.join(project, ".agent-core", "state", "jobs", queued.task_id + ".json"));
    const calls = jsonLines(path.join(logs, "calls.jsonl"));
    const events = jsonLines(path.join(logs, "events.jsonl"));
    const observed = name => events.some(item => item.event === name);
    assert(observed("waiting-for-real-boundary"), "request or a non-boundary notification terminated the builder");
    assertPreserved(project, preserved);
    assert.deepEqual(fs.readdirSync(path.join(project, ".agent-core", "state", "jobs")).sort(),
      ["host-handover.json", queued.task_id + ".json"].sort(), "review dispatched another task");
    assert(!fs.existsSync(path.join(project, ".agent-core", "state", "scope", queued.task_id + ".json")),
      "standalone review acquired an implementation scope prerequisite");
    reportOnly(job);
    reportOnly(readJson(path.join(logs, "job-queued.json")));

    if (scenario === "no-boundary") {
      assert.equal(calls.length, 1, "queued request launched before a native completion boundary");
      assert.notEqual(job.status, "DONE");
      assert(!fs.existsSync(path.join(taskRoot, "handoff.json")), "unsafe request produced a fresh-review handoff");
      assert(!fs.existsSync(path.join(taskRoot, "report.md")));
      console.log("Task supervisor process case: PASS (" + name + ")");
      continue;
    }

    assertNewProcess(calls, provider, oldSession, oldSessionOption);
    const handoff = readJson(path.join(logs, "review-handoff.json"));
    assert.equal(handoff.original_request, request, "fresh review lost or changed the exact current request");
    assert.equal(handoff.selection, selection, "fresh review replaced the selection with old task scope");
    assert.equal(handoff.task_id, queued.task_id);
    assert.equal(handoff.launch_id, calls[1].launch_id);
    assert.equal(handoff.previous_launch_id, calls[0].launch_id);
    assert.equal(handoff.previous_session_id, calls[0].session_id);
    assert.equal(fs.realpathSync(handoff.project), fs.realpathSync(project));
    assert.doesNotMatch(JSON.stringify(handoff),
      /BUILDER_CONVERSATION_MUST_NOT_BE_COPIED|BUILDER_REASONING_MUST_NOT_BE_COPIED|ORIGINAL_BUILDER_PROMPT_MUST_NOT_SURVIVE|OLD_BUILDER_HANDOFF_MUST_NOT_BE_COPIED|OLD_BUILDER_NEXT_ACTION_MUST_NOT_BE_COPIED/,
      "review handoff inherited builder conversation or continuation state");
    assert.equal(readJson(path.join(logs, "job-reviewing.json")).status, "REVIEWING");
    if (scenario === "success") {
      for (const rejected of ["malformed-json", "unknown-schema", "wrong-reason", "cross-supervisor", "stale-launch",
        "wrong-provider", "wrong-project", "stale-time", "malformed-published", "cross-supervisor-published", "stale-launch-published"]) {
        assert(observed("rejected-" + rejected), rejected + " request interrupted the builder");
      }
      assert(observed("ignored-old-launch-callback"), "old builder callback affected the fresh review");
      assert(observed("same-native-session-rejected"), "the builder's native session completed the fresh review");
    }
    if (["success", "empty-selection", "auto-success"].includes(scenario)) {
      if (scenario !== "auto-success") {
        assert(observed("receipt-waiting-for-real-boundary"), "receipt alone completed the review");
        const staged = readJson(path.join(logs, "job-after-receipt.json"));
        assert.equal(staged.status, "REVIEWING");
        assert.equal(staged.final_validation.status, "PENDING");
      } else {
        assert(observed("native-final-output"), "automatic review did not deliver its native final message");
        const ready = readJson(path.join(taskRoot, "ready.json"));
        assert.equal(ready.status, "report-ready", "native hook did not stage a verified receipt");
        assert.equal(ready.task_id, queued.task_id);
        assert.match(fs.readFileSync(path.join(taskRoot, "report.md"), "utf8"), /^Changes review: COMPLETED/);
      }
      assert.equal(job.status, "DONE");
      assert.equal(job.final_validation.status, "PASS");
      assert.equal(job.progress, 100);
      assert.equal(result.stdout.split(marker).length - 1, 1, "native report was not presented exactly once");
      assert.match(fs.readFileSync(path.join(taskRoot, "report.md"), "utf8"), /PR readiness: not assessed/);
      assert(fs.existsSync(path.join(taskRoot, "result.json")), "completed review receipt was not recorded");
      if (scenario === "empty-selection") assert.match(result.stdout, /Changes review: NO CHANGES/);
    } else {
      assert.notEqual(job.status, "DONE", "failed launch/report receipt completed the task");
      assert.notEqual(job.final_validation.status, "PASS");
      assert.equal(readJson(path.join(taskRoot, "result.json")).status, "failed");
      assert.equal(result.stdout.split(marker).length - 1, 0, "failed review claimed report delivery");
      if (scenario === "auto-incomplete") {
        assert(observed("native-final-output"), "incomplete native review was not delivered to the hook");
        assert(!fs.existsSync(path.join(taskRoot, "report.md")), "incomplete output fabricated a review");
        assert(!fs.existsSync(path.join(taskRoot, "ready.json")), "incomplete output fabricated a receipt");
      }
      if (["missing-receipt", "stale-receipt"].includes(scenario)) {
        assert(observed(scenario + "-waiting-for-real-boundary"), "invalid notification or status refresh stopped the reviewer");
        assert(observed(scenario + "-old-session-ignored"), "the builder session terminated the fresh review");
        const beforeBoundary = readJson(path.join(logs, "job-before-failure-boundary.json"));
        assert.equal(beforeBoundary.status, "REVIEWING", "an unauthenticated boundary finalized the review task");
        assert.equal(beforeBoundary.final_validation.status, "PENDING");
        const terminal = events.find(item => item.phase === "reviewer" && item.event === "failure-boundary-requested");
        assert(terminal, "fixture never requested the authentic terminal boundary");
        assert.equal(result.status, 1, "failed review did not exit through the supervisor failure transition");
        assert.equal(job.status, "FAILED", "supervisor did not fail only the new report-delivery task");
        assert(completedAt - terminal.at < 15000, "supervisor did not stop the idle failed review within 15 seconds");
        assert.doesNotMatch(result.stderr, /Mock task provider (?:timed out|failed)/,
          "fixture exit or watchdog substituted for automatic supervisor shutdown");
        assert(!processAlive(calls[1].pid), "failed native reviewer survived supervisor exit");
        if (process.platform !== "win32") assert(events.some(item => item.phase === "reviewer" && item.event === "stopped"),
          "native reviewer exited without a supervisor shutdown signal");
      }
    }
    console.log("Task supervisor process case: PASS (" + name + ")");
  }
  console.log("Task Context Supervisor smoke: PASS (" + process.platform + "; mock process integration, no live AI review)");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  assert.deepEqual(fs.readFileSync(fixtureSource), fixtureSourceBytes, "process smoke modified tracked fixture bytes");
  assert.equal(fs.statSync(fixtureSource).mode, fixtureSourceMode, "process smoke modified tracked fixture mode");
}
