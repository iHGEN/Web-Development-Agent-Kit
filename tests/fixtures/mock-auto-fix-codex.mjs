#!/usr/bin/env node
// Simulated Codex JSONL for safe offline auto-fix/PR integration tests.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const phase = process.env.WEB_KIT_REVIEW_PHASE;
const project = args[args.indexOf("-C") + 1];
const sandbox = args[args.indexOf("--sandbox") + 1];
if (phase === "review" && process.env.WEB_KIT_REVIEW_TEST_PROMPT_CAPTURE) {
  fs.writeFileSync(process.env.WEB_KIT_REVIEW_TEST_PROMPT_CAPTURE, args.at(-1));
}
if (!args.includes("--ephemeral") || !args.includes("--json")) process.exit(5);
if ((["fix", "verify"].includes(phase) ? "workspace-write" : "read-only") !== sandbox) process.exit(6);

const emit = event => console.log(JSON.stringify(event));
emit({ type: "thread.started", thread_id: randomUUID() });
if (phase === "fix") {
  const target = path.join(project, "src", "feature.js");
  if (process.env.WEB_KIT_REVIEW_TEST_MODE === "local-mode-only") fs.chmodSync(target, 0o755);
  else fs.appendFileSync(target, "// verified patch from isolated fixing session\n");
  if (process.env.WEB_KIT_REVIEW_TEST_MODE === "local-apply-rollback") {
    fs.appendFileSync(path.join(project, "src", "new.js"), "// second local fix\n");
  }
  if (process.env.WEB_KIT_REVIEW_TEST_MODE === "out-of-scope") {
    fs.writeFileSync(path.join(project, "src", "unrelated-production.js"), "export const unrelated = true;\n");
  }
  if (process.env.WEB_KIT_REVIEW_TEST_MODE === "out-of-scope-test") {
    const testDirectory = path.join(project, "tests");
    fs.mkdirSync(testDirectory, { recursive: true });
    fs.writeFileSync(path.join(testDirectory, "legacy-auth.test.mjs"), "export const unrelatedTest = true;\n");
  }
  const relatedEntry = /^related-(index|main|app)-test$/.exec(process.env.WEB_KIT_REVIEW_TEST_MODE || "");
  if (relatedEntry) {
    const testDirectory = path.join(project, "tests");
    fs.mkdirSync(testDirectory, { recursive: true });
    fs.writeFileSync(path.join(testDirectory, `${relatedEntry[1]}.test.ts`), "export const relatedEntryTest = true;\n");
  }
  if (process.env.WEB_KIT_REVIEW_TEST_MODE === "cross-package-test") {
    const testDirectory = path.join(project, "backend", "tests");
    fs.mkdirSync(testDirectory, { recursive: true });
    fs.writeFileSync(path.join(testDirectory, "auth.test.ts"), "export const unrelatedAuthTest = true;\n");
  }
  if (process.env.WEB_KIT_REVIEW_TEST_MODE === "provider-key-leak") {
    fs.appendFileSync(target, `// ${process.env.OPENAI_API_KEY}\n`);
  }
  if (process.env.WEB_KIT_REVIEW_TEST_MODE === "ignored-test-dependency") {
    // The original isolated worktree sees this file; an exact fresh Git-tree
    // checkout must not. The verifier below executes a real dependent test.
    fs.writeFileSync(path.join(project, "runtime.generated"), "uncommitted test dependency\n");
  }
  emit({ type: "item.completed", item: { type: "agent_message", text: "Fixed the confirmed issue; independent verification follows." } });
} else if (phase === "verify") {
  const mode = process.env.WEB_KIT_REVIEW_TEST_MODE;
  const tap = "TAP version 13\n# tests 2\n# pass 2\n# fail 0\n";
  const emitCheck = (command, exit_code, output = tap) => {
    // A verified command is explicitly rooted IN THE SAME SHELL INVOCATION;
    // Codex JSONL does not expose an authoritative command working directory.
    // Simulate old/ambiguous events only for the nested-workspace negative case.
    const rooted = /^(?:npm|pnpm|yarn|bun|node|go|mvn|dotnet|cargo|pytest|python|make|ctest|gradle|npx)\b/i.test(command)
      && !(mode?.startsWith("nested-cwd-masked-workspace") && command === "npm test");
    emit({ type: "item.completed", item: {
      type: "command_execution", command: rooted ? `cd "${project}" && ${command}` : command,
      exit_code, aggregated_output: output,
    } });
  };
  if (mode !== "no-tests") {
    const goCommands = {
      "go-success": "go test -count=1 -json ./...",
      "go-verbose-success": "go test -count=1 -v ./...",
      "go-no-tests": "go test -count=1 -json ./...",
      "go-package-only": "go test -count=1 ./...",
      "go-nonmatching-run": "go test -count=1 -run NoSuchTest ./...",
      "go-nonmatching-json": "go test -count=1 -json -run NoSuchTest ./...",
      "go-skipped": "go test -count=1 -json ./...",
      "go-cached": "go test -json ./...",
      "go-masked-failure": "go test -count=1 -json ./...",
    };
    const workspaceCommands = {
      "nested-cwd-masked-workspace": "npm test",
      "nested-cwd-masked-workspace-with-real": "npm test",
      "masked-workspace-script": "npm run test --workspace=packages/api",
      "masked-workspace-short-selector": "npm test -w @fixture/api",
      "masked-workspace-repeated": "npm run test --workspace=packages/web --workspace=packages/api",
      "masked-workspace-all": "npm run test --workspaces",
      "masked-workspace-parent": "npm run test --workspace=packages",
      "masked-workspace-lifecycle": "npm run test --workspace=packages/api",
      "masked-nested-workspace-selector": "npm run test --workspace=packages/api",
      "unsupported-workspace-selector": "npm run test --workspace=packages/missing",
      "safe-workspace": "npm run test --workspace=packages/web",
      "safe-workspace-all": "npm run test --workspaces",
      "masked-workspace-env": "npm_config_workspace=packages/api npm run test",
      "masked-workspace-env-shell": "bash -lc 'npm_config_workspace=packages/api npm run test'",
      "masked-workspace-env-with-real": "env npm_config_workspace=packages/api npm run test",
      "masked-workspace-env-absolute": "/usr/bin/env npm_config_workspace=packages/api npm run test",
      "masked-workspace-prefixed-shell": "set -e; npm_config_workspace=packages/api npm run test",
    };
    const directCommands = {
      "jest-success": "npx jest",
      "vitest-success": "npx vitest run",
      "pytest-success": "pytest",
      "cargo-success": "cargo test",
      "ctest-success": "ctest",
    };
    const command = goCommands[mode] || workspaceCommands[mode] || directCommands[mode] || (mode?.startsWith("maven-") ? "mvn test"
      : mode?.startsWith("dotnet-") ? "dotnet test"
        : mode === "fake-checks" ? "echo npm test"
          : mode === "env-unrelated-diagnostic" ? "env NODE_ENV=test npm --version"
            : mode?.startsWith("bun-direct-") ? "bun test"
            : mode === "bun-run-missing-script" ? "bun run test"
          : ["masked-test", "masked-plus-real"].includes(mode) ? "npm test || true"
            : ["masked-tap-in-script", "masked-jest", "masked-package-script", "masked-nested-package-script",
              "masked-chained-package-script", "safe-chained-package-script", "masked-pretest-lifecycle",
              "masked-posttest-lifecycle", "masked-nested-lifecycle", "safe-lifecycle"].includes(mode) ? "npm test"
              : mode === "masked-cargo" ? "cargo test"
            : mode === "help-only" ? "node --test --help"
              : mode === "help-only-short-version" ? "node --test -V"
              : mode === "help-only-npm" ? "npm test -- --help" : "node --test");
    const goPassed = JSON.stringify({ Action: "pass", Package: "example.org/app", Test: "TestFeature" });
    const goSkipped = JSON.stringify({ Action: "skip", Package: "example.org/app", Test: "TestFeature" });
    const goPackagePassed = JSON.stringify({ Action: "pass", Package: "example.org/app" });
    const goOutputs = {
      "go-success": `${goPassed}\n${goPackagePassed}\n`,
      "go-verbose-success": "=== RUN   TestFeature\n--- PASS: TestFeature (0.00s)\nPASS\nok example.org/app 0.004s\n",
      "go-no-tests": "?  example.org/app [no test files]\n",
      "go-package-only": "ok example.org/app 0.004s\n",
      "go-nonmatching-run": "ok example.org/app 0.004s [no tests to run]\n",
      "go-nonmatching-json": `${JSON.stringify({ Action: "output", Package: "example.org/app", Output: "testing: warning: no tests to run\n" })}\n${goPackagePassed}\n`,
      "go-skipped": `${goSkipped}\n${goPackagePassed}\n`,
      "go-cached": `${goPassed}\n${goPackagePassed}\n`,
      "go-masked-failure": `${goPassed}\n${JSON.stringify({ Action: "fail", Package: "example.org/app", Test: "TestBroken" })}\n`,
    };
    const otherOutputs = {
      "jest-success": "Test Suites: 1 passed, 1 total\nTests: 3 passed, 3 total\n",
      "vitest-success": " Test Files 1 passed (1)\n Tests 3 passed (3)\n",
      "pytest-success": "================ 4 passed in 0.02s ================\n",
      "cargo-success": "running 3 tests\ntest result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n",
      "ctest-success": "100% tests passed, 0 tests failed out of 2\n",
      "maven-success": "Tests run: 8, Failures: 0, Errors: 0, Skipped: 0\n",
      "maven-skipped": "Tests run: 8, Failures: 0, Errors: 0, Skipped: 8\n",
      "dotnet-success": "Passed! - Failed: 0, Passed: 8, Skipped: 0, Total: 8\n",
      "dotnet-skipped": "Passed! - Failed: 0, Passed: 0, Skipped: 8, Total: 8\n",
      "maven-masked-failure": "Tests run: 2, Failures: 1, Errors: 0, Skipped: 0\nTests: 1 passed\n",
      "dotnet-masked-failure": "Passed! - Failed: 1, Passed: 2, Skipped: 0, Total: 3\nTests: 2 passed\n",
      "node-spec-success": "ℹ tests 2\nℹ suites 0\nℹ pass 2\nℹ fail 0\nℹ skipped 0\n",
      "node-spec-skipped": "ℹ tests 2\nℹ pass 0\nℹ fail 0\nℹ skipped 2\n",
      "node-spec-masked-failure": "ℹ tests 2\nℹ pass 1\nℹ fail 1\n",
      "bun-direct-success": "test/example.test.ts:\n(pass) adds numbers\n(pass) subtracts numbers\n\n 2 pass\n 0 fail\n Ran 2 tests across 1 file.\n",
      "bun-direct-zero": "0 pass\n0 fail\nRan 0 tests across 0 files.\n",
      "bun-direct-masked-failure": "1 pass\n1 fail\nRan 2 tests across 1 file.\n",
      "masked-tap-in-script": "TAP version 13\n# tests 2\n# pass 1\n# fail 1\n",
      "masked-jest": "Test Suites: 1 failed, 1 passed\nTests: 1 failed, 1 passed\n",
      "masked-cargo": "test result: FAILED. 2 passed; 1 failed\n",
      "noisy-output": `${"log output with no result\n".repeat(14000)}${tap}`,
      "help-only": "Usage: --help\n",
      "help-only-short-version": "Usage: --version\n",
      "help-only-npm": "Usage: --help\n",
      "zero-tests": "TAP version 13\n# tests 0\n# pass 0\n",
      "all-skipped": "TAP version 13\n# tests 2\n# pass 0\n# skipped 2\n",
      "node-tap-skipped-fake-count": "TAP version 13\n# harmless stdout: 9 passed\n# tests 1\n# pass 0\n# fail 0\n# skipped 1\n",
      "jest-skipped-fake-count": "9 passed\nTest Suites: 1 skipped, 1 total\nTests: 1 skipped, 1 total\n",
      "vitest-skipped-fake-count": "9 passed\n Test Files 1 skipped (1)\n Tests 1 skipped (1)\n",
      "pytest-skipped-fake-count": "9 passed\n================ 1 skipped in 0.01s ================\n",
      "bun-skipped-fake-count": "9 passed\n0 pass\n0 fail\n1 skip\nRan 1 tests across 1 file.\n",
      "node-direct-fake-jest": "Tests: 9 passed, 9 total\n",
    };
    if (mode === "node-real-skipped-fake-count") {
      const real = spawnSync(process.execPath, ["-e",
        'const test = require("node:test"); console.log("9 passed"); test("skipped", { skip: true }, () => {});'],
      { cwd: project, encoding: "utf8", timeout: 15000, windowsHide: true });
      if (real.status !== 0 || real.error || !/pass 0/.test(real.stdout)) process.exit(12);
      emitCheck("node --test", real.status, `${real.stdout}\n${real.stderr}`);
    } else if (mode === "ignored-test-dependency") {
      const actual = spawnSync(process.execPath, ["--test", "tests/ignored-dependency.test.mjs"],
        { cwd: project, encoding: "utf8", timeout: 15000, windowsHide: true });
      if (actual.error) process.exit(12);
      emitCheck("node --test tests/ignored-dependency.test.mjs", actual.status, `${actual.stdout}\n${actual.stderr}`);
    } else if (mode?.startsWith("nested-cwd-masked-workspace")) {
      const nested = spawnSync("npm", ["test"], {
        cwd: path.join(project, "packages", "api"), encoding: "utf8", timeout: 15000,
        maxBuffer: 1024 * 1024, windowsHide: true,
      });
      if (nested.error || nested.status !== 0 || !/#\s*pass\s+1/.test(nested.stdout)
        || /#\s*fail\s+[1-9]/.test(nested.stdout)) process.exit(12);
      emitCheck(command, nested.status, `${nested.stdout}\n${nested.stderr}`);
    } else {
      const output = goOutputs[mode] ?? otherOutputs[mode] ?? tap;
      emitCheck(command, 0, output);
    }
  }
  if (["masked-plus-real", "nested-cwd-masked-workspace-with-real", "masked-workspace-env-with-real", "masked-workspace-env-absolute",
    "masked-workspace-prefixed-shell", "env-unrelated-diagnostic"].includes(mode)) emitCheck("node --test", 0);
  if (mode === "audit-pass") emitCheck("npm run audit", 0);
  if (mode === "failed-audit") emitCheck("npm run audit", 1);
  if (mode?.startsWith("diagnostic-masked-audit-")) {
    const prefix = mode.slice("diagnostic-masked-audit-".length);
    emitCheck(`${prefix} diagnostic; npm run audit > /dev/null 2>&1 || true`, 0, "audit failed but was masked\n");
    emitCheck("node --test", 0);
  }
  if (mode === "rg-no-match") emitCheck("rg nonexistent-symbol src/", 1, "");
  if (mode === "rg-no-match-rooted") emitCheck(`cd "${project}" && rg nonexistent-symbol src/`, 1, "");
  if (mode === "stale-test") {
    const target = path.join(project, "src", "feature.js");
    fs.appendFileSync(target, "// modified AFTER verification started\n");
  }
  emit({ type: "item.completed", item: { type: "agent_message", text: "Verification complete (mock event stream)." } });
} else if (phase === "re-review") {
  const feature = path.join(project, "src", "feature.js");
  const fixed = process.env.WEB_KIT_REVIEW_TEST_MODE === "local-mode-only"
    ? (fs.statSync(feature).mode & 0o111) !== 0
    : fs.readFileSync(feature, "utf8").includes("verified patch");
  const ready = fixed && process.env.WEB_KIT_REVIEW_TEST_MODE !== "not-ready";
  const jsonLine = process.env.WEB_KIT_REVIEW_TEST_MODE === "missing-unresolved-json" ? ""
    : `Unresolved findings (JSON): ${process.env.WEB_KIT_REVIEW_TEST_MODE === "contradictory-json" || !ready ? '[{"severity":"P1","file":"src/feature.js","summary":"data loss"}]' : "[]"}\n`;
  const mode = process.env.WEB_KIT_REVIEW_TEST_MODE;
  const findings = mode === "contradictory-findings" ? "P1 data loss"
    : mode === "contradictory-numbered" ? "\n1. [P1] Fixing file may delete user data"
      : mode === "contradictory-table" ? "\n| P1 | Fixing file may delete user data |"
        : mode === "contradictory-heading" ? "\n### [P1] A user file may be overwritten"
        : ready ? "none" : "P1 unresolved";
  const report = `# Fresh independent re-review\nFindings: ${findings}\nSecurity checks: covered changed code.\n${jsonLine}Remaining P0-P2 findings: ${ready ? "none" : "P1 unresolved"}\nPR readiness: ${ready ? "READY TO OPEN PR" : "NOT READY"}`;
  emit({ type: "item.completed", item: { type: "agent_message", text: process.env.WEB_KIT_REVIEW_TEST_MODE === "contradictory"
    ? report + "\nPR readiness: NOT READY" : report } });
} else {
  if (process.env.WEB_KIT_REVIEW_TEST_MODE === "stage-race") {
    const file = path.join(project, "src", "feature.js");
    const worktree = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, "export const safe = 'staged C';\n");
    const staged = spawnSync("git", ["add", "src/feature.js"], { cwd: project, windowsHide: true });
    if (staged.status !== 0) process.exit(9);
    fs.writeFileSync(file, worktree);
  }
  emit({ type: "item.completed", item: { type: "agent_message", text: "# Changes review\nScope: current staged, unstaged and relevant untracked code.\nFindings: P1 verified issue in src/feature.js.\nSecurity checks: input validation.\nCoverage: direct callers.\nChecks: NOT RUN\nGaps: no live tests in read-only mode.\nRemaining P0-P2 findings: P1 input validation.\nPR readiness: NOT ASSESSED" } });
}
emit({ type: "turn.completed" });
