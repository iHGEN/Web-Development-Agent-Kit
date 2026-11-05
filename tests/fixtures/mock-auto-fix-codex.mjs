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
  emit({ type: "item.completed", item: { type: "agent_message", text: "Fixed the confirmed issue; independent verification follows." } });
} else if (phase === "verify") {
  const mode = process.env.WEB_KIT_REVIEW_TEST_MODE;
  const tap = "TAP version 13\n# tests 2\n# pass 2\n# fail 0\n";
  const emitCheck = (command, exit_code, output = tap) => emit({ type: "item.completed", item: {
    type: "command_execution", command, exit_code, aggregated_output: output,
  } });
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
    };
    const command = goCommands[mode] || workspaceCommands[mode] || (mode?.startsWith("maven-") ? "mvn test"
      : mode?.startsWith("dotnet-") ? "dotnet test"
        : mode === "fake-checks" ? "echo npm test"
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
      "maven-success": "Tests run: 8, Failures: 0, Errors: 0, Skipped: 0\n",
      "maven-skipped": "Tests run: 8, Failures: 0, Errors: 0, Skipped: 8\n",
      "dotnet-success": "Passed! - Failed: 0, Passed: 8, Skipped: 0, Total: 8\n",
      "dotnet-skipped": "Passed! - Failed: 0, Passed: 0, Skipped: 8, Total: 8\n",
      "maven-masked-failure": "Tests run: 2, Failures: 1, Errors: 0, Skipped: 0\nTests: 1 passed\n",
      "dotnet-masked-failure": "Passed! - Failed: 1, Passed: 2, Skipped: 0, Total: 3\nTests: 2 passed\n",
      "masked-tap-in-script": "TAP version 13\n# tests 2\n# pass 1\n# fail 1\n",
      "masked-jest": "Test Suites: 1 failed, 1 passed\nTests: 1 failed, 1 passed\n",
      "masked-cargo": "test result: FAILED. 2 passed; 1 failed\n",
      "noisy-output": `${"log output with no result\n".repeat(14000)}${tap}`,
      "help-only": "Usage: --help\n",
      "help-only-short-version": "Usage: --version\n",
      "help-only-npm": "Usage: --help\n",
      "zero-tests": "TAP version 13\n# tests 0\n# pass 0\n",
      "all-skipped": "TAP version 13\n# tests 2\n# pass 0\n# skipped 2\n",
    };
    const output = goOutputs[mode] ?? otherOutputs[mode] ?? tap;
    emitCheck(command, 0, output);
  }
  if (mode === "masked-plus-real") emitCheck("node --test", 0);
  if (mode === "audit-pass") emitCheck("npm run audit", 0);
  if (mode === "failed-audit") emitCheck("npm run audit", 1);
  if (mode === "rg-no-match") emitCheck("rg nonexistent-symbol src/", 1, "");
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
