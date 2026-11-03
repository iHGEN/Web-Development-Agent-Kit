#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(repo, "scripts/npm-release-intent.mjs");
const workflow = fs.readFileSync(path.join(repo, ".github/workflows/publish-npm.yml"), "utf8");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-release-test-")));
const project = path.join(root, "candidate");
fs.mkdirSync(project);
let sequence = 0;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: project, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
    windowsHide: true, ...options,
  });
}
function succeeded(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
  return result.stdout.trim();
}
function git(...args) { return succeeded(run("git", args)); }
function write(relative, contents) { fs.writeFileSync(path.join(project, relative), contents); }
function candidate(version, options = {}) {
  write("VERSION", version + "\n");
  write("package.json", JSON.stringify({
    name: options.name ?? "@ihgen/web-kit", version: options.packageVersion ?? version,
    description: options.description ?? "Release routing fixture",
    scripts: options.scripts ?? {},
  }, null, 2) + "\n");
  git("add", "VERSION", "package.json");
  git("commit", "--allow-empty", "-qm", `fixture ${++sequence}`);
  return git("rev-parse", "HEAD");
}
function intent(eventName, event, options = {}) {
  const eventFile = path.join(root, `event-${++sequence}.json`);
  const output = path.join(root, `output-${sequence}.txt`);
  fs.writeFileSync(eventFile, options.rawEvent ?? JSON.stringify(event));
  fs.writeFileSync(output, "preserved=value\n");
  const result = run(process.execPath, [helper], { env: {
    ...process.env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventFile,
    GITHUB_SHA: git("rev-parse", "HEAD"), GITHUB_OUTPUT: output, ...options.env,
  } });
  const written = fs.readFileSync(output, "utf8");
  if (options.fail) {
    assert.notEqual(result.status, 0, `Unexpected release success: ${result.stdout}`);
    assert.equal(written, "preserved=value\n", "Failed validation must not emit successful job outputs.");
    assert.equal(result.stdout.trim(), "", "Failed validation must not emit a successful JSON result.");
    return result;
  }
  succeeded(result);
  const data = JSON.parse(result.stdout);
  assert.equal(typeof data.release_requested, "boolean");
  assert.equal(typeof data.reason, "string");
  assert.ok(data.reason.length > 0);
  assert.ok(written.includes(`release_requested=${data.release_requested}\n`));
  assert.ok(written.includes(`version=${data.version}\n`));
  assert.ok(written.startsWith("preserved=value\n"));
  return data;
}

// Extract the actual shell bodies; the test never invokes npm publication or a
// hosted workflow. Its only tag operations target a disposable local bare repo.
function step(name) {
  const lines = workflow.split(/\r?\n/);
  const first = lines.indexOf(`      - name: ${name}`);
  assert.notEqual(first, -1, `Missing workflow step: ${name}`);
  let end = first + 1;
  while (end < lines.length && (!lines[end].trim() || /^ {8}/.test(lines[end]))) end++;
  const block = lines.slice(first, end);
  const runAt = block.indexOf("        run: |");
  assert.notEqual(runAt, -1, `Missing shell body: ${name}`);
  return { text: block.join("\n"), script: block.slice(runAt + 1).map(line => line.slice(10)).join("\n") };
}

try {
  git("init", "-q");
  git("config", "user.email", "web-kit-test@example.invalid");
  git("config", "user.name", "Web Kit Tests");
  const base = candidate("1.5.0");
  const metadata = candidate("1.5.0", { scripts: { "test:review-isolation": "node scripts/verify-review-isolation.mjs --portable" } });
  const pr = { pull_request: { base: { sha: base } } };
  const ordinaryPr = intent("pull_request", pr);
  assert.equal(ordinaryPr.release_requested, false, "Adding source scripts must not request a new npm release.");
  assert.equal(ordinaryPr.baseline_version, "1.5.0");
  assert.equal(intent("push", { before: base }).release_requested, false, "Same-version main pushes must not publish.");
  assert.equal(intent("workflow_dispatch", {}).release_requested, true, "Manual dispatch must retain explicit release intent.");

  const candidateBranch = git("branch", "--show-current");
  git("checkout", "-qb", "fixture-target", base);
  write("target-note.txt", "An independent target-branch change\n");
  git("add", "target-note.txt");
  git("commit", "-qm", "advance fixture target");
  const target = git("rev-parse", "HEAD");
  git("checkout", "-q", candidateBranch);
  git("merge", "--no-ff", "-qm", "synthetic PR merge checkout", "fixture-target");
  assert.equal(git("rev-list", "--parents", "-n1", "HEAD").split(" ").length, 3);
  assert.equal(intent("pull_request", { pull_request: { base: { sha: target } } }).release_requested, false,
    "GitHub's synthetic PR merge checkout must compare with its event base.");

  const bump = candidate("1.5.1");
  candidate("1.5.1", { description: "A later commit in the same push" });
  assert.equal(intent("push", { before: metadata }).release_requested, true, "The push baseline must cover all commits in the push.");
  assert.equal(intent("push", { before: bump }).release_requested, false, "Metadata after a prior release commit does not request publication.");
  assert.equal(intent("pull_request", pr).release_requested, true);
  assert.equal(intent("pull_request", pr).version, "1.5.1");

  for (const eventName of ["schedule", "pull_request_target", ""]) intent(eventName, pr, { fail: true });
  for (const sha of [undefined, "", "main", "HEAD", base.slice(0, 7), "0".repeat(40), "f".repeat(40), "a".repeat(64), "--help"]) {
    intent("pull_request", { pull_request: { base: { sha } } }, { fail: true });
    intent("push", { before: sha }, { fail: true });
  }
  for (const rawEvent of ["{", "null", "[]", '"event"']) intent("workflow_dispatch", {}, { rawEvent, fail: true });
  intent("pull_request", pr, { env: { GITHUB_SHA: base }, fail: true });
  intent("pull_request", pr, { env: { GITHUB_SHA: "" }, fail: true });
  intent("pull_request", pr, { env: { GITHUB_EVENT_PATH: path.join(root, "missing-event") }, fail: true });
  intent("pull_request", pr, { env: { GITHUB_OUTPUT: "" }, fail: true });

  const savedVersion = fs.readFileSync(path.join(project, "VERSION"));
  const savedPackage = fs.readFileSync(path.join(project, "package.json"));
  write("VERSION", "1.5.2\n");
  write("package.json", JSON.stringify({ name: "@ihgen/web-kit", version: "1.5.2" }));
  intent("pull_request", pr, { fail: true });
  write("VERSION", savedVersion);
  write("package.json", savedPackage);
  assert.equal(intent("pull_request", pr).release_requested, true);

  candidate("1.4.9");
  intent("pull_request", pr, { fail: true });
  intent("push", { before: base }, { fail: true });
  for (const version of ["1.5", "v1.5.0", "01.5.0", "1.5.0-beta.1", "1.5.0+build"]) {
    candidate(version);
    intent("workflow_dispatch", {}, { fail: true });
  }
  const wrongIdentity = candidate("1.5.0", { name: "other-package" });
  intent("workflow_dispatch", {}, { fail: true });
  const mismatch = candidate("1.5.0", { packageVersion: "1.5.1" });
  intent("workflow_dispatch", {}, { fail: true });
  fs.unlinkSync(path.join(project, "VERSION"));
  git("add", "-u");
  git("commit", "-qm", "missing baseline version");
  const missingVersion = git("rev-parse", "HEAD");
  candidate("1.5.1");
  for (const sha of [wrongIdentity, mismatch, missingVersion]) {
    intent("pull_request", { pull_request: { base: { sha } } }, { fail: true });
    intent("push", { before: sha }, { fail: true });
  }

  const registry = step("Confirm npm release availability");
  assert.match(registry.text, /^        if: steps\.release_intent\.outputs\.release_requested == 'true'$/m);
  assert.match(workflow, /^      release_requested: \$\{\{ steps\.release_intent\.outputs\.release_requested \}\}$/m);
  assert.match(workflow, /^        id: release_intent$/m);
  assert.match(workflow, /^        run: node scripts\/npm-release-intent\.mjs$/m);
  assert.match(step("Run relevant release tests").script, /^node tests\/npm-release-intent-smoke\.mjs$/m);
  const publish = workflow.slice(workflow.indexOf("\n  publish:"));
  const condition = /^    if: (.+)((?:\n      .+)*)/m.exec(publish);
  assert.ok(condition, "Publish job must have an explicit condition.");
  const expression = [condition[1] === ">-" ? "" : condition[1], condition[2]].join(" ").trim().replace(/\s+/g, " ");
  assert.equal(expression, "needs.validate.outputs.release_requested == 'true' && github.event_name != 'pull_request' && github.ref == 'refs/heads/main'");
  for (const eventBlock of [
    workflow.slice(workflow.indexOf("\n  pull_request:"), workflow.indexOf("\n  push:")),
    workflow.slice(workflow.indexOf("\n  push:"), workflow.indexOf("\n  workflow_dispatch:")),
  ]) {
    for (const file of ["scripts/npm-release-intent.mjs", "tests/npm-release-intent-smoke.mjs"]) {
      assert.ok(eventBlock.includes(`      - "${file}"`), `Workflow event must validate changes to ${file}.`);
    }
  }

  const bin = path.join(root, "fake-bin");
  fs.mkdirSync(bin);
  const npmLog = path.join(root, "npm.log");
  const scenarioFile = path.join(root, "registry-scenario.json");
  fs.writeFileSync(path.join(bin, "npm"), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.WEB_KIT_RELEASE_TEST_NPM_LOG, JSON.stringify(args) + '\\n');
const scenario = JSON.parse(fs.readFileSync(process.env.WEB_KIT_RELEASE_TEST_SCENARIO, 'utf8'));
if (args.join(' ') === 'ping') process.exit(scenario.pingStatus || 0);
if (args.join(' ') === 'view @ihgen/web-kit version --json') {
  console.log(JSON.stringify(scenario.latest)); process.exit(0);
}
if (args.length === 4 && args[0] === 'view' && args[1].startsWith('@ihgen/web-kit@') && args[2] === 'version' && args[3] === '--json') {
  if (Object.hasOwn(scenario, 'rawVersion')) { process.stdout.write(scenario.rawVersion); process.exit(0); }
  if (scenario.lookup === 'published') { console.log(JSON.stringify(args[1].slice('@ihgen/web-kit@'.length))); process.exit(0); }
  console.error(scenario.lookup === 'missing' ? 'npm error code E404: No match found for version' : 'npm error code EAI_AGAIN: registry unavailable');
  process.exit(scenario.lookup === 'missing' ? 1 : 7);
}
console.error('Unexpected npm operation: ' + args.join(' ')); process.exit(97);
`, { mode: 0o755 });
  function registryCase({ version = "1.5.1", latest = "1.5.0", lookup = "missing", eventName = "pull_request", pingStatus = 0 }) {
    write("VERSION", version + "\n");
    fs.writeFileSync(scenarioFile, JSON.stringify({ latest, lookup, pingStatus }));
    fs.writeFileSync(npmLog, "");
    const output = path.join(root, `registry-output-${++sequence}`);
    fs.writeFileSync(output, "");
    const result = run("bash", ["-c", registry.script], { env: {
      ...process.env, PATH: bin + path.delimiter + process.env.PATH,
      GITHUB_EVENT_NAME: eventName, GITHUB_OUTPUT: output,
      WEB_KIT_RELEASE_TEST_NPM_LOG: npmLog, WEB_KIT_RELEASE_TEST_SCENARIO: scenarioFile,
    } });
    const calls = fs.readFileSync(npmLog, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    assert.ok(calls.every(args => args[0] === "view" || args[0] === "ping"), "The regression must never invoke npm publication.");
    return { result, calls, output: fs.readFileSync(output, "utf8") };
  }
  const available = registryCase({});
  succeeded(available.result);
  assert.match(available.output, /^already_published=false$/m);
  const duplicate = registryCase({ version: "1.5.0", lookup: "published" });
  assert.notEqual(duplicate.result.status, 0, "A deliberate duplicate PR release must remain rejected.");
  const downgrade = registryCase({ version: "1.4.9", lookup: "missing" });
  assert.notEqual(downgrade.result.status, 0);
  assert.equal(downgrade.calls.length, 2, "Downgrade rejection must occur before the candidate lookup.");
  const network = registryCase({ lookup: "network" });
  assert.equal(network.result.status, 7);
  assert.equal(network.output, "", "Registry failure must not become release availability.");
  const ping = registryCase({ pingStatus: 6 });
  assert.equal(ping.result.status, 6);
  assert.equal(ping.calls.length, 1);
  const rerun = registryCase({ version: "1.5.0", lookup: "published", eventName: "workflow_dispatch" });
  succeeded(rerun.result);
  assert.match(rerun.output, /^already_published=true$/m);

  const remote = path.join(root, "release-remote.git");
  succeeded(run("git", ["init", "--bare", "-q", remote]));
  git("remote", "add", "origin", remote);
  git("tag", "v1.5.0", base);
  git("push", "-q", "origin", "refs/tags/v1.5.0");
  const tagScript = step("Create or verify immutable release tag").script;
  function tagCheck(sha) { return run("bash", ["-c", tagScript], { env: { ...process.env, GITHUB_SHA: sha } }); }
  const sameVersionNewCommit = candidate("1.5.0", { description: "Must not move an existing tag" });
  const oldTag = git("ls-remote", "--tags", "origin", "refs/tags/v1.5.0");
  assert.notEqual(tagCheck(sameVersionNewCommit).status, 0, "An existing tag must reject a different commit.");
  assert.equal(git("ls-remote", "--tags", "origin", "refs/tags/v1.5.0"), oldTag);
  assert.equal(git("rev-list", "-n1", "v1.5.0"), base);
  const newRelease = candidate("1.5.1");
  succeeded(tagCheck(newRelease));
  assert.equal(git("rev-list", "-n1", "v1.5.1"), newRelease);
  const newTag = git("ls-remote", "--tags", "origin", "refs/tags/v1.5.1*");
  succeeded(tagCheck(newRelease));
  assert.equal(git("ls-remote", "--tags", "origin", "refs/tags/v1.5.1*"), newTag);

  // Exercise the actual final workflow step. Replace only its wait command so
  // rejected registry responses still exhaust the real bounded retry loop.
  fs.writeFileSync(path.join(bin, "sleep"), '#!/bin/sh\n[ "$#" -eq 1 ] && [ "$1" = "5" ] || exit 97\nexit 0\n', { mode: 0o755 });
  const verification = step("Verify published package and release tag").script;
  function verifyPublished(rawVersion, expectedSha = newRelease) {
    fs.writeFileSync(scenarioFile, JSON.stringify(rawVersion === undefined ? { lookup: "network" } : { rawVersion }));
    fs.writeFileSync(npmLog, "");
    const result = run("bash", ["-c", verification], { env: {
      ...process.env, PATH: bin + path.delimiter + process.env.PATH,
      GITHUB_SHA: expectedSha, WEB_KIT_RELEASE_TEST_NPM_LOG: npmLog,
      WEB_KIT_RELEASE_TEST_SCENARIO: scenarioFile,
    } });
    const calls = fs.readFileSync(npmLog, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    assert.ok(calls.every(args => args.join(" ") === "view @ihgen/web-kit@1.5.1 version --json"), "Final verification must only query the exact release version.");
    return { result, calls };
  }
  for (const raw of ['"1.5.1"\n', '[\n  "1.5.1"\n]\n']) {
    const verified = verifyPublished(raw);
    succeeded(verified.result);
    assert.equal(verified.calls.length, 1, "Both supported npm JSON shapes should verify immediately.");
    assert.match(verified.result.stdout, /Verified @ihgen\/web-kit@1\.5\.1 on npm/);
  }
  for (const raw of ['"1.5.0"', '[]', '["1.5.1","1.5.1"]', '["1.5.1","1.5.0"]', '[["1.5.1"]]', '{"version":"1.5.1"}', 'null', '{', "", undefined]) {
    const rejected = verifyPublished(raw);
    assert.equal(rejected.result.status, 1, "Unmatched or malformed registry evidence must not verify a release.");
    assert.equal(rejected.calls.length, 12, "Verification retries must remain bounded and must not publish again.");
    assert.match(rejected.result.stderr, /npm registry verification did not observe release 1\.5\.1/);
  }
  const wrongTag = verifyPublished('["1.5.1"]', base);
  assert.notEqual(wrongTag.result.status, 0, "A valid registry response must not bypass the exact tag SHA check.");
  assert.equal(wrongTag.calls.length, 1);
  assert.doesNotMatch(wrongTag.result.stdout, /Verified @ihgen\/web-kit/);
  assert.equal(git("ls-remote", "--tags", "origin", "refs/tags/v1.5.1*"), newTag, "Final verification must leave the release tag unchanged.");

  console.log("npm release intent smoke passed: unchanged-version validation, explicit releases, multi-commit push baselines, invalid evidence rejection, workflow gates, registry safeguards, immutable local tags and string/array publication verification.");
  console.log("Registry responses were mocked; tag operations used a disposable local bare repository. No hosted workflow or npm publication was executed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
