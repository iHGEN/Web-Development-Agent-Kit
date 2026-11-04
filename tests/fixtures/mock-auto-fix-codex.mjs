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
  fs.appendFileSync(target, "// verified patch from isolated fixing session\n");
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
    const command = mode?.startsWith("go-") ? "go test ./..."
      : mode?.startsWith("maven-") ? "mvn test"
        : mode?.startsWith("dotnet-") ? "dotnet test"
          : mode === "fake-checks" ? "echo npm test"
      : ["masked-test", "masked-plus-real"].includes(mode) ? "npm test || true"
        : mode === "help-only" ? "node --test --help"
          : mode === "help-only-npm" ? "npm test -- --help" : "node --test";
    const output = mode === "go-success" ? "ok  example.org/app 0.004s\n"
      : mode === "go-no-tests" ? "?  example.org/app [no test files]\n"
        : mode === "maven-success" ? "Tests run: 8, Failures: 0, Errors: 0, Skipped: 0\n"
          : mode === "maven-skipped" ? "Tests run: 8, Failures: 0, Errors: 0, Skipped: 8\n"
            : mode === "dotnet-success" ? "Passed! - Failed: 0, Passed: 8, Skipped: 0, Total: 8\n"
              : mode === "dotnet-skipped" ? "Passed! - Failed: 0, Passed: 0, Skipped: 8, Total: 8\n"
                : mode === "noisy-output" ? `${"log output with no result\n".repeat(14000)}${tap}`
                  : ["help-only", "help-only-npm"].includes(mode) ? "Usage: --help\n"
                    : mode === "zero-tests" ? "TAP version 13\n# tests 0\n# pass 0\n"
                      : mode === "all-skipped" ? "TAP version 13\n# tests 2\n# pass 0\n# skipped 2\n" : tap;
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
  const fixed = fs.readFileSync(path.join(project, "src", "feature.js"), "utf8").includes("verified patch");
  const ready = fixed && process.env.WEB_KIT_REVIEW_TEST_MODE !== "not-ready";
  const jsonLine = process.env.WEB_KIT_REVIEW_TEST_MODE === "missing-unresolved-json" ? ""
    : `Unresolved findings (JSON): ${process.env.WEB_KIT_REVIEW_TEST_MODE === "contradictory-json" || !ready ? '[{"severity":"P1","file":"src/feature.js","summary":"data loss"}]' : "[]"}\n`;
  const report = `# Fresh independent re-review\nFindings: ${process.env.WEB_KIT_REVIEW_TEST_MODE === "contradictory-findings" ? "P1 data loss" : ready ? "none" : "P1 unresolved"}\nSecurity checks: covered changed code.\n${jsonLine}Remaining P0-P2 findings: ${ready ? "none" : "P1 unresolved"}\nPR readiness: ${ready ? "READY TO OPEN PR" : "NOT READY"}`;
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
