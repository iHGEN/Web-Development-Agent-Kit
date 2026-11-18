#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const ROLE_START = "<!-- WEB-AGENT-KIT:AI-ROLES:START -->";
export const ROLE_END = "<!-- WEB-AGENT-KIT:AI-ROLES:END -->";
const LEGACY_BRIDGE_START = "<!-- WEB-AGENT-KIT:AI-BRIDGE:START -->";
const LEGACY_BRIDGE_END = "<!-- WEB-AGENT-KIT:AI-BRIDGE:END -->";
const SUMMARY_START = "<!-- WEB-AGENT-KIT:PROJECT-SUMMARY:START -->";
const SUMMARY_END = "<!-- WEB-AGENT-KIT:PROJECT-SUMMARY:END -->";
const SHARED_TARGETS = {
  agents: ["AGENTS.md", "AGENTS-compatible assistants"],
  claude: ["CLAUDE.md", "Claude Code"],
  gemini: ["GEMINI.md", "Gemini CLI"],
  "github-copilot": [".github/copilot-instructions.md", "GitHub Copilot"],
  cursor: [".cursor/rules/ihgen-web-kit.mdc", "Cursor"],
};
const LOCAL_TARGETS = {
  agents: [".agent-core/instructions/AGENTS.md", "AGENTS-compatible assistants"],
  claude: [".agent-core/instructions/CLAUDE.md", "Claude Code"],
  gemini: [".agent-core/instructions/GEMINI.md", "Gemini CLI"],
  "github-copilot": [".agent-core/instructions/copilot-instructions.md", "GitHub Copilot"],
  cursor: [".agent-core/instructions/ihgen-web-kit.mdc", "Cursor"],
};
const LOCAL_ADAPTER_MARKER = "<!-- WEB-AGENT-KIT:LOCAL-ADAPTER -->";
const LOCAL_ADAPTER_FILES = {
  "github-copilot": ".github/instructions/ihgen-web-kit-local.instructions.md",
  cursor: ".cursor/rules/ihgen-web-kit-local.mdc",
};
const GEMINI_SETTINGS = ".gemini/settings.json";
const GEMINI_CONTEXT = LOCAL_TARGETS.gemini[0];
const GEMINI_ADAPTER_STATE = ".agent-core/instructions/.gemini-adapter-state.json";
const ADAPTER_IGNORE_COMMENT = "# iHGEN Web Kit private adapter";
export const LOCAL_SCOPE_FILE = ".agent-core/instructions/.local-scope.json";

function gitResult(project, args) {
  return spawnSync("git", args, { cwd: project, encoding: "utf8", windowsHide: true });
}

function gitRoot(project) {
  const result = gitResult(project, ["rev-parse", "--show-toplevel"]);
  return !result.error && result.status === 0 ? path.resolve(result.stdout.trim()) : null;
}

function isTracked(project, relative) {
  const root = gitRoot(project);
  if (!root) return false;
  const relativeToRoot = path.relative(root, path.join(project, relative));
  const result = spawnSync("git", ["ls-files", "--error-unmatch", "--", relativeToRoot], {
    cwd: root, encoding: "utf8", windowsHide: true,
  });
  return result.status === 0;
}

function hasUnsafeAdapterPath(project, relative) {
  let current = project;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function isAdapterProtected(project, relative) {
  const root = gitRoot(project);
  if (root) return gitResult(project, ["check-ignore", "-q", "--", relative]).status === 0;
  const ignore = path.join(project, path.dirname(relative), ".gitignore");
  return fs.existsSync(ignore) && fs.readFileSync(ignore, "utf8").split(/\r?\n/).includes(`/${path.basename(relative)}`);
}

function adapterIgnoreContent(relative) {
  return `${ADAPTER_IGNORE_COMMENT}\n/.gitignore\n/${path.basename(relative)}\n`;
}

function gitExcludeInfo(project, relative) {
  const root = gitRoot(project);
  if (!root) return null;
  const gitPath = gitResult(project, ["rev-parse", "--git-path", "info/exclude"]);
  if (gitPath.error || gitPath.status !== 0) return null;
  const target = gitPath.stdout.trim();
  if (!target) return null;
  const repoRelative = path.relative(root, path.join(project, relative)).split(path.sep).join("/");
  if (repoRelative.startsWith("../") || repoRelative === ".." || /[\r\n]/.test(repoRelative)) return null;
  return {
    file: path.isAbsolute(target) ? target : path.resolve(project, target),
    pattern: `/${repoRelative.replace(/[\\*?\[\]]/g, "\\$&")}`,
  };
}

function protectAdapter(project, relative) {
  const file = path.join(project, relative);
  const ignoreFile = path.join(path.dirname(file), ".gitignore");
  // This only creates new, narrowly scoped local ignore files; existing team
  // .gitignore files are never rewritten, even when they are untracked.
  if (!fs.existsSync(ignoreFile)) {
    fs.mkdirSync(path.dirname(ignoreFile), { recursive: true });
    fs.writeFileSync(ignoreFile, adapterIgnoreContent(relative), "utf8");
  }
  const root = gitRoot(project);
  if (!root) return isAdapterProtected(project, relative);
  const info = gitExcludeInfo(project, relative);
  if (!info) return false;
  fs.mkdirSync(path.dirname(info.file), { recursive: true });
  const existing = fs.existsSync(info.file) ? fs.readFileSync(info.file, "utf8") : "";
  if (!existing.split(/\r?\n/).includes(info.pattern)) {
    fs.appendFileSync(info.file, `${existing && !existing.endsWith("\n") ? "\n" : ""}${ADAPTER_IGNORE_COMMENT}\n${info.pattern}\n`, "utf8");
  }
  return isAdapterProtected(project, relative);
}

function unprotectAdapter(project, relative) {
  const info = gitExcludeInfo(project, relative);
  if (info && fs.existsSync(info.file)) {
    const text = fs.readFileSync(info.file, "utf8");
    const pair = `${ADAPTER_IGNORE_COMMENT}\n${info.pattern}\n`;
    if (text.includes(pair)) fs.writeFileSync(info.file, text.replace(pair, ""), "utf8");
  }
  const ignore = path.join(project, path.dirname(relative), ".gitignore");
  if (fs.existsSync(ignore) && fs.readFileSync(ignore, "utf8") === adapterIgnoreContent(relative)) fs.unlinkSync(ignore);
}

function hasOneCompleteRolesBlock(value) {
  return value.split(ROLE_START).length === 2 && value.split(ROLE_END).length === 2
    && value.indexOf(ROLE_START) < value.indexOf(ROLE_END);
}

function writeLocalAdapter(project, relative, content) {
  const file = path.join(project, relative);
  if (hasUnsafeAdapterPath(project, relative)) return "blocked: symbolic link in adapter path";
  if (isTracked(project, relative)) return "blocked: tracked team file";
  if (fs.existsSync(file)) {
    if (!fs.lstatSync(file).isFile()) return "blocked: adapter is not a regular file";
    const existing = fs.readFileSync(file, "utf8");
    if (!existing.includes(LOCAL_ADAPTER_MARKER)) return "blocked: existing non-Web-Kit file";
    if (!hasOneCompleteRolesBlock(existing)) return "blocked: malformed Web Kit adapter";
    content = replaceMarkedSection(existing, ROLE_START, ROLE_END,
      content.slice(content.indexOf(ROLE_START), content.indexOf(ROLE_END) + ROLE_END.length));
  }
  if (!protectAdapter(project, relative)) return "blocked: cannot ensure private Git exclusion";
  fs.writeFileSync(file, content, "utf8");
  return "active";
}

function geminiContextNames(value) {
  if (value === undefined) return ["GEMINI.md"];
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return [...value];
  return null;
}

function installGeminiAdapter(project) {
  if (hasUnsafeAdapterPath(project, GEMINI_SETTINGS)) return "blocked: symbolic link in Gemini settings path";
  if (isTracked(project, GEMINI_SETTINGS)) return "blocked: existing tracked Gemini settings";
  const file = path.join(project, GEMINI_SETTINGS);
  let settings = {};
  const existed = fs.existsSync(file);
  if (existed) {
    if (!isAdapterProtected(project, GEMINI_SETTINGS)) {
      return "blocked: existing unprotected Gemini settings (add a local ignore first)";
    }
    if (!fs.statSync(file).isFile()) return "blocked: Gemini settings are not a regular file";
    try { settings = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { return "blocked: Gemini settings are not valid JSON"; }
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return "blocked: invalid Gemini settings shape";
    if (settings.context !== undefined && (!settings.context || typeof settings.context !== "object" || Array.isArray(settings.context))) {
      return "blocked: invalid Gemini context settings";
    }
  }
  const prior = settings.context?.fileName;
  const names = geminiContextNames(prior);
  if (!names) return "blocked: unsupported Gemini context.fileName value";
  if (!protectAdapter(project, GEMINI_SETTINGS)) return "blocked: cannot ensure private Git exclusion";
  const stateFile = path.join(project, GEMINI_ADAPTER_STATE);
  if (!fs.existsSync(stateFile)) {
    writeJson(stateFile, { created: !existed, had_file_name: prior !== undefined, original_file_name: prior ?? null });
  }
  settings.context = { ...(settings.context || {}), fileName: [...new Set([...names, GEMINI_CONTEXT])] };
  writeJson(file, settings);
  return "active";
}

function removeLocalAdapter(project, relative, generated) {
  const file = path.join(project, relative);
  if (!fs.existsSync(file)) return "absent";
  if (hasUnsafeAdapterPath(project, relative)) return "preserved: symbolic link in adapter path";
  if (isTracked(project, relative)) return "preserved: tracked file";
  const contents = fs.readFileSync(file, "utf8");
  if (!contents.includes(LOCAL_ADAPTER_MARKER)) return "preserved: not Web-Kit-owned";
  if (!hasOneCompleteRolesBlock(contents)) return "preserved: malformed Web Kit adapter";
  if (contents === generated) { fs.unlinkSync(file); unprotectAdapter(project, relative); return "removed"; }
  // The user extended this adapter. Remove only Web Kit's roles and marker;
  // keep their notes and native frontmatter rather than deleting their edits.
  const withoutRoles = replaceMarkedSection(contents, ROLE_START, ROLE_END, "")
    .replace(`# ${LOCAL_ADAPTER_MARKER}`, "").replace(LOCAL_ADAPTER_MARKER, "");
  fs.writeFileSync(file, withoutRoles, "utf8");
  return "removed Web Kit roles; preserved user edits";
}

function removeGeminiAdapter(project) {
  const stateFile = path.join(project, GEMINI_ADAPTER_STATE);
  if (!fs.existsSync(stateFile)) return "absent";
  const relative = GEMINI_SETTINGS;
  if (hasUnsafeAdapterPath(project, relative)) return "preserved: symbolic link in Gemini settings path";
  if (isTracked(project, relative)) return "preserved: tracked Gemini settings";
  const file = path.join(project, relative);
  if (!fs.existsSync(file)) { fs.unlinkSync(stateFile); unprotectAdapter(project, relative); return "absent"; }
  let settings;
  try { settings = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return "preserved: Gemini settings were edited to invalid JSON"; }
  const names = geminiContextNames(settings.context?.fileName);
  if (!names || !names.includes(GEMINI_CONTEXT)) return "preserved: Gemini context was changed";
  const state = readJson(stateFile);
  const remaining = names.filter((name) => name !== GEMINI_CONTEXT);
  const original = geminiContextNames(state.had_file_name ? state.original_file_name : undefined);
  if (JSON.stringify(remaining) === JSON.stringify(original)) {
    if (state.had_file_name) settings.context.fileName = state.original_file_name;
    else delete settings.context.fileName;
  } else settings.context.fileName = remaining;
  if (!Object.keys(settings.context).length) delete settings.context;
  if (state.created && !Object.keys(settings).length) fs.unlinkSync(file);
  else writeJson(file, settings);
  fs.unlinkSync(stateFile);
  if (!fs.existsSync(file)) unprotectAdapter(project, relative);
  return "removed";
}

function generatedAdapter(project, key) {
  const local = path.join(project, LOCAL_TARGETS[key][0]);
  if (!fs.existsSync(local)) return null;
  const content = fs.readFileSync(local, "utf8");
  return key === "cursor" ? content.replace(/^---\n/, `---\n# ${LOCAL_ADAPTER_MARKER}\n`)
    : `---\napplyTo: "**/*"\n---\n\n${LOCAL_ADAPTER_MARKER}\n${content}`;
}

function synchronizeLocalAdapters(project, scope) {
  if (scope === "shared") return {
    "github-copilot": removeLocalAdapter(project, LOCAL_ADAPTER_FILES["github-copilot"], generatedAdapter(project, "github-copilot")),
    cursor: removeLocalAdapter(project, LOCAL_ADAPTER_FILES.cursor, generatedAdapter(project, "cursor")),
    gemini: removeGeminiAdapter(project),
  };
  return {
    "github-copilot": writeLocalAdapter(project, LOCAL_ADAPTER_FILES["github-copilot"], generatedAdapter(project, "github-copilot")),
    cursor: writeLocalAdapter(project, LOCAL_ADAPTER_FILES.cursor, generatedAdapter(project, "cursor")),
    gemini: installGeminiAdapter(project),
  };
}

export function localAdapterStatus(project) {
  if (!hasLocalInstructionScope(project)) return {};
  const result = {};
  for (const [key, relative] of Object.entries(LOCAL_ADAPTER_FILES)) {
    const file = path.join(project, relative);
    const ready = !hasUnsafeAdapterPath(project, relative) && fs.existsSync(file)
      && fs.lstatSync(file).isFile() && fs.readFileSync(file, "utf8").includes(LOCAL_ADAPTER_MARKER)
      && hasOneCompleteRolesBlock(fs.readFileSync(file, "utf8"));
    result[key] = ready && !isTracked(project, relative) && isAdapterProtected(project, relative) ? "active" : "missing or unprotected";
  }
  const geminiFile = path.join(project, GEMINI_SETTINGS);
  const geminiState = path.join(project, GEMINI_ADAPTER_STATE);
  const geminiCfg = readJson(geminiFile);
  const geminiNames = geminiContextNames(geminiCfg.context?.fileName);
  result.gemini = !hasUnsafeAdapterPath(project, GEMINI_SETTINGS) && fs.existsSync(geminiState)
    && !isTracked(project, GEMINI_SETTINGS)
    && geminiNames?.includes(GEMINI_CONTEXT) && isAdapterProtected(project, GEMINI_SETTINGS) ? "active" : "missing or unprotected";
  return result;
}

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

function removeMarkedRoles(file) {
  if (!fs.existsSync(file)) return "absent";
  const current = fs.readFileSync(file, "utf8");
  let updated = current;
  for (const [startMarker, endMarker] of [
    [ROLE_START, ROLE_END],
    [LEGACY_BRIDGE_START, LEGACY_BRIDGE_END],
  ]) {
    const starts = current.split(startMarker).length - 1;
    const ends = current.split(endMarker).length - 1;
    if (starts !== ends || starts > 1 || (starts === 1 && current.indexOf(startMarker) > current.indexOf(endMarker))) {
      throw new Error(`Cannot safely migrate malformed or repeated Web Kit instruction markers: ${file}`);
    }
    if (starts === 1) {
      const start = updated.indexOf(startMarker);
      const end = updated.indexOf(endMarker, start) + endMarker.length;
      // The installer appends a single separator newline before its final
      // roles block and one newline after it. Undo both for an EOF block.
      if (updated[start - 1] === "\n" && updated.slice(end) === "\n") {
        updated = updated.slice(0, start - 1) + updated.slice(end + 1);
      } else updated = updated.slice(0, start) + updated.slice(end);
    }
  }
  if (updated !== current) fs.writeFileSync(file, updated, "utf8");
  return updated === current ? "unchanged" : "removed-web-kit-roles";
}

const localPrivatePaths = [...Object.values(LOCAL_TARGETS).map(([relative]) => relative), LOCAL_SCOPE_FILE];

export function hasLocalInstructionScope(project) {
  const overlay = readJson(path.join(project, LOCAL_SCOPE_FILE));
  return overlay.schema_version === 1 && overlay.instruction_scope === "local";
}

export function localInstructionCompatibility(project) {
  if (!hasLocalInstructionScope(project)) return null;
  return readJson(path.join(project, LOCAL_SCOPE_FILE)).ai_compatibility || null;
}

export function localInstructionPrivacy(project) {
  const ignore = path.join(project, ".agent-core", "instructions", ".gitignore");
  const root = gitRoot(project);
  if (!root) {
    // Without a Git repository, the only auditable future-ignore policy is
    // the exact self-ignoring policy Web Kit creates for this private folder.
    return fs.existsSync(ignore) && fs.readFileSync(ignore, "utf8") === "*\n";
  }
  return localPrivatePaths.every((relative) => !isTracked(project, relative)
    && gitResult(project, ["check-ignore", "-q", "--", relative]).status === 0);
}

export function protectLocalInstructions(project) {
  const localRoot = path.join(project, ".agent-core", "instructions");
  if ([".agent-core/instructions", ...localPrivatePaths].some((relative) => hasUnsafeAdapterPath(project, relative))) {
    throw new Error("Cannot use symlinked Web Kit private instruction paths.");
  }
  fs.mkdirSync(localRoot, { recursive: true });
  const ignore = path.join(localRoot, ".gitignore");
  // A nested ignore also protects installs that happen before `git init`.
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n", "utf8");
  else {
    const text = fs.readFileSync(ignore, "utf8");
    if (!text.split(/\r?\n/).includes("*") && !isTracked(project, ".agent-core/instructions/.gitignore")) {
      fs.appendFileSync(ignore, `${text.endsWith("\n") ? "" : "\n"}*\n`, "utf8");
    }
  }
  if (!localInstructionPrivacy(project)) {
    throw new Error("Cannot ensure private Web Kit instructions are untracked and effectively Git-ignored. Check .agent-core/instructions/.gitignore and tracked files before installing local mode.");
  }
}

export function assertSharedTransitionSafe(project) {
  // Reject an unsafe checkout-local scope before any team-facing instruction
  // updates or native adapter cleanup. In particular, a forcibly tracked
  // overlay must not leave the project half in shared and half in local mode.
  const overlayFile = path.join(project, LOCAL_SCOPE_FILE);
  if (fs.existsSync(overlayFile) && (isTracked(project, LOCAL_SCOPE_FILE) || hasUnsafeAdapterPath(project, LOCAL_SCOPE_FILE))) {
    throw new Error("Cannot remove tracked or symlinked local Web Kit scope. Untrack or inspect it before switching to shared mode.");
  }
}

export function assertLocalMigrationSafe(project) {
  for (const [relative] of Object.values(SHARED_TARGETS)) {
    const file = path.join(project, relative);
    if (!fs.existsSync(file)) continue;
    const current = fs.readFileSync(file, "utf8");
    for (const [start, end] of [[ROLE_START, ROLE_END], [LEGACY_BRIDGE_START, LEGACY_BRIDGE_END]]) {
      const starts = current.split(start).length - 1;
      const ends = current.split(end).length - 1;
      if (starts !== ends || starts > 1 || (starts === 1 && current.indexOf(start) > current.indexOf(end))) {
        throw new Error(`Cannot safely migrate malformed or repeated Web Kit instruction markers: ${file}`);
      }
    }
    // Both marker formats may coexist during migrations, but their ranges
    // must not overlap or nest; otherwise removal would corrupt team content.
    const ranges = [[ROLE_START, ROLE_END], [LEGACY_BRIDGE_START, LEGACY_BRIDGE_END]]
      .filter(([start]) => current.includes(start))
      .map(([start, end]) => [current.indexOf(start), current.indexOf(end) + end.length])
      .sort((a, b) => a[0] - b[0]);
    if (ranges.length > 1 && ranges[0][1] > ranges[1][0]) {
      throw new Error(`Cannot safely migrate overlapping Web Kit instruction markers: ${file}`);
    }
  }
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

1. Follow \`.agent-core/rules/workflow.md\` as the single engineering lifecycle, \`.agent-core/rules/efficiency-policy.md\` for proportional execution, \`.agent-core/rules/pre-pr-review.md\` for scope protection and PR readiness, and \`.agent-core/rules/requirements-quality.md\` for acceptance evidence, real tests, and quality reports.
2. Follow \`.agent-core/rules/repository-navigation.md\` for question-aware repository navigation.
3. Follow \`.agent-core/rules/context-rollover.md\` for provider-session lifetime and fresh-context handoffs. Automatic rollover is an outer-session concern, not a second engineering workflow.
4. Read \`.agent-core/index/project-profile.json\` first for lightweight project routing metadata.
5. Use \`.agent-core/routing/context-policy.json\` to keep context bounded and activate only the roles/skills needed for the current step.
6. If \`.agent-core/state/graphify-bootstrap-role.md\` exists, treat it as a **temporary current-AI role** and execute it before normal Graphify-assisted repository work. After the graph is built, follow that role's completion command; successful completion deletes the temporary role.
7. Act only in the role routed for the current phase: Captain, discovery/indexing/router, Spec Writer/Spec Validator for formal work, architect/planner, implementation worker, specialist reviewer, Context Rollover Manager, Handoff Validator, or Final Integration Validator.
8. Never self-approve a specification, plan, code review, implementation handoff, or final integration result when the workflow requires an independent validator. For formal work, register REQ criteria and independent spec approval before plan validation.
9. For exact text/symbol/path lookup, use targeted current-source search (\`rg\` or equivalent) directly.
10. For relationship/dependency/ownership/impact discovery, run \`node .agent-core/rules/graphify-refresh.mjs --project . --task-id <task-id>\` before the first Graphify query. Use Graphify only when the resulting state is fresh, then verify exact source before planning or editing.
11. After a coherent code-changing step, run the same Node Graph Refresh Gate only before downstream Graphify-based relationship validation/analysis needs fresh data; never refresh on every file write.
12. Never run \`graphify update .\` directly as a replacement for the managed Graph Refresh Gate.
13. Current source, current diff, tests/build, and runtime evidence override Graphify/index/context-handoff summaries.
14. When \`WEB_KIT_CONTEXT_SUPERVISOR_ACTIVE=1\`, use the provider normally and finish the current assistant turn safely. Do not manually run \`/clear\`, \`/new\`, \`/compact\`, or ask the user to restart for context pressure; the outer transparent supervisor owns threshold detection, handoff persistence, and fresh native provider-session creation.
15. A threshold rollover continues the same task: read its exact handoff first, verify repository evidence, preserve completed work and resume its next action. Standalone changes reviews are separate fresh Codex CLI processes with no implementation handoff or review bookkeeping.
16. When \`WEB_KIT_SESSION_CONTROLLER=1\`, the explicit headless Session Controller fallback owns rollover; follow the progress protocol it injects for that cycle and do not reset context manually.
17. Web Kit runtime commands use Node.js. Do not require a system Python installation for Web Kit itself.
18. Treat the exact user phrase \`run security-review\` (and the equivalent \`run security review\`) as a provider-neutral Web Kit execution command, not as a request to explain security reviewing. Read \`.agent-core/rules/security-review.md\`, then execute \`node .agent-core/bin/security-review.mjs --project .\` from the project root and return the generated PR-style findings to the user.
19. Map simple suffixes consistently: \`run security-review deep\` adds \`--deep\`; \`run security-review base <branch>\` adds \`--base <branch>\`; \`run security-review provider <codex|claude|gemini>\` adds \`--provider <name>\`. The same engine owns first review and re-review automatically.
20. The Security PR Reviewer is independent and read-only. Do not fix findings during the review. After findings are returned, wait for a separate implementation/fix request; a later \`run security-review\` performs the independent re-review.
21. If this AI client cannot execute local commands/tools, do not pretend the security review ran. Tell the user to run \`npx @ihgen/web-kit security-review\` in the project terminal.
22. New jobs on detected Git feature branches default to PR-bound. Use --pr-bound explicitly for PR-intended work elsewhere; --local-only or --review-only is an opt-out only when the user's task has that explicit scope. Detached HEAD requires explicit intent. Before implementation, register a short acceptance checklist with work-progress.mjs requirement-add and relevant required checks with check-require, including for SMALL tasks without a formal plan. For code-changing tasks on a Git feature branch, lock exact task paths and pre-existing edits using \`node .agent-core/rules/scope-guard.mjs start ...\` before writing; run \`scope-guard.mjs check --task-id <task-id>\` after coherent chunks and before handoff/commit/push. Do not touch unrelated files. Extend only for an evidence-backed necessary dependency **before** editing; material scope changes still require approval.
23. For every PR-bound implementation task, regardless of size, run the existing independent Code Reviewer through \`node .agent-core/bin/code-review.mjs --task-id <task-id>\` after the required checks. It launches a fresh read-only provider process and imports the actual structured report through quality-review --report; a changed role name or free-text PASS cannot replace that invocation. The reviewer actively seeks credible failure cases in the full eventual diff and affected callers, using the original requirements and check evidence, with no finding quota. The existing completion gate requires verified acceptance criteria, all declared checks, current scope and current review evidence. During authorized implementation/fix work, fix verified blockers through the implementation owner, rerun affected checks and re-review changed/dependent behavior with explicit disposition of prior findings. Reuse unchanged current evidence instead of adding another review stage, unless the user requests a fresh review. Missing essential evidence is \`VERIFICATION BLOCKED\`; create or mark a PR ready only on \`READY TO OPEN PR\` plus publication authorization. Dot remains the CI/CD executor when configured; never dispatch GitHub Actions merely for this gate.
24. Treat standalone \`review these changes\`, \`review my changes\` and equivalent requests as strict, scoped, review-only commands. Follow \`.agent-core/rules/changes-review.md\` and invoke \`node .agent-core/bin/changes-review.mjs --request '<original request>'\` (optionally --selection for a narrower requested current diff). The independent fresh ephemeral read-only Codex reviewer must challenge ONLY current staged, unstaged and relevant untracked changes for real security, correctness, architecture, testing, performance and maintainability problems, provide evidence-backed P0–P3 findings and 0–5 scores; inspect affected callers only for impact and never report unrelated pre-existing defects. Return the report directly without review task/handoff/request/receipt files, supervisor transition, same-session analysis, or fabricated checks. When and only when the user explicitly says \`auto fix true\` or \`--auto-fix=true\`, append \`--auto-fix=true\`: after the review, isolate the current diff in a temporary Git worktree, start a fresh independent fixing session, execute tests/checks, re-review in a separate fresh session (up to three passes), and automatically open a PR only after verified readiness. Leave the original stage/worktree untouched; if checks fail or findings remain, do not open a PR. Dot owns CI/CD; never manually dispatch GitHub Actions. Without auto-fix, never fix or open a PR. Preserve existing tasks/scope/queues and user instructions.
25. The explicit chat tags \`@autofix\` and \`#autofix\` are equivalent to \`--auto-fix=true\` when attached to a standalone changes-review request, e.g. \`review these changes @autofix\`. For this route omit \`--selection\` because safe auto-fix must cover all current changes. In an existing Codex CLI conversation, invoke the independent review command normally and return the result in this same chat: the review/fix subprocesses each get fresh context, but the caller's conversation is not cleared, reset or resumed inside them. No tag means review-only by default. This is not a Git release tag.
26. When the user adds \`--no-pr\` to an explicit autofix request (for example \`review these changes @autofix --no-pr\`), pass both \`--auto-fix=true --no-pr\` to the helper. After fresh post-fix test verification and independent re-review, this applies only approved fixes to the existing worktree while preserving its staged index. Never create a commit, push, or open a PR in this mode; do not require a GitHub CLI or origin remote. Without \`--no-pr\`, autofix retains its gated PR behavior. Every independent Codex session has a bounded timeout and publication refuses uninspectable binary files.

If project-owned instructions outside this block conflict with Web-Kit workflow mechanics, preserve them but report the conflict with \`doctor\`; do not silently delete user content.
${ROLE_END}`;
}

function cursorInitial(profile) {
  return `---\ndescription: Project instructions and iHGEN Web Kit roles\nalwaysApply: true\n---\n\n${projectSummary(profile, "Cursor")}`;
}

export function applyAiCompatibility(project, profile = null, options = {}) {
  project = path.resolve(project);
  profile = profile || readJson(path.join(project, ".agent-core", "index", "project-profile.json"));
  const scope = options.instructionScope || "shared";
  if (!["local", "shared"].includes(scope)) throw new Error(`Invalid AI instruction scope: ${scope}`);
  const targets = scope === "local" ? LOCAL_TARGETS : SHARED_TARGETS;

  if (scope === "local") {
    // Refuse a partial or ambiguous migration before touching shared files.
    assertLocalMigrationSafe(project);
    protectLocalInstructions(project);
  } else assertSharedTransitionSafe(project);

  const actions = {};
  for (const [key, [relative, label]] of Object.entries(targets)) {
    const file = path.join(project, relative);
    actions[key] = upsertRoles(file, rolesMarkdown(label), key === "cursor" ? cursorInitial(profile) : projectSummary(profile, label));
  }
  if (scope === "local") {
    for (const [key, [relative]] of Object.entries(SHARED_TARGETS)) {
      actions[`removed-shared-${key}`] = removeMarkedRoles(path.join(project, relative));
    }
  }
  const adapters = synchronizeLocalAdapters(project, scope);
  for (const [key, action] of Object.entries(adapters)) actions[`local-adapter-${key}`] = action;

  const compatibility = {
    instruction_scope: scope,
    canonical_instructions: targets.agents[0],
    canonical_workflow: ".agent-core/rules/workflow.md",
    canonical_navigation_rule: ".agent-core/rules/repository-navigation.md",
    efficiency_policy_rule: ".agent-core/rules/efficiency-policy.md",
    pre_pr_review_rule: ".agent-core/rules/pre-pr-review.md",
    changes_review: {
      rule: ".agent-core/rules/changes-review.md",
      trigger: "review these changes",
      mode: "source-analysis",
      execution: "fresh-independent-codex-cli",
      fresh_session_required: true,
      same_session_fallback: false,
      review_command: ".agent-core/bin/changes-review.mjs",
      review_files_created: false,
      auto_fix_flag: "--auto-fix=true",
      auto_fix_tags: ["@autofix", "#autofix"],
      auto_fix_local_flag: "--no-pr",
      auto_fix_verification: "fresh-post-fix-session",
      auto_fix_isolated_worktree: true,
      auto_pr_requires_readiness: true,
      existing_task_required: false,
      readiness_evidence: false,
    },
    pr_readiness_review_engine: ".agent-core/bin/code-review.mjs",
    scope_guard: ".agent-core/rules/scope-guard.mjs",
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
    managed_roles: Object.fromEntries(Object.entries(targets).map(([key, [relative]]) => [key, relative])),
    local_adapters: scope === "local" ? adapters : {},
    file_policy: scope === "local"
      ? "Web Kit instructions live under .agent-core/instructions and are locally Git-ignored. Copilot and Cursor receive ignored native rule adapters; Gemini receives a private project context setting where safely possible. Only Web Kit-marked blocks are removed from shared project files when switching to local mode. Web Kit-controlled Codex/Claude sessions load the local instructions explicitly."
      : "Existing project instruction files are preserved; Web Kit changes only its marked roles block. Missing files are created once with a project summary plus the roles block.",
    runtime: "node+npm",
    actions,
  };

  const overlayFile = path.join(project, LOCAL_SCOPE_FILE);
  if (scope === "local") {
    writeJson(overlayFile, { schema_version: 1, instruction_scope: "local", ai_compatibility: compatibility });
  } else if (fs.existsSync(overlayFile)) {
    assertSharedTransitionSafe(project);
    fs.unlinkSync(overlayFile);
  }

  const cfgPath = path.join(project, ".agent-kit.json");
  const cfg = readJson(cfgPath);
  if (Object.keys(cfg).length) {
    if (scope === "shared") cfg.ai_compatibility = compatibility;
    else delete cfg.ai_compatibility;
    writeJson(cfgPath, cfg);
  }

  const profilePath = path.join(project, ".agent-core", "index", "project-profile.json");
  const currentProfile = readJson(profilePath);
  if (Object.keys(currentProfile).length) {
    if (scope === "shared") currentProfile.ai_compatibility = compatibility;
    else delete currentProfile.ai_compatibility;
    writeJson(profilePath, currentProfile);
  }

  return compatibility;
}
