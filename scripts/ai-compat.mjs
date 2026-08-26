#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

export const ROLE_START = "<!-- WEB-AGENT-KIT:AI-ROLES:START -->";
export const ROLE_END = "<!-- WEB-AGENT-KIT:AI-ROLES:END -->";
const LEGACY_BRIDGE_START = "<!-- WEB-AGENT-KIT:AI-BRIDGE:START -->";
const LEGACY_BRIDGE_END = "<!-- WEB-AGENT-KIT:AI-BRIDGE:END -->";
const SUMMARY_START = "<!-- WEB-AGENT-KIT:PROJECT-SUMMARY:START -->";
const SUMMARY_END = "<!-- WEB-AGENT-KIT:PROJECT-SUMMARY:END -->";

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return {}; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function replaceMarkedSection(text, startMarker, endMarker, section) {
  const start = text.indexOf(startMarker);
  if (start < 0) return null;
  const endStart = text.indexOf(endMarker, start);
  if (endStart < 0) return null;
  const end = endStart + endMarker.length;
  return text.slice(0, start) + section + text.slice(end);
}

function appendWithoutChangingExisting(text, section) {
  if (!text) return `${section}\n`;
  const separator = text.endsWith("\n") || text.endsWith("\r") ? "" : "\n";
  return `${text}${separator}\n${section}\n`;
}

export function upsertRoles(file, section, initialContent = null) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    const pieces = [];
    if (initialContent) pieces.push(initialContent.replace(/\n+$/, ""));
    pieces.push(section.replace(/\n+$/, ""));
    fs.writeFileSync(file, `${pieces.join("\n\n")}\n`, "utf8");
    return "created-with-summary-and-roles";
  }

  const current = fs.readFileSync(file, "utf8");
  let updated = replaceMarkedSection(current, ROLE_START, ROLE_END, section);
  if (updated === null) updated = replaceMarkedSection(current, LEGACY_BRIDGE_START, LEGACY_BRIDGE_END, section);
  if (updated === null) updated = appendWithoutChangingExisting(current, section);
  fs.writeFileSync(file, updated, "utf8");
  return "preserved-existing-added-roles";
}

export function unmanagedRoleText(file) {
  if (!fs.existsSync(file)) return "";
  let text = fs.readFileSync(file, "utf8");
  for (const [startMarker, endMarker] of [
    [ROLE_START, ROLE_END],
    [LEGACY_BRIDGE_START, LEGACY_BRIDGE_END],
  ]) {
    const start = text.indexOf(startMarker);
    const endStart = start >= 0 ? text.indexOf(endMarker, start) : -1;
    if (start >= 0 && endStart >= 0) text = text.slice(0, start) + text.slice(endStart + endMarker.length);
  }
  return text;
}

export function findUnmanagedGraphifyConflicts(file) {
  const lower = unmanagedRoleText(file).toLowerCase();
  const patterns = new Map([
    ["graphify update", "direct Graphify update command outside the managed roles block"],
    ["graphify query", "Graphify-first query instruction outside the managed roles block"],
    ["/graphify .", "direct Graphify build/query command outside the managed roles block"],
    ["always use graphify", "unconditional Graphify-first instruction outside the managed roles block"],
    ["graphify first", "Graphify-first instruction outside the managed roles block"],
  ]);
  return [...patterns.entries()].filter(([needle]) => lower.includes(needle)).map(([, message]) => message);
}

function flattenStack(profile) {
  const values = [];
  for (const items of Object.values(profile.technology_groups || {})) if (Array.isArray(items)) values.push(...items);
  return [...new Set(values)].sort();
}

export function projectSummary(profile, assistantName) {
  const stack = flattenStack(profile);
  const structure = (profile.structure || []).slice(0, 16);
  const manifests = (profile.manifests || []).slice(0, 8);
  const tests = (profile.test_roots || []).slice(0, 8);
  const inline = (values, empty = "none detected") => values.length ? values.map((v) => `\`${v}\``).join(", ") : empty;
  const structureBlock = structure.length ? structure.join("\n") : "(no shallow structure detected)";

  return `${SUMMARY_START}
# Project Summary — ${profile.name || "Web Project"}

This summary was created only because this ${assistantName} project-instruction file did not already exist. Web Kit will not rewrite this summary on later updates. Current machine-readable project metadata lives in \`.agent-core/index/project-profile.json\`.

- **Project:** \`${profile.name || "unknown"}\`
- **Domain:** Web Development
- **Detected stack:** ${inline(stack)}
- **Manifests/build files:** ${inline(manifests)}
- **Test roots:** ${inline(tests)}

## Shallow project map

\`\`\`text
${structureBlock}
\`\`\`

${SUMMARY_END}`;
}

export function rolesMarkdown(assistantName) {
  return `${ROLE_START}
## iHGEN Web Development Agent Kit — ${assistantName} Roles

Preserve all project/user instructions outside this managed block. This block adds Web-Kit roles; it does not replace this file.

For Web-Kit-managed engineering work:

1. Follow \`.agent-core/rules/workflow.md\` as the single engineering lifecycle.
2. Follow \`.agent-core/rules/repository-navigation.md\` for question-aware repository navigation.
3. Follow \`.agent-core/rules/context-rollover.md\` for provider-session lifetime and fresh-context handoffs. Automatic rollover is an outer-session concern, not a second engineering workflow.
4. Read \`.agent-core/index/project-profile.json\` first for lightweight project routing metadata.
5. Use \`.agent-core/routing/context-policy.json\` to keep context bounded and activate only the roles/skills needed for the current step.
6. If \`.agent-core/state/graphify-bootstrap-role.md\` exists, treat it as a **temporary current-AI role** and execute it before normal Graphify-assisted repository work. After the graph is built, follow that role's completion command; successful completion deletes the temporary role.
7. Act only in the role routed for the current phase: Captain, discovery/indexing/router, architect/planner, implementation worker, specialist reviewer, Context Rollover Manager, Handoff Validator, or Final Integration Validator.
8. Never self-approve a plan, implementation handoff, or final integration result when the workflow requires an independent validator.
9. For exact text/symbol/path lookup, use targeted current-source search (\`rg\` or equivalent) directly.
10. For relationship/dependency/ownership/impact discovery, run \`node .agent-core/rules/graphify-refresh.mjs --project . --task-id <task-id>\` before the first Graphify query. Use Graphify only when the resulting state is fresh, then verify exact source before planning or editing.
11. After every completed code-changing step, run the same Node Graph Refresh Gate once before Handoff Validator or another agent relies on Graphify.
12. Never run \`graphify update .\` directly as a replacement for the managed Graph Refresh Gate.
13. Current source, current diff, tests/build, and runtime evidence override Graphify/index/context-handoff summaries.
14. When \`WEB_KIT_CONTEXT_SUPERVISOR_ACTIVE=1\`, use the provider normally and finish the current assistant turn safely. Do not manually run \`/clear\`, \`/new\`, \`/compact\`, or ask the user to restart for context pressure; the outer transparent supervisor owns threshold detection, handoff persistence, and fresh native provider-session creation.
15. A fresh session started by the transparent supervisor must read the exact referenced rollover handoff first, verify material claims against current repository evidence, avoid repeating completed work, and resume its recorded next action.
16. When \`WEB_KIT_SESSION_CONTROLLER=1\`, the explicit headless Session Controller fallback owns rollover; follow the progress protocol it injects for that cycle and do not reset context manually.
17. Web Kit runtime commands use Node.js. Do not require a system Python installation for Web Kit itself.
18. Treat the exact user phrase \`run security-review\` (and the equivalent \`run security review\`) as a provider-neutral Web Kit execution command, not as a request to explain security reviewing. Read \`.agent-core/rules/security-review.md\`, then execute \`node .agent-core/bin/security-review.mjs --project .\` from the project root and return the generated PR-style findings to the user.
19. Map simple suffixes consistently: \`run security-review deep\` adds \`--deep\`; \`run security-review base <branch>\` adds \`--base <branch>\`; \`run security-review provider <codex|claude|gemini>\` adds \`--provider <name>\`. The same engine owns first review and re-review automatically.
20. The Security PR Reviewer is independent and read-only. Do not fix findings during the review. After findings are returned, wait for a separate implementation/fix request; a later \`run security-review\` performs the independent re-review.
21. If this AI client cannot execute local commands/tools, do not pretend the security review ran. Tell the user to run \`npx @ihgen/web-kit security-review\` in the project terminal.

If project-owned instructions outside this block conflict with Web-Kit workflow mechanics, preserve them but report the conflict with \`doctor\`; do not silently delete user content.
${ROLE_END}`;
}

function cursorInitial(profile) {
  return `---\ndescription: Project instructions and iHGEN Web Kit roles\nalwaysApply: true\n---\n\n${projectSummary(profile, "Cursor")}`;
}

export function applyAiCompatibility(project, profile = null) {
  project = path.resolve(project);
  profile = profile || readJson(path.join(project, ".agent-core", "index", "project-profile.json"));

  const targets = {
    agents: [path.join(project, "AGENTS.md"), "AGENTS-compatible assistants"],
    claude: [path.join(project, "CLAUDE.md"), "Claude Code"],
    gemini: [path.join(project, "GEMINI.md"), "Gemini CLI"],
    "github-copilot": [path.join(project, ".github", "copilot-instructions.md"), "GitHub Copilot"],
  };

  const actions = {};
  for (const [key, [file, label]] of Object.entries(targets)) actions[key] = upsertRoles(file, rolesMarkdown(label), projectSummary(profile, label));

  const cursorPath = path.join(project, ".cursor", "rules", "ihgen-web-kit.mdc");
  actions.cursor = upsertRoles(cursorPath, rolesMarkdown("Cursor"), cursorInitial(profile));

  const compatibility = {
    canonical_instructions: "AGENTS.md",
    canonical_workflow: ".agent-core/rules/workflow.md",
    canonical_navigation_rule: ".agent-core/rules/repository-navigation.md",
    automatic_context_rollover_rule: ".agent-core/rules/context-rollover.md",
    security_review_rule: ".agent-core/rules/security-review.md",
    security_review_engine: ".agent-core/bin/security-review.mjs",
    security_review_terminal_command: "npx @ihgen/web-kit security-review",
    security_review_provider_trigger: "run security-review",
    security_review_provider_backends: ["codex", "claude", "gemini"],
    transparent_context_supervisor_home: "~/.web-kit",
    transparent_provider_commands: ["codex", "claude"],
    transparent_context_rollover_threshold_percent: 50,
    explicit_session_controller_fallback: ".agent-core/bin/session-controller.mjs",
    temporary_graphify_role: ".agent-core/state/graphify-bootstrap-role.md",
    native_agents_md: ["codex", "kimi", "agents-md-compatible"],
    managed_roles: {
      agents: "AGENTS.md",
      claude: "CLAUDE.md",
      gemini: "GEMINI.md",
      "github-copilot": ".github/copilot-instructions.md",
      cursor: ".cursor/rules/ihgen-web-kit.mdc",
    },
    file_policy: "Existing instruction files are preserved; Web Kit changes only its marked roles block. Missing instruction files are created once with a project summary plus the roles block.",
    runtime: "node+npm",
    actions,
  };

  const cfgPath = path.join(project, ".agent-kit.json");
  const cfg = readJson(cfgPath);
  if (Object.keys(cfg).length) {
    cfg.ai_compatibility = compatibility;
    writeJson(cfgPath, cfg);
  }

  const profilePath = path.join(project, ".agent-core", "index", "project-profile.json");
  const currentProfile = readJson(profilePath);
  if (Object.keys(currentProfile).length) {
    currentProfile.ai_compatibility = compatibility;
    writeJson(profilePath, currentProfile);
  }

  return compatibility;
}
