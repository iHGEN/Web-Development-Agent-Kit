#!/usr/bin/env node
// Provider protocol fixture. Real runner validation applies; there is no fixture bypass.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const project = process.env.WEB_KIT_CODE_REVIEW_PROJECT_ROOT;
const contextFile = process.env.WEB_KIT_CODE_REVIEW_CONTEXT_FILE;
const runId = process.env.WEB_KIT_CODE_REVIEW_RUN_ID;
const mode = process.env.WEB_KIT_TEST_CODE_REVIEW_MODE || "normal";
const restrictedConfiguration = ["--config", "features.apps=false", "--config", "features.plugins=false"];
const servers = mode === "empty-servers" ? [] : ["workspace", "docs.tools", 'quoted"server'];
const recordAudit = (entry) => {
  if (process.env.WEB_KIT_TEST_CODE_REVIEW_AUDIT) fs.appendFileSync(process.env.WEB_KIT_TEST_CODE_REVIEW_AUDIT, JSON.stringify(entry) + "\n");
};
if (args.includes("mcp") && args.includes("list")) {
  assert.deepEqual(args, [...restrictedConfiguration, "mcp", "list", "--json"], "Codex must disable connector and plugin discovery before inspecting configured MCP servers.");
  assert.equal(process.env.WEB_KIT_CONTEXT_SUPERVISOR_BYPASS, "1");
  assert.equal(process.env.WEB_KIT_CODE_REVIEW_ACTIVE, "1");
  assert.equal(process.cwd(), project);
  recordAudit({ kind: "preflight", pid: process.pid, run_id: runId, context_file: contextFile, args });
  if (mode === "preflight-timeout") await new Promise(resolve => setTimeout(resolve, 10000));
  if (mode === "shared-timeout") await new Promise(resolve => setTimeout(resolve, 650));
  if (mode === "preflight-exit") { process.stderr.write("DO_NOT_LEAK_PREFLIGHT_SECRET"); process.exit(17); }
  if (mode === "preflight-malformed") { console.log("{invalid-json"); process.exit(0); }
  if (mode === "preflight-unsupported") { console.log(JSON.stringify({ servers: [] })); process.exit(0); }
  const names = mode === "preflight-duplicate" ? [servers[0], servers[0]] : servers;
  console.log(JSON.stringify(names.map(name => ({ name, enabled: true, transport: { env: { TOKEN: "DO_NOT_LEAK_PREFLIGHT_SECRET" } } }))));
  process.exit(0);
}
assert(project && contextFile && runId, "Review context is missing.");
assert.equal(process.env.WEB_KIT_CONTEXT_SUPERVISOR_BYPASS, "1");
assert.equal(process.env.WEB_KIT_CODE_REVIEW_ACTIVE, "1");
assert(!args.some(arg => ["resume", "--resume", "--continue", "-c"].includes(arg)), "Reviewer resumed a prior context or used an ambiguous short configuration flag.");
assert(!args.some(arg => ["--model", "-m"].includes(arg)), "Reviewer forced a model.");
const provider = args.includes("exec") ? "codex" : args.includes("--permission-mode") ? "claude" : "unsupported";
assert.notEqual(provider, "unsupported", "An unsupported provider was launched.");
if (provider === "codex") {
  const disabledServers = `mcp_servers={${servers.map(name => `${JSON.stringify(name)}={enabled=false}`).join(",")}}`;
  assert.deepEqual(args.slice(0, args.indexOf("exec")), [...restrictedConfiguration, ...(servers.length ? ["--config", disabledServers] : [])], "Codex must disable every listed MCP server, including dotted and quoted names, without model or effort overrides.");
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
}
else {
  assert.equal(args[args.indexOf("--permission-mode") + 1], "plan");
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Glob,Grep", "Claude must have only source-reading tools.");
  assert.equal(args[args.indexOf("--disallowedTools") + 1], "mcp__*", "Claude MCP tools must not bypass the read-only built-in set.");
  assert.equal(args[args.indexOf("--add-dir") + 1], path.dirname(contextFile), "Claude must be able to read the private context and diff.");
}
const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
assert(context.original_intent && context.snapshot && context.report_schema, "Incomplete review context.");
assert.equal(path.dirname(context.change_evidence), path.dirname(contextFile), "Diff evidence must share the private context directory.");
assert.equal(path.basename(context.change_evidence), "changes.patch");
const changeEvidence = fs.readFileSync(context.change_evidence, "utf8");
const sectionOrder = ["committed", "staged", "unstaged"].map(name => changeEvidence.indexOf(`\n# SECTION ${name}\n`));
assert(sectionOrder.every((offset, index) => offset >= 0 && (index === 0 || offset > sectionOrder[index - 1])), "Complete ordered diff sections are missing.");
assert(changeEvidence.includes("diff --git a/src/feature.js b/src/feature.js"), "The actual source change is missing from the diff evidence.");
if (process.platform !== "win32") {
  assert.equal(fs.statSync(path.dirname(contextFile)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(context.change_evidence).mode & 0o777, 0o600);
  assert.equal(fs.statSync(contextFile).mode & 0o777, 0o600);
}
if (process.env.WEB_KIT_TEST_CODE_REVIEW_DIFF_MARKERS === "1") {
  const sections = sectionOrder.map((offset, index) => changeEvidence.slice(offset, sectionOrder[index + 1] ?? changeEvidence.length));
  assert(sections[0].includes("\n+committed-evidence-marker\n"), "Committed changes must remain physical diff lines.");
  assert(sections[1].includes("\n+staged-evidence-marker\n"), "Staged changes are missing from the diff.");
  assert(sections[2].includes("\n+unstaged-evidence-marker\n"), "Unstaged changes are missing from the diff.");
  assert(context.untracked_files.includes("src/untracked.js"), "The untracked source file inventory is incomplete.");
  assert(fs.readFileSync(path.join(project, "src/untracked.js"), "utf8").includes("untrackedEvidence"));
}
const prompt = provider === "codex" ? args.at(-1) : args[args.indexOf("-p") + 1];
assert(prompt.includes("realistic counterexamples") && prompt.includes("No minimum finding quota"), "Strict evidence-based reviewer prompt missing.");
assert(prompt.includes("change_evidence"), "Reviewer must inspect the captured diff.");
if (provider === "claude") assert(prompt.includes("shell execution is not authorized"), "Claude must use only file-reading and search tools.");
else assert(prompt.includes("sandboxed read-only inspection commands") && prompt.includes("Never execute repository code, project scripts or tests"), "Codex needs sandboxed inspection without executing untrusted project code.");
assert(!path.resolve(contextFile).startsWith(path.resolve(project) + path.sep), "Temporary context leaked into the project tree.");
recordAudit({ kind: "review", pid: process.pid, run_id: runId, context_file: contextFile, change_evidence: context.change_evidence, provider, args });
if (mode === "timeout") await new Promise(resolve => setTimeout(resolve, 10000));
if (mode === "shared-timeout") await new Promise(resolve => setTimeout(resolve, 650));
if (mode === "exit") { process.stderr.write("DO_NOT_LEAK_PROVIDER_DETAIL"); process.exit(17); }

const feature = await import(pathToFileURL(path.join(project, "src/feature.js")));
const booleanFeature = Object.hasOwn(feature, "enabled");
const own = booleanFeature ? feature.enabled : feature.canCancel({ id: "user-a" }, { userId: "user-a" });
const other = booleanFeature ? false : feature.canCancel({ id: "user-a" }, { userId: "user-b" });
const vulnerable = other === true;
const finding = {
  id: "BUG-OWNERSHIP", severity: "P1", file: "src/feature.js", line: 1, symbol: "canCancel",
  title: "A user can cancel another user's booking",
  trigger: "Call canCancel with user-a and a booking owned by user-b.",
  impact: "The owner boundary permits an unauthorized cancellation.",
  evidence: "Direct fixture invocation returns true for two different user IDs.",
  recommendation: "Compare the booking owner with the authenticated user's ID."
};
const output = {
  schema_version: 1,
  summary: vulnerable ? "Confirmed booking ownership defect." : "Owner and non-owner behavior verified in the fixture.",
  files_reviewed: [...context.snapshot.files],
  requirements: context.requirements.map(req => ({ id: req.id, status: vulnerable ? "FAIL" : "PASS", evidence: "Invoked canCancel for owner and non-owner inputs." })),
  scenarios: context.requirements.flatMap(req => [
    { requirement_id: req.id, kind: "normal", status: own === true ? "PASS" : "FAIL", scenario: "Cancel own booking.", expected: "Allowed.", observed: String(own), evidence: "Direct canCancel invocation with matching IDs." },
    { requirement_id: req.id, kind: "negative", status: vulnerable ? "FAIL" : "PASS", scenario: "Cancel another user's booking.", expected: "Denied.", observed: String(other), evidence: "Direct canCancel invocation with different IDs." },
    { requirement_id: req.id, kind: "integration", status: "NOT_APPLICABLE", scenario: "External system integration.", expected: "No integration in this isolated fixture.", observed: "The only consumer is the supplied unit test.", evidence: "src/feature.js exports a pure predicate; no database or network exists in this fixture." }
  ]),
  boundaries: [{ name: "Authenticated user to booking owner", status: "REVIEWED", files: ["src/feature.js"], evidence: "Compared matching and different IDs by invoking the exported predicate." }],
  findings: vulnerable ? [finding] : [],
  prior_findings: (context.previous_findings || []).map(previous => ({ id: previous.id, status: vulnerable && previous.id === finding.id ? "OPEN" : "RESOLVED", evidence: vulnerable ? "The non-owner call still returns true." : "The non-owner call now returns false and the owner call returns true." })),
  verification_gaps: [],
};
if (booleanFeature) {
  output.summary = "Verified the exported feature flag using the actual module.";
  output.requirements = context.requirements.map(req => ({ id: req.id, status: own === true ? "PASS" : "FAIL", evidence: `Imported enabled from src/feature.js; observed ${String(own)}.` }));
  output.scenarios = context.requirements.flatMap(req => [
    { requirement_id: req.id, kind: "normal", status: own === true ? "PASS" : "FAIL", scenario: "Import the feature flag.", expected: "enabled is true.", observed: String(own), evidence: "Direct ES module import of src/feature.js." },
    { requirement_id: req.id, kind: "negative", status: "NOT_APPLICABLE", scenario: "Invalid caller input.", expected: "No caller inputs exist.", observed: "The export is a constant boolean.", evidence: "src/feature.js has no input or permission boundary in this fixture." },
    { requirement_id: req.id, kind: "integration", status: "PASS", scenario: "Consumer imports the feature flag.", expected: "Import succeeds with true value.", observed: String(own), evidence: "The fixture imported the same module consumed by tests/feature.test.mjs." }
  ]);
  output.boundaries = [{ name: "Module export to test consumer", status: "REVIEWED", files: ["src/feature.js", "tests/feature.test.mjs"], evidence: "The named export resolves and its value is true." }];
}
if (mode === "empty-coverage") { output.files_reviewed = []; output.requirements = []; output.scenarios = []; }
if (mode === "drop-prior") { output.findings = []; output.prior_findings = []; output.requirements.forEach(item => { item.status = "PASS"; }); output.scenarios.forEach(item => { if (item.status === "FAIL") item.status = "PASS"; }); }
if (mode === "mutate") fs.appendFileSync(path.join(project, "src/feature.js"), "\n// Unauthorized reviewer edit.\n");
if (mode === "stage") {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("git", ["add", "src/feature.js"], { cwd: project, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
const message = mode === "malformed" ? "{not-valid-json" : JSON.stringify(output);
if (provider === "codex") console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: message } }));
else console.log(JSON.stringify({ result: message }));
