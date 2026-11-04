#!/usr/bin/env node
// Verify the simple installed review route and preserve the separate progress tracker contract.
// This suite does not launch an AI provider; the simple CLI has its own process smoke test.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-changes-routing-"));
const project = path.join(root, "project with spaces");
const start = "<!-- WEB-AGENT-KIT:AI-ROLES:START -->";
const end = "<!-- WEB-AGENT-KIT:AI-ROLES:END -->";
const surfaces = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md", ".cursor/rules/ihgen-web-kit.mdc"];
const originals = new Map();
const env = { ...process.env, WEB_KIT_DISABLE_CONTEXT_SUPERVISOR: "1", WEB_KIT_DISABLE_SHELL_PROFILE: "1" };
const unavailableCommands = path.join(root, "empty-command-path");
const write = (relative, content) => {
  const file = path.join(project, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const read = relative => fs.readFileSync(path.join(project, relative), "utf8");
const readJob = taskId => JSON.parse(read(`.agent-core/state/jobs/${taskId}.json`));
const install = command => {
  const result = spawnSync(process.execPath, [path.join(repo, "scripts/agent-kit.mjs"), command, project], {
    cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
};
const progress = (args, expectFailure = false) => {
  // Node is invoked by absolute path; Git and provider CLIs are unavailable.
  const result = spawnSync(process.execPath, [path.join(project, ".agent-core/bin/work-progress.mjs"), ...args, "--project", project], {
    cwd: project, env: { ...env, PATH: unavailableCommands }, encoding: "utf8", windowsHide: true,
    timeout: 30000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.ifError(result.error);
  if (expectFailure) {
    assert.notEqual(result.status, 0, `Expected tracker rejection: ${args.join(" ")}`);
    return result;
  }
  assert.equal(result.status, 0, `Tracker ${args[0]} failed:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
};

function snapshotFiles(relative) {
  const files = new Map();
  const visit = directory => {
    for (const entry of fs.readdirSync(path.join(project, directory), { withFileTypes: true })) {
      const file = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else files.set(file, fs.readFileSync(path.join(project, file)));
    }
  };
  visit(relative);
  return files;
}

function assertPreserved(files, message) {
  for (const [relative, content] of files) {
    assert.deepEqual(fs.readFileSync(path.join(project, relative)), Buffer.from(content), `${relative}: ${message}`);
  }
}

function verifyInstructions() {
  for (const relative of surfaces) {
    const text = read(relative);
    const original = originals.get(relative);
    const first = text.indexOf(start);
    const last = text.indexOf(end, first);
    assert(first >= 0 && last > first, `${relative}: managed instructions missing`);
    assert.equal(text.indexOf(start, first + start.length), -1, `${relative}: duplicate managed block`);
    assert.equal(text.slice(0, first), original.prefix, `${relative}: user-owned prefix changed`);
    assert.equal(text.slice(last + end.length), original.suffix, `${relative}: user-owned suffix changed`);
    const managed = text.slice(first, last);
    const route = managed.split("\n").find(line => line.includes("review these changes") && line.includes("changes-review.md"));
    assert(route, `${relative}: standalone changes-review trigger missing`);
    assert.match(route, /changes-review\.mjs/, "simple direct reviewer route missing");
    assert.match(route, /independent fresh ephemeral read-only Codex reviewer/, "fresh read-only reviewer missing");
    assert.match(route, /ONLY current staged, unstaged and relevant untracked changes/, "review scope was not kept to current changes");
    assert.match(route, /--auto-fix=true/, "explicit automatic fixer route missing");
    assert.match(managed, /@autofix/, "chat auto-fix tag missing");
    assert.match(managed, /without review task\/handoff\/request\/receipt files/,
      "simple review still creates tracking artifacts");
    assert.doesNotMatch(route, /invoke `node \.agent-core\/bin\/task-handoff\.mjs|context-supervisor\.mjs launches|new SMALL/,
      `${relative}: standalone review still routes through legacy task bookkeeping`);
    assert.match(managed, /For every PR-bound implementation task.*code-review\.mjs/,
      `${relative}: changes analysis must not replace the strict readiness route`);
    assert.doesNotMatch(managed, /OLD_STANDALONE_REVIEW_ROUTE/, `${relative}: stale installed instructions survived`);
  }
  const configuration = JSON.parse(read(".agent-kit.json"));
  const profile = JSON.parse(read(".agent-core/index/project-profile.json"));
  const expectedRoute = {
    rule: ".agent-core/rules/changes-review.md",
    trigger: "review these changes",
    mode: "source-analysis",
    execution: "fresh-independent-codex-cli",
    fresh_session_required: true,
    same_session_fallback: false,
    review_command: ".agent-core/bin/changes-review.mjs",
    review_files_created: false,
    auto_fix_flag: "--auto-fix=true",
    auto_fix_tags: ["@autofix", "#autofix"],
    auto_fix_isolated_worktree: true,
    auto_pr_requires_readiness: true,
    existing_task_required: false,
    readiness_evidence: false,
  };
  for (const compatibility of [configuration.ai_compatibility, profile.ai_compatibility]) {
    assert.deepEqual(compatibility.changes_review, expectedRoute);
    assert.equal(compatibility.pr_readiness_review_engine, ".agent-core/bin/code-review.mjs");
  }
  assert(fs.existsSync(path.join(project, expectedRoute.review_command)), "Simple review command must be installed");
  assert(fs.existsSync(path.join(project, ".agent-core/bin/changes-autofix.mjs")), "Auto-fix continuation must be installed");
  const policy = JSON.parse(read(".agent-core/routing/context-policy.json"));
  assert.equal(policy.session_control.standalone_changes_review_engine, expectedRoute.review_command);
  assert.match(policy.session_control.new_task_rule, /separate from the 50% context threshold/);
  assert.match(policy.session_control.new_task_rule, /--auto-fix=true/);
  assert.match(policy.session_control.new_task_completion_rule, /fresh-thread event.*completed turn/);
  assert.match(policy.session_control.claude.new_task_boundary, /Notification idle_prompt/);
  assert.deepEqual(fs.readFileSync(path.join(project, ".agent-core/rules/changes-review.md")),
    fs.readFileSync(path.join(repo, "pack/rules/changes-review.md")), "The detailed changes-review rule must actually be installed.");
}

function verifyReportOnlyTask(job) {
  assert.equal(job.classification, "SMALL");
  assert.equal(job.pr_bound, false, "Report delivery must not certify an implementation task");
  assert.equal(job.governance.plan_required, false);
  assert.equal(job.quality.required, false);
  assert.deepEqual(job.quality.requirements, []);
  assert.deepEqual(job.quality.required_checks, []);
  assert.deepEqual(job.quality.checks, []);
  assert.equal(job.review.status, "PENDING", "Report delivery must not mark the source review as passing");
  assert.equal(job.quality.code_review.status, "PENDING", "Report delivery must not create code approval evidence");
  assert.equal(job.quality.code_review.report_path, undefined);
  assert.equal(job.quality.review_attempt, undefined);
  assert.equal(job.evidence.files_changed, 0);
  assert.equal(job.evidence.tests_total, 0);
  assert.equal(job.evidence.build, "UNKNOWN");
  assert(!fs.existsSync(path.join(project, ".agent-core/state/scope", `${job.task_id}.json`)), "Review-only task acquired a scope prerequisite");
}

try {
  fs.mkdirSync(unavailableCommands);
  write("package.json", '{"name":"changes-review-routing-fixture","private":true}\n');
  write("src/feature.js", "export const fixture = 'existing uncommitted work';\n// Empty price lists must total 0.\nexport function sumPrices(prices) {\n  return prices.reduce((total, price) => total + price);\n}\n");
  for (const relative of surfaces) {
    const prefix = `# Existing ${relative}\r\n\r\nKeep project-owned instructions — unchanged.\r\n\r\n`;
    const suffix = "\r\n\r\nProject-owned footer: retain exact bytes and spacing.  \r\n";
    originals.set(relative, { prefix, suffix });
    write(relative, `${prefix}${start}\nOLD_STANDALONE_REVIEW_ROUTE\n24. Treat standalone review these changes as requiring --task-id <resolved-id>; run code-review.mjs before analysis.\n${end}${suffix}`);
  }
  // Installing instructions is not itself a request to perform a review.
  install("install");
  verifyInstructions();
  for (const name of ["jobs", "scope", "reviews"]) {
    const directory = path.join(project, ".agent-core/state", name);
    assert(!fs.existsSync(directory) || fs.readdirSync(directory).length === 0, `${name}: installation created review task state`);
  }

  const preserved = new Map([
    ["src/feature.js", read("src/feature.js")],
    [".agent-core/state/jobs/host-handover.json", '{"task_id":"host-handover","status":"REVIEWING","pr_bound":true}\n'],
    [".agent-core/state/scope/host-handover.json", '{"base":"unavailable-old-base","allowed_paths":["src/other.js"]}\n'],
    [".agent-core/state/reviews/current-uncommitted-20261103/queue.json", '{"tasks":["capacity","handover","loading","joining","recovery","exit","dialogs"],"status":"BLOCKED"}\n'],
  ]);
  for (const [relative, content] of preserved) write(relative, content);
  const installed = new Map(surfaces.map(relative => [relative, read(relative)]));
  install("update");
  verifyInstructions();
  assertPreserved(installed, "repeated update changed the installed instructions");
  assertPreserved(preserved, "update changed unrelated source/task/scope/queue data");

  assert(!fs.existsSync(path.join(project, ".git")), "The lifecycle fixture must not depend on a Git repository");
  assert.deepEqual(fs.readdirSync(unavailableCommands), [], "Lifecycle fixture unexpectedly has commands on PATH");
  const stateBefore = snapshotFiles(".agent-core/state");
  const allowedNewState = new Set([".agent-core/state/metrics/workflow-efficiency.json"]);
  const deliveredReports = [];
  const taskIds = [];
  const sessions = [];
  const registerRequest = () => {
    const taskId = `changes-review-fixture-${randomUUID()}`;
    const job = progress(["start", "--task-id", taskId, "--classification", "SMALL", "--review-only",
      "--title", "Fixture changes-review report delivery", "--next", "Launch a fresh review session",
      "--evidence", "TEST FIXTURE ONLY: new report-delivery request; no native launch has occurred"]);
    assert.equal(job.task_id, taskId);
    assert.equal(job.status, "QUEUED");
    assert.equal(job.final_validation.status, "PENDING");
    assert(!taskIds.includes(taskId), "A repeated review request reused a task ID");
    taskIds.push(taskId);
    allowedNewState.add(`.agent-core/state/jobs/${taskId}.json`);
    verifyReportOnlyTask(job);
    assertPreserved(preserved, "review registration changed pre-existing work");
    return taskId;
  };

  // Exercise the report-task tracker contract twice through the installed
  // runtime; the supervisor now owns these updates in actual review delivery. Session IDs and the delivery sink are explicitly test fixtures:
  // this does not test native launch or independently generated analysis.
  for (let request = 0; request < 2; request += 1) {
    const taskId = registerRequest();
    const sessionId = `fixture-session-${randomUUID()}`;
    assert(!sessions.includes(sessionId));
    sessions.push(sessionId);
    const reviewing = progress(["update", "--task-id", taskId, "--status", "REVIEWING", "--agent", "fixture-reviewer",
      "--evidence", `TEST FIXTURE ONLY: session=${sessionId}; no native provider was launched by this suite`]);
    assert.equal(reviewing.status, "REVIEWING");
    assert(reviewing.evidence.items.some(item => item.value.includes(sessionId)));
    verifyReportOnlyTask(reviewing);
    const pending = fs.readFileSync(path.join(project, `.agent-core/state/jobs/${taskId}.json`));
    const premature = progress(["update", "--task-id", taskId, "--status", "DONE"], true);
    assert.match(premature.stderr, /DONE requires final validation PASS/);
    assert.deepEqual(fs.readFileSync(path.join(project, `.agent-core/state/jobs/${taskId}.json`)), pending);

    const reportPath = `.agent-core/state/reviews/${taskId}/report.md`;
    const report = `# Fixture report\n\nTEST FIXTURE ONLY: authored test report, not output from a native provider.\n\nTask: ${taskId}\nSession: ${sessionId}\n\n## Finding\n\nP2 — src/feature.js:4: sumPrices([]) calls reduce without an initial value, which throws TypeError instead of the documented empty-list total of 0. Supply an initial accumulator of 0. This is a source-analysis fixture; the source was not executed.\n\nCoverage: supplied src/feature.js only. No Git comparison, tests, scope evidence or requirements were supplied; no checks or provider CLI were run.\n\nPR readiness: not assessed\n`;
    write(reportPath, report);
    allowedNewState.add(reportPath);
    assert.equal(readJob(taskId).status, "REVIEWING", "Task completed before fixture report delivery");
    // The in-memory recipient models delivery of the full report exactly once.
    deliveredReports.push({ taskId, sessionId, report: read(reportPath) });
    assert.equal(deliveredReports.filter(item => item.taskId === taskId).length, 1);
    assert.match(deliveredReports.at(-1).report, /P2.*sumPrices\(\[\]\).*TypeError/);
    assert.match(deliveredReports.at(-1).report, /PR readiness: not assessed/);

    const completed = progress(["update", "--task-id", taskId, "--status", "DONE", "--final-validation", "PASS",
      "--next", "Stop; report delivered", "--evidence",
      `TEST FIXTURE ONLY: report=${reportPath} delivered once to the test sink; PASS means report delivery, not code approval; one defect remains`]);
    assert.equal(completed.status, "DONE");
    assert.equal(completed.final_validation.status, "PASS");
    assert.equal(completed.progress, 100);
    assert.deepEqual(completed.review, reviewing.review);
    assert.deepEqual(completed.quality.code_review, reviewing.quality.code_review);
    verifyReportOnlyTask(completed);
    assert.deepEqual(fs.readdirSync(path.join(project, path.dirname(reportPath))), ["report.md"], "Unexpected approval artifact created");
    assertPreserved(preserved, "report completion changed pre-existing work");
    const completedBytes = fs.readFileSync(path.join(project, `.agent-core/state/jobs/${taskId}.json`));
    const duplicate = progress(["start", "--task-id", taskId, "--classification", "SMALL", "--review-only"], true);
    assert.match(duplicate.stderr, /already exists/);
    assert.deepEqual(fs.readFileSync(path.join(project, `.agent-core/state/jobs/${taskId}.json`)), completedBytes,
      "Repeated request overwrote a completed report-delivery task");
  }
  assert.equal(new Set(taskIds).size, 2, "The second review request did not create a distinct task");
  assert.equal(deliveredReports.length, 2);

  const failedTaskId = registerRequest();
  const blocked = progress(["update", "--task-id", failedTaskId, "--status", "BLOCKED", "--next", "Stop; review not started",
    "--evidence", "TEST FIXTURE ONLY: fresh native session launch failed; Review not started; no report delivered"]);
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.final_validation.status, "PENDING");
  verifyReportOnlyTask(blocked);
  const blockedBytes = fs.readFileSync(path.join(project, `.agent-core/state/jobs/${failedTaskId}.json`));
  progress(["update", "--task-id", failedTaskId, "--status", "DONE"], true);
  assert.deepEqual(fs.readFileSync(path.join(project, `.agent-core/state/jobs/${failedTaskId}.json`)), blockedBytes,
    "Launch failure became DONE without report-delivery validation");
  assert.equal(readJob(failedTaskId).status, "BLOCKED");
  assert(!deliveredReports.some(item => item.taskId === failedTaskId));
  assert(!fs.existsSync(path.join(project, ".agent-core/state/reviews", failedTaskId)), "Failed launch created a report or approval artifact");

  const stateAfter = snapshotFiles(".agent-core/state");
  for (const [relative, content] of stateBefore) {
    if (relative !== ".agent-core/state/metrics/workflow-efficiency.json") {
      assert.deepEqual(stateAfter.get(relative), content, `${relative}: lifecycle changed existing state`);
    }
  }
  for (const relative of stateAfter.keys()) {
    assert(stateBefore.has(relative) || allowedNewState.has(relative), `${relative}: unexpected state or approval artifact`);
  }
  assertPreserved(installed, "review lifecycle changed installed instructions");
  assertPreserved(preserved, "review lifecycle changed unrelated source/task/scope/seven-item queue data");
  console.log("Changes-review instruction installation/update: PASS (five clients, exact user content, stale route replacement and idempotency).");
  console.log("Legacy tracking compatibility: PASS (existing fixture records and unrelated work preserved).");
  console.log("Legacy reports above are fixtures; the simple fresh review path has separate process coverage.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
