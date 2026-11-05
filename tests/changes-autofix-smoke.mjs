#!/usr/bin/env node
// End-to-end offline test: independent review -> isolated fix -> fresh re-review -> mock gh PR.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { maskedPackageTestScript } from "../pack/runtime/changes-autofix.mjs";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-auto-fix-test-"));
const project = path.join(root, "Gamehub example");
const remote = path.join(root, "remote.git");
const capture = path.join(root, "created-pr.json");
const reviewPrompt = path.join(root, "review-prompt.txt");
const mockCodex = path.join(source, "tests", "fixtures", "mock-auto-fix-codex.mjs");
const mockGh = path.join(source, "tests", "fixtures", "mock-pr-gh.mjs");
const env = {
  ...process.env,
  WEB_KIT_DISABLE_CONTEXT_SUPERVISOR: "1",
  WEB_KIT_DISABLE_SHELL_PROFILE: "1",
  WEB_KIT_STANDALONE_CODEX_BIN: mockCodex,
  WEB_KIT_REVIEW_GH_BIN: mockGh,
  WEB_KIT_REVIEW_TEST_CAPTURE: capture,
  WEB_KIT_REVIEW_TEST_PROMPT_CAPTURE: reviewPrompt,
};
function run(command, args, cwd = project, overrides = {}) {
  return spawnSync(command, args, { cwd, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024,
    env: { ...env, ...overrides }, windowsHide: true });
}
function ok(command, args, cwd) {
  const result = run(command, args, cwd);
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}
const git = args => ok("git", args);
function cleanIsolatedWorktrees() {
  const worktrees = git(["worktree", "list", "--porcelain"]);
  for (const line of worktrees.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const directory = line.slice("worktree ".length);
    if (directory === project || directory.startsWith(root + path.sep)) continue;
    if (!path.basename(path.dirname(directory)).startsWith("web-kit-auto-fix-")) continue;
    git(["worktree", "remove", "--force", directory]);
    fs.rmdirSync(path.dirname(directory));
  }
}
try {
  // npmrc may select a workspace even for an unqualified `npm test` command.
  // This file can predate the reviewed diff, so no changed-file name scan
  // can substitute for inspecting npm's effective test-script selection.
  const npmrcProject = path.join(root, "npmrc-config-project");
  fs.mkdirSync(path.join(npmrcProject, "packages", "api"), { recursive: true });
  fs.writeFileSync(path.join(npmrcProject, "package.json"), JSON.stringify({ name: "fixture-root",
    private: true, workspaces: ["packages/*"], scripts: { test: "node --test" } }));
  fs.writeFileSync(path.join(npmrcProject, "packages", "api", "package.json"), JSON.stringify({
    name: "fixture-api", scripts: { test: "node --test || true" },
  }));
  fs.writeFileSync(path.join(npmrcProject, ".npmrc"), "workspace=packages/api\n");
  assert.equal(maskedPackageTestScript(npmrcProject, "npm test"), true,
    "A configured npm workspace must not bypass root-script validation");
  fs.writeFileSync(path.join(npmrcProject, ".npmrc"), "script-shell=/bin/sh\n");
  assert.equal(maskedPackageTestScript(npmrcProject, "npm test"), true,
    "A configured npm script interpreter must not bypass root-script validation");
  assert.equal(maskedPackageTestScript(npmrcProject, "bun test"), false,
    "Bun's direct runner does not depend on npm workspace configuration");

  fs.mkdirSync(project);
  fs.mkdirSync(path.join(project, "src"));
  fs.writeFileSync(path.join(project, "src", "feature.js"), "export const safe = false;\n");
  fs.writeFileSync(path.join(project, "package.json"), '{"name":"fixture","private":true}\n');
  ok("git", ["init", "-q", "-b", "main"]);
  git(["config", "user.name", "Web Kit Smoke Test"]);
  git(["config", "user.email", "web-kit-test@example.invalid"]);
  const install = run(process.execPath, [path.join(source, "scripts", "agent-kit.mjs"), "install", project]);
  assert.equal(install.status, 0, install.stderr);
  git(["add", "-A"]);
  git(["-c", "commit.gpgsign=false", "commit", "-qm", "fixture baseline"]);
  ok("git", ["init", "-q", "--bare", "--initial-branch=main", remote], root);
  git(["remote", "add", "origin", remote]);
  git(["push", "-q", "origin", "main"]);
  git(["remote", "set-head", "origin", "-a"]);
  git(["switch", "-q", "-c", "fix/current"]);

  // This earlier branch-only commit is unrelated to the *current* diff and must not reach the new PR.
  fs.writeFileSync(path.join(project, "src", "old-unrelated.js"), "export const old = true;\n");
  git(["add", "src/old-unrelated.js"]);
  git(["-c", "commit.gpgsign=false", "commit", "-qm", "old unrelated feature commit"]);

  fs.writeFileSync(path.join(project, "src", "feature.js"), "export const safe = 'staged A';\n");
  git(["add", "src/feature.js"]);
  fs.writeFileSync(path.join(project, "src", "feature.js"), "export const safe = 'worktree B';\n");
  fs.writeFileSync(path.join(project, "src", "new.js"), "export const newFeature = true;\n");
  const statusBefore = git(["status", "--porcelain=v1"]);
  const stagedBefore = git(["show", ":src/feature.js"]);
  const worktreeBefore = fs.readFileSync(path.join(project, "src", "feature.js"), "utf8");
  const script = path.join(project, ".agent-core", "bin", "changes-review.mjs");
  const args = [path.join(source, "bin", "web-kit-entry.js"), "review", "--project", project,
    "--auto-fix=true", "--request", "Review only current changes; fix confirmed bugs and open PR"];
  const published = run(process.execPath, args);
  assert.equal(published.status, 0, published.stderr);
  assert.match(published.stdout, /Fresh post-fix review/);
  assert.match(published.stdout, /PR: https:\/\/github.com\/fixture\/project\/pull\/123/);
  const initialPrompt = fs.readFileSync(reviewPrompt, "utf8");
  assert.match(initialPrompt, /src\/feature\.js/);
  assert.doesNotMatch(initialPrompt, /old-unrelated\.js/, "Unrelated committed source appeared in current-review scope");
  const created = JSON.parse(fs.readFileSync(capture, "utf8"));
  assert.equal(created.args[created.args.indexOf("--base") + 1], "main");
  const prBody = created.args[created.args.indexOf("--body") + 1];
  assert.match(prBody, /Verification/);
  assert.doesNotMatch(prBody, /P1 verified issue|node --test/, "Potentially sensitive report or command leaked into public PR body");
  const head = created.args[created.args.indexOf("--head") + 1];
  assert.match(head, /^review-fix\//);
  const publishedCode = ok("git", ["--git-dir", remote, "show", `${head}:src/feature.js`], root);
  assert.match(publishedCode, /worktree B/);
  assert.match(publishedCode, /verified patch from isolated fixing session/);
  assert.match(ok("git", ["--git-dir", remote, "show", `${head}:src/new.js`], root), /newFeature/);
  const unrelated = run("git", ["--git-dir", remote, "cat-file", "-e", `${head}:src/old-unrelated.js`], root);
  assert.notEqual(unrelated.status, 0, "An unrelated earlier branch commit entered the new PR");
  assert.equal(git(["status", "--porcelain=v1"]), statusBefore, "Original Git status changed");
  assert.equal(git(["show", ":src/feature.js"]), stagedBefore, "Original staged content changed");
  assert.equal(fs.readFileSync(path.join(project, "src", "feature.js"), "utf8"), worktreeBefore);

  fs.rmSync(capture);
  const audited = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "audit-pass" });
  assert.equal(audited.status, 0, `A successful independent audit should not prevent a verified PR: ${audited.stderr}`);
  assert.match(audited.stdout, /PR: https:\/\/github.com\/fixture\/project\/pull\/123/);
  fs.rmSync(capture);
  const diagnostic = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "rg-no-match" });
  assert.equal(diagnostic.status, 0, `Expected rg no-match must not invalidate passing tests: ${diagnostic.stderr}`);
  assert.match(diagnostic.stdout, /PR: https:\/\/github.com\/fixture\/project\/pull\/123/);
  fs.rmSync(capture);
  const unrelatedEnv = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "env-unrelated-diagnostic" });
  assert.equal(unrelatedEnv.status, 0, `A nonvalidation environment diagnostic must not invalidate real tests: ${unrelatedEnv.stderr}`);
  fs.rmSync(capture);
  for (const mode of ["go-success", "go-verbose-success", "maven-success", "dotnet-success", "noisy-output",
    "node-spec-success", "bun-direct-success"]) {
    const verified = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: mode });
    assert.equal(verified.status, 0, `${mode} must recognize real test execution evidence: ${verified.stderr}`);
    assert.match(verified.stdout, /PR: https:\/\/github.com\/fixture\/project\/pull\/123/);
    fs.rmSync(capture);
  }
  const notReady = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "not-ready" });
  assert.notEqual(notReady.status, 0, "Unresolved high severity finding should stop PR");
  assert.match(notReady.stderr, /Auto-fix NOT READY/);
  assert(!fs.existsSync(capture), "PR command ran despite an unresolved finding");
  assert.equal(git(["status", "--porcelain=v1"]), statusBefore);
  cleanIsolatedWorktrees();

  const tagArgs = args.map(arg => arg === "--auto-fix=true" ? "@autofix" : arg);
  const tagNotReady = run(process.execPath, tagArgs, project, { WEB_KIT_REVIEW_TEST_MODE: "not-ready" });
  assert.notEqual(tagNotReady.status, 0, "@autofix should run the automatic fix-and-PR gate");
  assert.match(tagNotReady.stderr, /Auto-fix NOT READY/);
  assert(!fs.existsSync(capture), "@autofix opened a PR despite an unresolved finding");
  cleanIsolatedWorktrees();

  const noTests = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "no-tests" });
  assert.notEqual(noTests.status, 0, "No test evidence should stop PR");
  assert.match(noTests.stderr, /Required executed test\/check evidence is missing/);
  assert(!fs.existsSync(capture));
  cleanIsolatedWorktrees();

  for (const mode of [
    "help-only", "help-only-short-version", "help-only-npm", "zero-tests", "all-skipped", "go-no-tests",
    "go-package-only", "go-nonmatching-run", "go-nonmatching-json", "go-skipped", "go-cached",
    "maven-skipped", "dotnet-skipped", "node-spec-skipped", "bun-direct-zero",
    "bun-run-missing-script",
  ]) {
    const help = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: mode });
    assert.notEqual(help.status, 0, `${mode} must not count as executed tests`);
    assert.match(help.stderr, /Required executed test\/check evidence is missing/);
    assert(!fs.existsSync(capture), `${mode} opened a PR without executing tests`);
    cleanIsolatedWorktrees();
  }

  const maskedAlongsideReal = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "masked-plus-real" });
  assert.notEqual(maskedAlongsideReal.status, 0, "A masked test must block PR even when another real test succeeds");
  assert.match(maskedAlongsideReal.stderr, /Auto-fix NOT READY/);
  assert(!fs.existsSync(capture));
  cleanIsolatedWorktrees();

  const fakeChecks = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "fake-checks" });
  assert.notEqual(fakeChecks.status, 0, "An echoed test command must not count as executed verification");
  assert.match(fakeChecks.stderr, /Required executed test\/check evidence is missing/);
  assert(!fs.existsSync(capture));
  cleanIsolatedWorktrees();

  const maskedTest = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "masked-test" });
  assert.notEqual(maskedTest.status, 0, "A masked 'npm test || true' must not count as passing tests");
  assert.match(maskedTest.stderr, /Required executed test\/check evidence is missing/);
  assert(!fs.existsSync(capture));
  cleanIsolatedWorktrees();

  for (const mode of ["masked-tap-in-script", "masked-jest", "masked-cargo", "maven-masked-failure", "dotnet-masked-failure", "go-masked-failure",
    "node-spec-masked-failure", "bun-direct-masked-failure"]) {
    const hiddenFailure = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: mode });
    assert.notEqual(hiddenFailure.status, 0, `${mode} must not authorize publication when tests failed inside a successful outer command`);
    assert.match(hiddenFailure.stderr, /Auto-fix NOT READY/);
    assert(!fs.existsSync(capture), `${mode} opened a PR despite failed tests`);
    cleanIsolatedWorktrees();
  }

  const manifest = path.join(project, "package.json");
  const originalManifest = fs.readFileSync(manifest, "utf8");
  for (const [mode, scripts] of [
    ["masked-package-script", { test: "node --test || true" }],
    ["masked-nested-package-script", { test: "npm run unit", unit: "node --test || true" }],
    ["masked-chained-package-script", {
      test: "npm run unit && npm run integration",
      unit: "node --test --test-reporter=tap test/unit.test.js",
      integration: "node --test --test-reporter=tap test/integration.test.js > /dev/null 2>&1 || true",
    }],
    ["masked-pretest-lifecycle", {
      pretest: "node test/security-check.mjs > /dev/null 2>&1 || true",
      test: "node --test",
    }],
    ["masked-posttest-lifecycle", {
      test: "node --test",
      posttest: "node test/integration-check.mjs > /dev/null 2>&1 || true",
    }],
    ["masked-nested-lifecycle", {
      test: "npm run unit && node --test",
      preunit: "node test/audit.mjs > /dev/null 2>&1 || true",
      unit: "node --test",
    }],
  ]) {
    fs.writeFileSync(manifest, JSON.stringify({ name: "fixture", private: true, scripts }));
    const branchesBefore = ok("git", ["--git-dir", remote, "for-each-ref", "--format=%(refname):%(objectname)",
      "refs/heads/review-fix"], root);
    const hiddenScript = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: mode });
    assert.notEqual(hiddenScript.status, 0, `${mode} must reject masking in the npm package script`);
    assert.match(hiddenScript.stderr, /Auto-fix NOT READY/);
    assert(!fs.existsSync(capture), `${mode} created a PR from a masked script`);
    assert.equal(ok("git", ["--git-dir", remote, "for-each-ref", "--format=%(refname):%(objectname)",
      "refs/heads/review-fix"], root), branchesBefore, `${mode} pushed a branch despite masked tests`);
    fs.writeFileSync(manifest, originalManifest);
    cleanIsolatedWorktrees();
  }
  // Fail-fast chains with *both* test scripts verifiable must still work.
  fs.writeFileSync(manifest, JSON.stringify({ name: "fixture", private: true, scripts: {
    test: "npm run unit && npm run integration",
    unit: "node --test --test-reporter=tap test/unit.test.js",
    integration: "node --test --test-reporter=tap test/integration.test.js",
  } }));
  const safeChain = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "safe-chained-package-script" });
  assert.equal(safeChain.status, 0, `A fully checked fail-fast npm script chain should pass: ${safeChain.stderr}`);
  assert.match(safeChain.stdout, /PR: https:\/\/github.com\/fixture\/project\/pull\/123/);
  fs.rmSync(capture);
  fs.writeFileSync(manifest, originalManifest);
  cleanIsolatedWorktrees();
  // Safe implicit hooks must not block an otherwise valid npm test.
  fs.writeFileSync(manifest, JSON.stringify({ name: "fixture", private: true, scripts: {
    pretest: "node --test", test: "npm run unit", posttest: "node --test",
    preunit: "node --test", unit: "node --test", postunit: "node --test",
  } }));
  const safeLifecycle = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "safe-lifecycle" });
  assert.equal(safeLifecycle.status, 0, `Safe npm lifecycle scripts should pass: ${safeLifecycle.stderr}`);
  assert.match(safeLifecycle.stdout, /PR: https:\/\/github.com\/fixture\/project\/pull\/123/);
  fs.rmSync(capture);
  fs.writeFileSync(manifest, originalManifest);
  cleanIsolatedWorktrees();
  // A workspace-scoped npm invocation must inspect the selected package,
  // not the safe root test script. Include name, directory, short/repeated
  // selectors, --workspaces, and implicit lifecycle hooks.
  const workspaceRoot = path.join(project, "packages");
  const apiWorkspace = path.join(workspaceRoot, "api");
  const webWorkspace = path.join(workspaceRoot, "web");
  fs.mkdirSync(apiWorkspace, { recursive: true });
  fs.mkdirSync(webWorkspace, { recursive: true });
  fs.writeFileSync(manifest, JSON.stringify({ name: "fixture", private: true,
    workspaces: ["packages/*"], scripts: { test: "node --test" } }));
  const apiManifest = path.join(apiWorkspace, "package.json");
  const safeWorkspaceScripts = { pretest: "node --test", test: "node --test", posttest: "node --test" };
  const maskedWorkspaceScripts = {
    test: "npm run unit && npm run integration",
    unit: "node --test --test-reporter=tap test/unit.test.js",
    integration: "node --test --test-reporter=tap test/integration.test.js > /dev/null 2>&1 || true",
  };
  const writeApiScripts = scripts => fs.writeFileSync(apiManifest, JSON.stringify({ name: "@fixture/api", scripts }));
  writeApiScripts(maskedWorkspaceScripts);
  fs.writeFileSync(path.join(webWorkspace, "package.json"), JSON.stringify({ name: "@fixture/web", scripts: safeWorkspaceScripts }));
  for (const mode of ["masked-workspace-script", "masked-workspace-short-selector", "masked-workspace-repeated",
    "masked-workspace-all", "masked-workspace-parent", "masked-workspace-lifecycle",
    "masked-nested-workspace-selector", "unsupported-workspace-selector"]) {
    if (mode === "masked-workspace-lifecycle") {
      writeApiScripts({ pretest: "node test/security-check.mjs > /dev/null 2>&1 || true", test: "node --test" });
    } else if (mode === "masked-nested-workspace-selector") {
      writeApiScripts({ test: "npm run test --workspace=packages/web" });
      fs.writeFileSync(path.join(webWorkspace, "package.json"), JSON.stringify({ name: "@fixture/web", scripts: maskedWorkspaceScripts }));
    } else writeApiScripts(maskedWorkspaceScripts);
    const branchesBefore = ok("git", ["--git-dir", remote, "for-each-ref", "--format=%(refname):%(objectname)",
      "refs/heads/review-fix"], root);
    const result = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: mode });
    assert.notEqual(result.status, 0, `${mode} must block unsafe or unresolved workspace test scripts`);
    assert.match(result.stderr, /Auto-fix NOT READY/);
    assert(!fs.existsSync(capture), `${mode} created a PR with unsafe workspace checks`);
    assert.equal(ok("git", ["--git-dir", remote, "for-each-ref", "--format=%(refname):%(objectname)",
      "refs/heads/review-fix"], root), branchesBefore, `${mode} pushed a branch`);
    if (mode === "masked-nested-workspace-selector") {
      fs.writeFileSync(path.join(webWorkspace, "package.json"), JSON.stringify({ name: "@fixture/web", scripts: safeWorkspaceScripts }));
    }
    cleanIsolatedWorktrees();
  }
  // A single explicitly selected safe workspace must pass even if a different
  // workspace has unsafe scripts; --workspaces must validate them all.
  for (const mode of ["safe-workspace", "safe-workspace-all"]) {
    if (mode === "safe-workspace-all") writeApiScripts(safeWorkspaceScripts);
    const result = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: mode });
    assert.equal(result.status, 0, `${mode} must accept verifiably safe npm workspace scripts: ${result.stderr}`);
    assert.match(result.stdout, /PR: https:\/\/github.com\/fixture\/project\/pull\/123/);
    fs.rmSync(capture);
    cleanIsolatedWorktrees();
  }
  // An inline npm_config_workspace assignment changes the actual npm script
  // even though the root package has a safe test script. Both direct and
  // shell-wrapped assignments must fail closed; an opaque `env` wrapper must
  // not be ignored when another genuine test also passes.
  writeApiScripts(maskedWorkspaceScripts);
  for (const mode of ["masked-workspace-env", "masked-workspace-env-shell", "masked-workspace-env-with-real",
    "masked-workspace-env-absolute", "masked-workspace-prefixed-shell"]) {
    const branchesBefore = ok("git", ["--git-dir", remote, "for-each-ref", "--format=%(refname):%(objectname)",
      "refs/heads/review-fix"], root);
    const result = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: mode });
    assert.notEqual(result.status, 0, `${mode} must reject an unverified environment-selected workspace test`);
    assert.match(result.stderr, /Auto-fix NOT READY/);
    assert(!fs.existsSync(capture), `${mode} created a PR with masked workspace tests`);
    assert.equal(ok("git", ["--git-dir", remote, "for-each-ref", "--format=%(refname):%(objectname)",
      "refs/heads/review-fix"], root), branchesBefore, `${mode} pushed a branch`);
    cleanIsolatedWorktrees();
  }
  fs.writeFileSync(manifest, originalManifest);
  fs.rmSync(workspaceRoot, { recursive: true });
  assert.equal(git(["status", "--porcelain=v1"]), statusBefore, "Workspace fixtures must leave original edits intact");
  assert.equal(git(["status", "--porcelain=v1"]), statusBefore, "Script masking tests must restore the original project");

  const failedAudit = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "failed-audit" });
  assert.notEqual(failedAudit.status, 0, "A failed security audit must invalidate otherwise green test evidence");
  assert.match(failedAudit.stderr, /Required executed test\/check evidence is missing/);
  assert(!fs.existsSync(capture));
  cleanIsolatedWorktrees();

  const staleTest = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "stale-test" });
  assert.notEqual(staleTest.status, 0, "Post-test source mutations must invalidate the verified snapshot");
  assert.match(staleTest.stderr, /Verification changed the source snapshot/);
  assert(!fs.existsSync(capture));
  cleanIsolatedWorktrees();

  const contradictory = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "contradictory" });
  assert.notEqual(contradictory.status, 0, "Final NOT READY must override an earlier READY line");
  assert.match(contradictory.stderr, /Auto-fix NOT READY/);
  assert(!fs.existsSync(capture));
  cleanIsolatedWorktrees();
  for (const mode of ["contradictory-findings", "contradictory-numbered", "contradictory-table", "contradictory-heading", "contradictory-json", "missing-unresolved-json"]) {
    const contradiction = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: mode });
    assert.notEqual(contradiction.status, 0, `${mode} must block a contradictory READY report`);
    assert.match(contradiction.stderr, /Auto-fix NOT READY/);
    assert(!fs.existsSync(capture), `${mode} created a PR despite unresolved findings`);
    cleanIsolatedWorktrees();
  }

  const escaped = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "out-of-scope" });
  assert.notEqual(escaped.status, 0, "An unrelated production file must block auto PR");
  assert.match(escaped.stderr, /outside the approved current-diff\/test scope/);
  assert(!fs.existsSync(capture));
  cleanIsolatedWorktrees();

  // Entry-point modules are valid test targets within the same package.
  for (const entry of ["index", "main", "app"]) {
    const entrySource = path.join(project, "src", `${entry}.ts`);
    fs.writeFileSync(entrySource, `export const ${entry}Function = true;\n`);
    const related = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: `related-${entry}-test` });
    assert.equal(related.status, 0, `A test for a changed ${entry} module should be allowed: ${related.stderr}`);
    assert.match(related.stdout, /PR: https:\/\/github.com\/fixture\/project\/pull\/123/);
    assert(!fs.existsSync(path.join(project, "tests", `${entry}.test.ts`)), "Isolated tests must not alter the original project");
    fs.rmSync(entrySource);
    fs.rmSync(capture);
    cleanIsolatedWorktrees();
  }

  // Identical module names in independent packages must NOT expand the fix scope.
  const frontendDirectory = path.join(project, "frontend", "src");
  fs.mkdirSync(frontendDirectory, { recursive: true });
  const frontendAuth = path.join(frontendDirectory, "auth.ts");
  fs.writeFileSync(frontendAuth, "export const authFunction = true;\n");
  const crossPackage = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "cross-package-test" });
  assert.notEqual(crossPackage.status, 0, "Backend tests may not be introduced for a frontend-only auth change");
  assert.match(crossPackage.stderr, /outside the approved current-diff\/test scope/);
  assert(!fs.existsSync(capture), "A cross-package test bypassed the scope check");
  fs.rmSync(frontendAuth);
  cleanIsolatedWorktrees();
  assert.equal(git(["status", "--porcelain=v1"]), statusBefore, "Scope tests must restore the original worktree");

  const unrelatedTest = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "out-of-scope-test" });
  assert.notEqual(unrelatedTest.status, 0, "A test unrelated to changed modules must not enter the automatic PR");
  assert.match(unrelatedTest.stderr, /outside the approved current-diff\/test scope/);
  assert(!fs.existsSync(capture));
  cleanIsolatedWorktrees();

  const stageRace = run(process.execPath, args, project, { WEB_KIT_REVIEW_TEST_MODE: "stage-race" });
  assert.notEqual(stageRace.status, 0, "Staged A->C while worktree B stays the same must invalidate review snapshot");
  assert.match(stageRace.stderr, /original changes moved during review/i);
  assert(!fs.existsSync(capture));
  assert.equal(fs.readFileSync(path.join(project, "src", "feature.js"), "utf8"), worktreeBefore);
  assert.match(git(["show", ":src/feature.js"]), /staged C/);
  fs.writeFileSync(path.join(project, "src", "feature.js"), "export const safe = 'staged A';\n");
  git(["add", "src/feature.js"]);
  fs.writeFileSync(path.join(project, "src", "feature.js"), worktreeBefore);
  assert.equal(git(["show", ":src/feature.js"]), stagedBefore);

  if (process.platform !== "win32") {
    const commitHook = path.join(project, ".git", "hooks", "pre-commit");
    fs.writeFileSync(commitHook, "#!/bin/sh\nprintf '// changed by commit hook\\n' >> src/feature.js\ngit add src/feature.js\n");
    fs.chmodSync(commitHook, 0o755);
    const hookChanged = run(process.execPath, args);
    assert.notEqual(hookChanged.status, 0, "Commit hook mutation must not be published without re-review");
    assert.match(hookChanged.stderr, /Commit hooks changed reviewed content/);
    assert(!fs.existsSync(capture));
    fs.rmSync(commitHook);
    cleanIsolatedWorktrees();
  }

  // No credential store may be pushed, even when its contents are plain UTF-8
  // and contain no recognized vendor-specific token prefix.
  for (const name of [
    "src/.netrc", "src/nested/.aws/credentials", "src/nested/.kube/config",
    "src/nested/.docker/config.json", "src/config/credentials.json",
  ]) {
    const file = path.join(project, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "machine internal.example login service-bot password private-workflow-passphrase-123\n");
    const beforePush = ok("git", ["--git-dir", remote, "for-each-ref", "--format=%(refname)", "refs/heads/review-fix"], root);
    const rejected = run(process.execPath, args);
    assert.notEqual(rejected.status, 0, `Sensitive file ${name} must block automatic PR publication`);
    assert.match(rejected.stderr, /sensitive credential-like filenames|credential-like files/);
    assert(!fs.existsSync(capture), `${name} created a PR`);
    assert.equal(ok("git", ["--git-dir", remote, "for-each-ref", "--format=%(refname)", "refs/heads/review-fix"], root), beforePush,
      `${name} pushed a branch before the sensitive file check`);
    fs.rmSync(file);
    cleanIsolatedWorktrees();
  }
  assert.equal(git(["status", "--porcelain=v1"]), statusBefore, "Sensitive-file tests must preserve Git status");

  const credentialFixture = path.join(project, "src", "demo-credential.js");
  fs.writeFileSync(credentialFixture, "export const dummy = 'github_pat_abcdefghijklmnopqrstuvwxyz0123456789';\n");
  const credential = run(process.execPath, args);
  assert.notEqual(credential.status, 0, "New credential-like content must prevent automatic publication");
  assert.match(credential.stderr, /Potential credential material detected/);
  assert(!fs.existsSync(capture));
  fs.rmSync(credentialFixture);
  cleanIsolatedWorktrees();

  const providerKey = run(process.execPath, args, project, {
    WEB_KIT_REVIEW_TEST_MODE: "provider-key-leak",
    OPENAI_API_KEY: "sk-proj-synthetic-for-test-only-abcdefghijklmnopq",
  });
  assert.notEqual(providerKey.status, 0, "Synthetic provider credential copied into source must block publication");
  assert.match(providerKey.stderr, /Potential credential material detected/);
  assert(!fs.existsSync(capture));
  cleanIsolatedWorktrees();

  const archive = path.join(project, "src", "debug.zip");
  fs.writeFileSync(archive, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), Buffer.from("github_pat_abcdefghijklmnopqrstuvwxyz0123456789")]));
  const binary = run(process.execPath, args);
  assert.notEqual(binary.status, 0, "A binary artifact with embedded credentials must not be auto-published");
  assert.match(binary.stderr, /Uninspectable or binary file/);
  assert(!fs.existsSync(capture));
  fs.rmSync(archive);
  cleanIsolatedWorktrees();

  const badSelection = run(process.execPath, [script, "--auto-fix", "--selection", "src/feature.js"]);
  assert.notEqual(badSelection.status, 0);
  assert.match(badSelection.stderr, /omit --selection/);
  assert.equal(git(["status", "--porcelain=v1"]), statusBefore);

  const noFixNoPr = run(process.execPath, [script, "--no-pr"]);
  assert.notEqual(noFixNoPr.status, 0, "--no-pr must require an explicit auto-fix request");
  assert.match(noFixNoPr.stderr, /--no-pr requires/);

  git(["remote", "remove", "origin"]); // Local-only fixes must work offline, without a GitHub remote.
  const noPrArgs = args.map(arg => arg === "--auto-fix=true" ? "@autofix" : arg);
  noPrArgs.push("--no-pr");
  const unrelatedLocalTest = run(process.execPath, noPrArgs, project, { WEB_KIT_REVIEW_TEST_MODE: "out-of-scope-test" });
  assert.notEqual(unrelatedLocalTest.status, 0, "Local-only fix must refuse unrelated test changes");
  assert.match(unrelatedLocalTest.stderr, /outside the approved current-diff\/test scope/);
  assert.equal(fs.readFileSync(path.join(project, "src", "feature.js"), "utf8"), worktreeBefore);
  assert.equal(git(["show", ":src/feature.js"]), stagedBefore);
  cleanIsolatedWorktrees();
  const localTarget = path.join(project, "src", "feature.js");
  const originalLocalBytes = fs.readFileSync(localTarget);
  const originalLocalMode = fs.statSync(localTarget).mode & 0o777;
  if (process.platform !== "win32") {
    const modeOnly = run(process.execPath, noPrArgs, project, { WEB_KIT_REVIEW_TEST_MODE: "local-mode-only" });
    assert.equal(modeOnly.status, 0, `Mode-only verified fixes must apply locally: ${modeOnly.stderr}`);
    assert.match(modeOnly.stdout, /COMPLETED LOCALLY/);
    assert(fs.readFileSync(localTarget).equals(originalLocalBytes), "Mode-only fixes must not alter file contents");
    assert.equal(fs.statSync(localTarget).mode & 0o777, 0o755, "The verified executable-bit change was lost");
    assert.equal(git(["show", ":src/feature.js"]), stagedBefore, "Mode-only changes must not touch the staged index");
    fs.chmodSync(localTarget, originalLocalMode);
    cleanIsolatedWorktrees();
  }
  const partialWrite = run(process.execPath, noPrArgs, project, {
    WEB_KIT_REVIEW_TEST_MODE: "local-write-error", WEB_KIT_REVIEW_TEST_LOCAL_WRITE_FAILURE: "1",
  });
  assert.notEqual(partialWrite.status, 0, "An injected partial local write must fail closed");
  assert.match(partialWrite.stderr, /Injected partial replacement write failure/);
  assert(fs.readFileSync(localTarget).equals(originalLocalBytes), "Partial write must not truncate the original user file");
  assert.equal(fs.statSync(localTarget).mode & 0o777, originalLocalMode);
  assert.equal(git(["show", ":src/feature.js"]), stagedBefore);
  assert(!fs.readdirSync(path.dirname(localTarget)).some(name => name.startsWith(".web-kit-autofix-")),
    "Failed preparation left temporary user-directory files behind");
  cleanIsolatedWorktrees();
  assert.equal(git(["status", "--porcelain=v1"]), statusBefore, "Failed local writes must preserve staged/unstaged state");
  const secondTarget = path.join(project, "src", "new.js");
  const originalSecondBytes = fs.readFileSync(secondTarget);
  const partialApply = run(process.execPath, noPrArgs, project, {
    WEB_KIT_REVIEW_TEST_MODE: "local-apply-rollback", WEB_KIT_REVIEW_TEST_LOCAL_APPLY_FAILURE: "1",
  });
  assert.notEqual(partialApply.status, 0, "An error after a replacement must roll back every applied file");
  assert.match(partialApply.stderr, /Injected failure after a local replacement/);
  assert(fs.readFileSync(localTarget).equals(originalLocalBytes), "Rollback must restore the first replaced user file");
  assert(fs.readFileSync(secondTarget).equals(originalSecondBytes), "Rollback must preserve later user files");
  assert.equal(fs.statSync(localTarget).mode & 0o777, originalLocalMode);
  assert.equal(git(["show", ":src/feature.js"]), stagedBefore);
  assert(!fs.readdirSync(path.dirname(localTarget)).some(name => name.startsWith(".web-kit-autofix-")),
    "Rollback left temporary backups in the user's working tree");
  cleanIsolatedWorktrees();
  assert.equal(git(["status", "--porcelain=v1"]), statusBefore, "Rollback must preserve the original Git status");

  const localOnly = run(process.execPath, noPrArgs, project, { WEB_KIT_REVIEW_GH_BIN: path.join(project, "missing-gh") });
  assert.equal(localOnly.status, 0, `Local-only fix must not require GitHub CLI: ${localOnly.stderr}`);
  assert.match(localOnly.stdout, /COMPLETED LOCALLY/);
  assert.match(localOnly.stdout, /No commit, push, or PR/);
  assert(!fs.existsSync(capture), "Local-only fix unexpectedly opened a PR");
  assert.match(fs.readFileSync(path.join(project, "src", "feature.js"), "utf8"), /verified patch from isolated fixing session/);
  assert.equal(git(["show", ":src/feature.js"]), stagedBefore, "Local-only fixes must not change the staged index");
  console.log("Auto-fix review: PASS (isolated fresh sessions, scoped remote PR, original index/worktree preserved, failure gates)");
} finally {
  if (fs.existsSync(project)) {
    try { cleanIsolatedWorktrees(); } catch {}
  }
  fs.rmSync(root, { recursive: true, force: true });
}
