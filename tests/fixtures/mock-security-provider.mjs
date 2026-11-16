#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

// Regression fixture: verifies redacted untracked evidence exists only during the provider review and is cleaned up afterward.
const project = process.env.WEB_KIT_SECURITY_PROJECT_ROOT;
if (!project) {
  console.error("WEB_KIT_SECURITY_PROJECT_ROOT missing");
  process.exit(2);
}
if (process.env.WEB_KIT_CONTEXT_SUPERVISOR_BYPASS !== "1") {
  console.error("Security reviewer did not bypass the transparent context supervisor");
  process.exit(4);
}

const args = process.argv.slice(2);
const prompt = args[0] === "exec" ? String(args.at(-1) || "") : String(args[args.indexOf("-p") + 1] || "");
const contextMatch = prompt.match(/^- (.+\/runtime\/review-context-\d+\.json)$/m);
if (!contextMatch) { console.error("review context missing from reviewer prompt"); process.exit(9); }
const context = JSON.parse(fs.readFileSync(path.resolve(project, contextMatch[1]), "utf8"));
const previousMatch = prompt.match(/^- (.+?) \(previous review;/m);
const previous = previousMatch ? JSON.parse(fs.readFileSync(path.resolve(project, previousMatch[1]), "utf8")) : null;
if (process.env.WEB_KIT_TEST_REQUIRE_UNTRACKED_EVIDENCE === "1") {
  const match = prompt.match(/- (.+?) \(EPHEMERAL_UNTRACKED_EVIDENCE:/);
  if (!match) { console.error("ephemeral untracked evidence path missing from reviewer prompt"); process.exit(5); }
  const evidenceFile = match[1];
  if (!fs.existsSync(evidenceFile)) { console.error("ephemeral untracked evidence file missing during provider review"); process.exit(6); }
  const evidenceText = fs.readFileSync(evidenceFile, "utf8");
  if (!evidenceText.includes("eval(input)")) { console.error("ephemeral evidence omitted generic untracked source content"); process.exit(7); }
  const sentinel = process.env.WEB_KIT_TEST_SECRET_SENTINEL || "";
  if (sentinel && evidenceText.includes(sentinel)) { console.error("secret sentinel leaked into reviewer evidence without redaction"); process.exit(8); }
  const auditFile = process.env.WEB_KIT_TEST_UNTRACKED_AUDIT_FILE;
  if (auditFile) fs.writeFileSync(auditFile, evidenceFile, "utf8");
}
const source = fs.readFileSync(path.join(project, "src", "admin.js"), "utf8");
const fixed = source.includes("req.user.role === \"admin\"");
const payload = fixed
  ? {
      summary: "The prior authorization bypass is no longer reproducible.",
      limitations: [],
      coverage: [
        { area: "Authorization & Multi-tenancy", status: "REVIEWED", notes: "Verified the admin action now enforces the authenticated server-side role." },
        { area: "API & Input Validation", status: "REVIEWED", notes: "Reviewed the changed route and request trust boundary." },
        { area: "Secrets & Credentials", status: "REVIEWED", notes: "No secret material introduced by the branch." },
      ],
      findings: [],
    }
  : {
      summary: "The branch introduces a server-side authorization bypass on an administrative route.",
      limitations: [],
      coverage: [
        { area: "Authorization & Multi-tenancy", status: "REVIEWED", notes: "Traced the changed admin route and authorization decision." },
        { area: "API & Input Validation", status: "REVIEWED", notes: "Reviewed request-controlled role data and route behavior." },
        { area: "Secrets & Credentials", status: "REVIEWED", notes: "No secret material introduced by the branch." },
      ],
      findings: [
        {
          fingerprint: "admin-route-client-role-authorization",
          title: "Administrative action trusts a client-controlled role",
          severity: "HIGH",
          confidence: "HIGH",
          category: "Broken Access Control",
          file: "src/admin.js",
          line: 2,
          owasp: ["A01:2021 Broken Access Control"],
          cwe: ["CWE-602", "CWE-862"],
          advisories: [],
          evidence: "The route authorizes the action using req.body.role instead of the authenticated server-side identity.",
          attack_scenario: "An authenticated non-admin sends role=admin in the request body and reaches the administrative action.",
          impact: "Privilege escalation to an administrative operation.",
          recommendation: "Authorize using the authenticated principal's server-side role/permission and ignore client claims for privilege decisions.",
          validation: "Add an integration test proving a non-admin receives 403 even when the body contains role=admin.",
        },
      ],
    };

payload.review_status = "COMPLETE";
payload.files_reviewed = [...new Set([...context.changed_files, ...(previous?.findings || []).map((finding) => finding.file), "src/admin.js"].filter(Boolean))].map((file) => {
  fs.readFileSync(path.resolve(project, file));
  return { file, evidence: `Inspected source input ${file} and the affected authorization boundary.` };
});
payload.coverage = context.attack_surfaces.map((area) => ({ area: area.name, status: "REVIEWED", notes: `Inspected changed source and related trust boundaries for ${area.name}.` }));
payload.prior_findings = (previous?.findings || []).map((finding) => ({
  fingerprint: finding.fingerprint,
  status: payload.findings.some((current) => current.fingerprint === finding.fingerprint) ? "OPEN" : "RESOLVED",
  evidence: fixed ? "Rechecked src/admin.js: authorization now uses the authenticated req.user.role instead of req.body.role." : "Rechecked src/admin.js: the authorization decision still uses request-controlled req.body.role.",
}));

const mode = process.env.WEB_KIT_TEST_SECURITY_MODE || "complete";
const sandboxError = "Windows sandbox setup failed: SetNamedSecurityInfoW, error 5 (Access is denied).";
if (mode === "exit-error") { console.error(sandboxError); process.exit(5); }
if (mode === "stderr-sandbox-error") console.error(sandboxError);
if (mode === "failure-handling-evidence") {
  payload.summary = "Completed review of the Windows sandbox error-handling correction.";
  payload.files_reviewed[0].evidence = "Inspected the SetNamedSecurityInfoW error 5 regression and verified the source error handling.";
  payload.coverage[0].notes = "Verified sandbox failure handling now preserves findings.";
}
if (mode === "sandbox-blocked") {
  Object.assign(payload, { review_status: "BLOCKED", summary: "Independent review was impossible.", limitations: [sandboxError], files_reviewed: [], coverage: [], prior_findings: [], findings: [] });
}
if (mode === "contradictory-complete") {
  Object.assign(payload, { summary: "Independent review was impossible.", limitations: [sandboxError], findings: [] });
  payload.prior_findings = payload.prior_findings.map((finding) => ({ ...finding, status: "RESOLVED" }));
}
if (mode === "partial") payload.review_status = "PARTIAL";
if (mode === "missing-status") delete payload.review_status;
if (mode === "invalid-status") payload.review_status = "SUCCESS";
if (mode === "missing-source") payload.files_reviewed = [];
if (mode === "partial-coverage") payload.coverage = payload.coverage.slice(1);
if (mode === "limited-coverage") payload.coverage[0].status = "LIMITED";
if (mode === "malformed-coverage") payload.coverage = [null];
if (mode === "malformed-findings") payload.findings = [null];
if (mode === "omitted-recheck") { payload.prior_findings = []; payload.findings = []; }
if (mode === "unsupported-resolution") {
  payload.findings = [];
  payload.prior_findings = payload.prior_findings.map((finding) => ({ ...finding, status: "RESOLVED", evidence: "" }));
}

const message = mode === "malformed" ? "{ invalid review JSON" : JSON.stringify(payload);
if (args[0] === "exec") {
  if (mode === "runtime-tool-error") process.stdout.write(`${JSON.stringify({ type: "item.completed", item: { type: "command_execution", status: "failed", exit_code: 1, aggregated_output: sandboxError } })}\n`);
  if (mode === "runtime-malformed-error") process.stdout.write(`${JSON.stringify({ type: "item.completed", item: { type: "command_execution", status: "failed", exit_code: 1, error: { toString: null, detail: sandboxError } } })}\n`);
  process.stdout.write(`${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: message } })}\n`);
  if (mode === "runtime-error") process.stdout.write(`${JSON.stringify({ type: "turn.failed", error: { message: sandboxError } })}\n`);
} else if (args.includes("--output-format")) {
  const isGemini = args.includes("--approval-mode");
  const envelope = { ...(isGemini ? { response: message } : { result: message }), ...(mode === "runtime-error" ? { is_error: true, error: sandboxError } : {}) };
  if (mode.startsWith("malformed-envelope-")) envelope[mode.slice("malformed-envelope-".length)] = { toString: null };
  process.stdout.write(JSON.stringify(envelope));
} else {
  console.error(`unexpected mock provider invocation: ${args.join(" ")}`);
  process.exit(3);
}
