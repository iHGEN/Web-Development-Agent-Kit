#!/usr/bin/env node
// Verify installed instruction routing; this test does not claim an AI review ran.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
const write = (relative, content) => {
  const file = path.join(project, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const read = relative => fs.readFileSync(path.join(project, relative), "utf8");
const install = command => {
  const result = spawnSync(process.execPath, [path.join(repo, "scripts/agent-kit.mjs"), command, project], {
    cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
};

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
    const route = managed.split("\n").find(line => /Treat standalone.*review these changes/.test(line));
    assert(route, `${relative}: standalone changes-review trigger missing`);
    assert.match(route, /changes-review\.md/);
    assert.match(route, /fresh native review agent/);
    assert.match(route, /current-session analysis/);
    assert.match(route, /PR readiness: not assessed/);
    assert.doesNotMatch(route, /--task-id <resolved-id>|Missing eligible task\/scope evidence|run.*code-review\.mjs/,
      `${relative}: standalone review still requires the strict task runner`);
    assert.match(managed, /For every PR-bound implementation task.*code-review\.mjs/,
      `${relative}: changes analysis must not replace the strict readiness route`);
    assert.doesNotMatch(managed, /OLD_STANDALONE_REVIEW_ROUTE/, `${relative}: stale installed instructions survived`);
  }
  const configuration = JSON.parse(read(".agent-kit.json"));
  const profile = JSON.parse(read(".agent-core/index/project-profile.json"));
  for (const compatibility of [configuration.ai_compatibility, profile.ai_compatibility]) {
    assert.equal(compatibility.changes_review.rule, ".agent-core/rules/changes-review.md");
    assert.equal(compatibility.changes_review.trigger, "review these changes");
    assert.equal(compatibility.changes_review.mode, "source-analysis");
    assert.equal(compatibility.changes_review.preferred_execution, "fresh-native-agent");
    assert.equal(compatibility.changes_review.fallback_execution, "disclosed-current-session");
    assert.equal(compatibility.changes_review.task_required, false);
    assert.equal(compatibility.changes_review.readiness_evidence, false);
    assert.equal(compatibility.pr_readiness_review_engine, ".agent-core/bin/code-review.mjs");
  }
  assert.deepEqual(fs.readFileSync(path.join(project, ".agent-core/rules/changes-review.md")),
    fs.readFileSync(path.join(repo, "pack/rules/changes-review.md")), "The detailed changes-review rule must actually be installed.");
}

try {
  write("package.json", '{"name":"changes-review-routing-fixture","private":true}\n');
  write("src/feature.js", "export const fixture = 'existing uncommitted work';\n");
  for (const relative of surfaces) {
    const prefix = `# Existing ${relative}\r\n\r\nKeep project-owned instructions — unchanged.\r\n\r\n`;
    const suffix = "\r\n\r\nProject-owned footer: retain exact bytes and spacing.  \r\n";
    originals.set(relative, { prefix, suffix });
    write(relative, `${prefix}${start}\nOLD_STANDALONE_REVIEW_ROUTE\n24. Treat standalone review these changes as requiring --task-id <resolved-id>; run code-review.mjs before analysis.\n${end}${suffix}`);
  }
  // No task, scope, queue, provider configuration, or Git repository is required
  // to install the route that tells an available host to analyze supplied code.
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
  for (const [relative, content] of installed) assert.equal(read(relative), content, `${relative}: repeated update changed the installed instructions`);
  for (const [relative, content] of preserved) assert.equal(read(relative), content, `${relative}: update changed unrelated source/task/scope/queue data`);
  console.log("Changes-review instruction installation/update: PASS (five clients, preserved user content, stale route replacement, idempotency and untouched task state).");
  console.log("This suite verifies installed routing and metadata only; native-agent availability and actual code analysis are not simulated or claimed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
