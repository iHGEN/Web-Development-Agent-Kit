#!/usr/bin/env node
// Provider protocol fixture. Real runner validation applies; there is no fixture bypass.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const project = process.env.WEB_KIT_CODE_REVIEW_PROJECT_ROOT;
const contextFile = process.env.WEB_KIT_CODE_REVIEW_CONTEXT_FILE;
const runId = process.env.WEB_KIT_CODE_REVIEW_RUN_ID;
const mode = process.env.WEB_KIT_TEST_CODE_REVIEW_MODE || "normal";
const restrictedConfiguration = ["--config", "features.apps=false", "--config", "features.plugins=false", "--config", "features.hooks=false", "--config", "notify=[]", "--config", 'approval_policy="never"', "--config", 'approvals_reviewer="user"', "--config", 'sandbox_mode="read-only"'];
if (process.platform === "win32") restrictedConfiguration.push("--config", 'windows.sandbox="elevated"', "--config", "windows.allow_mxc=false");
const servers = mode === "empty-servers" ? [] : ["workspace", "docs.tools", 'quoted"server'];
const home = process.env.CODEX_HOME ? fs.realpathSync.native(path.resolve(process.env.CODEX_HOME)) : path.join(process.env.HOME || "", ".codex");
const systemHome = process.env.WEB_KIT_TEST_CODE_REVIEW_SYSTEM_HOME || path.join(path.dirname(home), "provider-system");
const serverConfiguration = `mcp_servers={${servers.map(name => `${JSON.stringify(name)}={enabled=false}`).join(",")}}`;
const finalConfiguration = [...restrictedConfiguration, ...(servers.length ? ["--config", serverConfiguration] : [])];
const configOverrides = new Map(args.flatMap((arg, index) => {
  if (arg !== "--config") return [];
  const value = args[index + 1] || "";
  const equal = value.indexOf("=");
  return equal < 0 ? [] : [[value.slice(0, equal), value.slice(equal + 1)]];
}));
function configuredValue(name, fallback) {
  let value = fallback;
  for (const file of [path.join(home, "config.toml"), path.join(process.cwd(), ".codex/config.toml")]) {
    if (!fs.existsSync(file)) continue;
    const configured = fs.readFileSync(file, "utf8").match(new RegExp(`^${name}\\s*=\\s*("[^"\\n]*")`, "m"))?.[1];
    if (configured) value = JSON.parse(configured);
  }
  return configOverrides.has(name) ? JSON.parse(configOverrides.get(name)) : value;
}
function permissionProbe() {
  const command = ["node", ".codex/write-permission-marker.cjs"];
  let allowRule = false;
  for (const directory of [path.join(systemHome, "rules"), path.join(home, "rules"), path.join(process.cwd(), ".codex/rules")]) {
    if (!fs.existsSync(directory)) continue;
    for (const file of fs.readdirSync(directory).filter(name => name.endsWith(".rules"))) {
      const policy = fs.readFileSync(path.join(directory, file), "utf8");
      const pattern = policy.match(/pattern\s*=\s*(\[[^\n]*?\])/m)?.[1];
      if (pattern && /decision\s*=\s*"allow"/.test(policy) && JSON.stringify(JSON.parse(pattern)) === JSON.stringify(command)) allowRule = true;
    }
  }
  // Model the two source-confirmed bypass paths before running the benign
  // command: automatic approval, or a preconfigured explicit allow rule even
  // when the requested approval policy is never and sandbox is read-only.
  if (!allowRule && configuredValue("approvals_reviewer", "user") !== "auto_review"
      && configuredValue("sandbox_mode", "read-only") === "read-only") return;
  const result = spawnSync(command[0], command.slice(1), { cwd: process.cwd(), env: process.env, encoding: "utf8", windowsHide: true, timeout: 5000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
}
function startupHooks(provider) {
  const file = path.join(process.cwd(), provider === "codex" ? ".codex/hooks.json" : ".claude/settings.json");
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const inline = args.includes("--settings") ? JSON.parse(args[args.indexOf("--settings") + 1]) : {};
  const disabled = provider === "codex" ? configOverrides.get("features.hooks") === "false" : inline.disableAllHooks === true;
  const managedFile = process.env.WEB_KIT_TEST_CODE_REVIEW_MANAGED_HOOKS;
  const managed = provider === "claude" && managedFile ? JSON.parse(fs.readFileSync(managedFile, "utf8")) : {};
  const sources = managed.disableAllHooks === true ? [] : [...(disabled ? [] : [settings]), managed];
  for (const source of sources) for (const group of source.hooks?.SessionStart || []) for (const hook of group.hooks || []) {
    assert.equal(hook.type, "command");
    // Deliberately execute the configured benign shell command like a provider
    // lifecycle hook. The positive control proves this can write the marker.
    const result = spawnSync(hook.command, { cwd: process.cwd(), env: process.env, shell: true, encoding: "utf8", windowsHide: true, timeout: 5000 });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
  }
}
function legacyNotification() {
  const file = path.join(process.cwd(), ".codex/config.toml");
  const configured = fs.existsSync(file) ? fs.readFileSync(file, "utf8").match(/^notify\s*=\s*(\[[^\n]*\])/m)?.[1] : undefined;
  const command = JSON.parse(configOverrides.get("notify") ?? configured ?? "[]");
  if (!command.length) return;
  const result = spawnSync(command[0], command.slice(1), { cwd: process.cwd(), env: process.env, encoding: "utf8", windowsHide: true, timeout: 5000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
}
if (args.includes("--fixture-startup-only")) {
  const provider = args[args.indexOf("--fixture-startup-only") + 1];
  assert(["codex", "claude"].includes(provider));
  startupHooks(provider);
  process.exit(0);
}
if (args.includes("--fixture-notify-only")) { legacyNotification(); process.exit(0); }
if (args.includes("--fixture-permission-only")) { permissionProbe(); process.exit(0); }
const recordAudit = (entry) => {
  if (process.env.WEB_KIT_TEST_CODE_REVIEW_AUDIT) fs.appendFileSync(process.env.WEB_KIT_TEST_CODE_REVIEW_AUDIT, JSON.stringify(entry) + "\n");
};
function managedRequirements() {
  if (!mode.startsWith("permission-") && mode !== "configuration-preflight-late-policy") return null;
  const requirements = { allowedApprovalPolicies: ["never"], allowedApprovalsReviewers: ["user"], allowedSandboxModes: ["read-only"], allowedPermissionProfiles: null, defaultPermissions: null, autoReview: null, allowedWindowsSandboxImplementations: null };
  if (mode === "permission-preflight-missing") delete requirements.allowedApprovalPolicies;
  if (mode === "permission-preflight-malformed-list") requirements.allowedSandboxModes = "read-only";
  if (["permission-preflight-deny-approval", "configuration-preflight-late-policy"].includes(mode)) requirements.allowedApprovalPolicies = ["on-request"];
  if (mode === "permission-preflight-deny-reviewer") requirements.allowedApprovalsReviewers = ["auto_review"];
  if (mode === "permission-preflight-deny-sandbox") requirements.allowedSandboxModes = ["workspace-write"];
  if (mode === "permission-preflight-profile") requirements.allowedPermissionProfiles = { managed: true };
  if (mode === "permission-preflight-default-profile") requirements.defaultPermissions = "managed";
  if (mode === "permission-preflight-auto-review") requirements.autoReview = { requiredOnModels: ["preserved-user-model"] };
  if (mode === "permission-preflight-windows") requirements.allowedWindowsSandboxImplementations = ["mxc"];
  return requirements;
}
if (args.includes("app-server")) {
  const printing = args.includes("--print-startup-config");
  assert.deepEqual(args, [...finalConfiguration, "app-server", "--strict-config", ...(printing ? ["--print-startup-config"] : ["--listen", "stdio://"])]);
  assert.equal(process.cwd(), project);
  recordAudit({ kind: printing ? "permission-preflight" : "configuration-preflight", pid: process.pid, run_id: runId, context_file: contextFile, args });
  if (printing) {
    if (mode === "permission-preflight-timeout") await new Promise(resolve => setTimeout(resolve, 10000));
    if (mode === "permission-preflight-exit") { process.stderr.write("DO_NOT_LEAK_PREFLIGHT_SECRET"); process.exit(17); }
    if (mode === "permission-preflight-malformed") { console.log("{invalid-json"); process.exit(0); }
    const configRequirements = { supportsIndependentSpeedModes: true, requirements: mode === "configuration-preflight-late-policy" ? null : managedRequirements() };
    if (mode === "permission-preflight-missing-envelope") delete configRequirements.requirements;
    console.log(JSON.stringify({ appServerVersion: "fixture-1", configRequirements }));
    process.exit(0);
  }
  if (mode === "configuration-preflight-exit") { process.stderr.write("DO_NOT_LEAK_PREFLIGHT_SECRET"); process.exit(17); }
  const reader = createInterface({ input: process.stdin });
  let step = 0;
  for await (const line of reader) {
    const request = JSON.parse(line);
    if (step === 0) {
      assert.equal(request.id, 1);
      assert.equal(request.method, "initialize");
      assert.match(request.params.clientInfo.name, /^web-kit-review-[0-9a-f-]{36}$/);
      assert.deepEqual(request.params.capabilities, { experimentalApi: true, explicitGatewayOauth: true });
      recordAudit({ kind: "configuration-client", pid: process.pid, run_id: runId, context_file: contextFile, name: request.params.clientInfo.name });
      if (mode === "configuration-preflight-malformed") { console.log("{invalid-json"); process.exit(0); }
      if (mode === "configuration-preflight-timeout") await new Promise(resolve => setTimeout(resolve, 10000));
      const platformOs = ({ win32: "windows", darwin: "macos" })[process.platform] || process.platform;
      console.log(JSON.stringify({ id: mode === "configuration-preflight-wrong-id" ? 99 : 1, result: { codexHome: mode === "configuration-preflight-home-mismatch" ? path.dirname(home) : home, platformFamily: process.platform === "win32" ? "windows" : "unix", platformOs: mode === "configuration-preflight-platform-mismatch" ? "unsupported-os" : platformOs } }));
      step = 1;
    } else if (step === 1) {
      assert.deepEqual(request, { method: "initialized" });
      step = 2;
    } else if (step === 2) {
      assert.deepEqual(request, { id: 2, method: "config/read", params: { includeLayers: true, cwd: project } });
      if (mode === "configuration-preflight-missing-response") process.exit(0);
      const config = { approval_policy: configuredValue("approval_policy", "on-request"), approvals_reviewer: configuredValue("approvals_reviewer", "user"), sandbox_mode: configuredValue("sandbox_mode", "workspace-write"), features: { apps: false, plugins: false, hooks: false }, notify: [], mcp_servers: Object.fromEntries(servers.map(name => [name, { enabled: false }])), windows: { sandbox: "elevated", allow_mxc: false }, model: "preserved-user-model", model_providers: { fixture: { api_key: "DO_NOT_LEAK_PREFLIGHT_SECRET" } } };
      if (mode === "configuration-preflight-approval") config.approval_policy = "on-request";
      if (mode === "configuration-preflight-reviewer") config.approvals_reviewer = "auto_review";
      if (mode === "configuration-preflight-sandbox") config.sandbox_mode = "workspace-write";
      if (mode === "configuration-preflight-notify") config.notify = ["node", ".codex/write-hook-marker.cjs"];
      if (mode === "configuration-preflight-mcp") config.mcp_servers.workspace.enabled = true;
      if (mode === "configuration-preflight-windows") config.windows.sandbox = "unelevated";
      if (mode === "configuration-preflight-mxc") config.windows.allow_mxc = true;
      if (mode === "configuration-preflight-user-profile") { config.permissions = { inherited: {} }; config.default_permissions = "inherited"; }
      const layers = [
        { name: { type: "system", file: path.join(systemHome, "config.toml") }, version: "fixture", config: {} },
        { name: { type: "user", file: path.join(home, "config.toml"), profile: null }, version: "fixture", config: { approvals_reviewer: "auto_review", model: "preserved-user-model" } },
        { name: { type: "project", dotCodexFolder: path.join(project, ".codex") }, version: "fixture", config: {} },
        { name: { type: "sessionFlags" }, version: "fixture", config: {} },
      ];
      if (process.env.WEB_KIT_TEST_CODE_REVIEW_DISABLED_PROJECT) layers.push({ name: { type: "project", dotCodexFolder: process.env.WEB_KIT_TEST_CODE_REVIEW_DISABLED_PROJECT }, version: "fixture", config: {}, disabledReason: "untrusted project" });
      if (mode === "configuration-preflight-unknown-layer") layers.push({ name: { type: "unsupportedFuturePolicy" }, version: "fixture", config: {} });
      if (mode === "configuration-preflight-missing-system") layers.shift();
      const result = { config, origins: {}, layers };
      if (mode === "configuration-preflight-missing-layers") delete result.layers;
      console.log(JSON.stringify({ id: 2, result }));
      step = 3;
    } else {
      assert.equal(step, 3);
      assert.deepEqual(request, { id: 3, method: "configRequirements/read" });
      console.log(JSON.stringify({ id: 3, result: { supportsIndependentSpeedModes: true, requirements: managedRequirements() } }));
      step = 4;
    }
  }
  assert.equal(step, 4, "Configuration inspection must complete before closing stdin.");
  process.exit(0);
}
if (args.includes("features") && args.includes("list")) {
  assert.deepEqual(args, [...restrictedConfiguration, "features", "list"], "Codex must restrict hooks before inspecting effective feature policy.");
  assert.equal(process.env.WEB_KIT_CONTEXT_SUPERVISOR_BYPASS, "1");
  assert.equal(process.env.WEB_KIT_CODE_REVIEW_ACTIVE, "1");
  assert.equal(process.cwd(), project);
  recordAudit({ kind: "hook-preflight", pid: process.pid, run_id: runId, context_file: contextFile, args });
  if (mode === "hook-preflight-timeout") await new Promise(resolve => setTimeout(resolve, 10000));
  if (mode === "hook-preflight-exit") { process.stderr.write("DO_NOT_LEAK_PREFLIGHT_SECRET"); process.exit(17); }
  if (mode === "hook-preflight-malformed") { console.log("unrecognized feature report"); process.exit(0); }
  console.log("apps stable false\nplugins stable false");
  if (mode !== "hook-preflight-missing") console.log(`hooks stable ${mode === "hook-preflight-enabled" ? "true" : "false"}`);
  if (mode === "hook-preflight-duplicate") console.log("hooks stable true");
  process.exit(0);
}
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
startupHooks(provider);
if (provider === "codex") {
  permissionProbe();
  assert.deepEqual(args.slice(0, args.indexOf("exec")), finalConfiguration, "Codex must disable every listed MCP server and prevent approvals without model or effort overrides.");
  assert(args.includes("--strict-config"), "Inference must reject unsupported protection settings just like its preflights.");
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
}
else {
  assert.deepEqual(JSON.parse(args[args.indexOf("--settings") + 1]), { disableAllHooks: true }, "Claude's per-session hook restriction must preserve unrelated settings.");
  assert.equal(args[args.indexOf("--permission-mode") + 1], "plan");
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Glob,Grep", "Claude must have only source-reading tools.");
  assert.equal(args[args.indexOf("--disallowedTools") + 1], "mcp__*", "Claude MCP tools must not bypass the read-only built-in set.");
  assert.equal(args[args.indexOf("--add-dir") + 1], path.dirname(contextFile), "Claude must be able to read the private context and diff.");
}
const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
assert(context.original_intent && context.snapshot && context.report_schema, "Incomplete review context.");
const repositoryPath = file => [context.snapshot.project_prefix, file].filter(Boolean).join("/");
assert.deepEqual(context.specification, context.snapshot.specification, "Review context must preserve the registered specification identity and digests.");
if (context.specification?.file) assert(fs.readFileSync(path.join(context.snapshot.repository_root || project, context.specification.file), "utf8").trim(), "The reviewer must read the registered specification, including ignored plan files.");
assert.equal(path.dirname(context.change_evidence), path.dirname(contextFile), "Diff evidence must share the private context directory.");
assert.equal(path.basename(context.change_evidence), "changes.patch");
const changeEvidence = fs.readFileSync(context.change_evidence, "utf8");
const sectionOrder = ["committed", "staged", "unstaged"].map(name => changeEvidence.indexOf(`\n# SECTION ${name}\n`));
assert(sectionOrder.every((offset, index) => offset >= 0 && (index === 0 || offset > sectionOrder[index - 1])), "Complete ordered diff sections are missing.");
assert(changeEvidence.includes(`diff --git a/${repositoryPath("src/feature.js")} b/${repositoryPath("src/feature.js")}`), "The actual source change is missing from the diff evidence.");
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
  assert(context.untracked_files.includes(repositoryPath("src/untracked.js")), "The untracked source file inventory is incomplete.");
  assert(fs.readFileSync(path.join(project, "src/untracked.js"), "utf8").includes("untrackedEvidence"));
}
const prompt = provider === "codex" ? args.at(-1) : args[args.indexOf("-p") + 1];
assert(prompt.includes("realistic counterexamples") && prompt.includes("No minimum finding quota"), "Strict evidence-based reviewer prompt missing.");
assert(prompt.includes("change_evidence"), "Reviewer must inspect the captured diff.");
assert(prompt.includes("specification.file") && prompt.includes("ignored by Git"), "Reviewer must inspect the registered specification outside the captured diff.");
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
  id: "BUG-OWNERSHIP", severity: "P1", file: repositoryPath("src/feature.js"), line: 1, symbol: "canCancel",
  title: "A user can cancel another user's booking",
  trigger: "Call canCancel with user-a and a booking owned by user-b.",
  impact: "The owner boundary permits an unauthorized cancellation.",
  evidence: "Direct fixture invocation returns true for two different user IDs.",
  recommendation: "Compare the booking owner with the authenticated user's ID."
};
const output = {
  schema_version: 1,
  summary: vulnerable ? "Confirmed booking ownership defect." : "Owner and non-owner behavior verified in the fixture.",
  files_reviewed: [...new Set([...context.snapshot.files, ...(context.specification?.file ? [context.specification.file] : [])])],
  requirements: context.requirements.map(req => ({ id: req.id, status: vulnerable ? "FAIL" : "PASS", evidence: "Invoked canCancel for owner and non-owner inputs." })),
  scenarios: context.requirements.flatMap(req => [
    { requirement_id: req.id, kind: "normal", status: own === true ? "PASS" : "FAIL", scenario: "Cancel own booking.", expected: "Allowed.", observed: String(own), evidence: "Direct canCancel invocation with matching IDs." },
    { requirement_id: req.id, kind: "negative", status: vulnerable ? "FAIL" : "PASS", scenario: "Cancel another user's booking.", expected: "Denied.", observed: String(other), evidence: "Direct canCancel invocation with different IDs." },
    { requirement_id: req.id, kind: "integration", status: "NOT_APPLICABLE", scenario: "External system integration.", expected: "No integration in this isolated fixture.", observed: "The only consumer is the supplied unit test.", evidence: "src/feature.js exports a pure predicate; no database or network exists in this fixture." }
  ]),
  boundaries: [{ name: "Authenticated user to booking owner", status: "REVIEWED", files: [repositoryPath("src/feature.js")], evidence: "Compared matching and different IDs by invoking the exported predicate." }],
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
  output.boundaries = [{ name: "Module export to test consumer", status: "REVIEWED", files: ["src/feature.js", "tests/feature.test.mjs"].map(repositoryPath), evidence: "The named export resolves and its value is true." }];
}
if (mode === "empty-coverage") { output.files_reviewed = []; output.requirements = []; output.scenarios = []; }
if (mode === "drop-prior") { output.findings = []; output.prior_findings = []; output.requirements.forEach(item => { item.status = "PASS"; }); output.scenarios.forEach(item => { if (item.status === "FAIL") item.status = "PASS"; }); }
if (mode === "mutate") fs.appendFileSync(path.join(project, "src/feature.js"), "\n// Unauthorized reviewer edit.\n");
if (mode === "stage") {
  const result = spawnSync("git", ["add", "src/feature.js"], { cwd: project, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
const message = mode === "malformed" ? "{not-valid-json" : JSON.stringify(output);
if (provider === "codex") { legacyNotification(); console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: message } })); }
else console.log(JSON.stringify({ result: message }));
