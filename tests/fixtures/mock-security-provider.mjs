#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

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
if (process.env.WEB_KIT_TEST_REQUIRE_UNTRACKED_EVIDENCE === "1") {
  const prompt = args[0] === "exec" ? String(args.at(-1) || "") : String(args[args.indexOf("-p") + 1] || "");
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

const message = JSON.stringify(payload);
if (args[0] === "exec") {
  process.stdout.write(`${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: message } })}\n`);
} else if (args.includes("--output-format")) {
  const isGemini = args.includes("--approval-mode");
  process.stdout.write(JSON.stringify(isGemini ? { response: message } : { result: message }));
} else {
  console.error(`unexpected mock provider invocation: ${args.join(" ")}`);
  process.exit(3);
}
