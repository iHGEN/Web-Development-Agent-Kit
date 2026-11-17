#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(repo, "scripts", "agent-kit.mjs");
const mockProvider = path.join(repo, "tests", "fixtures", "mock-session-provider.mjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-local-instructions-"));
const sharedPaths = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md", ".cursor/rules/ihgen-web-kit.mdc"];
const localPaths = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "copilot-instructions.md", "ihgen-web-kit.mdc"];
const adapterPaths = [".github/instructions/ihgen-web-kit-local.instructions.md", ".cursor/rules/ihgen-web-kit-local.mdc", ".gemini/settings.json"];
const startMarker = "<!-- WEB-AGENT-KIT:AI-ROLES:START -->";

function run(command, args, project, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: project, encoding: "utf8", windowsHide: true, env: { ...process.env, ...extraEnv },
  });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  return result;
}
function write(project, relative, value) {
  const file = path.join(project, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
}
const read = (project, relative) => fs.readFileSync(path.join(project, relative), "utf8");
const kit = (project, command, ...args) => run(process.execPath, [installer, command, project, ...args], project);
function expectLocal(project) {
  const config = JSON.parse(read(project, ".agent-kit.json"));
  assert.equal(config.ai_compatibility.instruction_scope, "local");
  assert.equal(config.ai_compatibility.canonical_instructions, ".agent-core/instructions/AGENTS.md");
  for (const name of localPaths) {
    const relative = `.agent-core/instructions/${name}`;
    assert.match(read(project, relative), /iHGEN Web Development Agent Kit/);
    const ignored = spawnSync("git", ["check-ignore", "-q", relative], { cwd: project });
    assert.equal(ignored.status, 0, `${relative} must not be included by normal git add`);
  }
  for (const [name, status] of Object.entries(config.ai_compatibility.local_adapters)) {
    assert.equal(status, "active", `${name} adapter is not active: ${status}`);
  }
  for (const relative of adapterPaths) {
    assert(fs.existsSync(path.join(project, relative)), `${relative} missing`);
    const ignored = spawnSync("git", ["check-ignore", "-q", relative], { cwd: project });
    assert.equal(ignored.status, 0, `${relative} must be private to this checkout`);
    const nestedIgnore = `${path.posix.dirname(relative)}/.gitignore`;
    assert.equal(spawnSync("git", ["check-ignore", "-q", nestedIgnore], { cwd: project }).status, 0,
      `${nestedIgnore} must also be private to this checkout`);
  }
  assert.match(read(project, adapterPaths[0]), /^---\napplyTo: "\*\*\/\*"\n---/);
  assert.match(read(project, adapterPaths[0]), /iHGEN Web Development Agent Kit/);
  assert.match(read(project, adapterPaths[1]), /^---\n.*alwaysApply: true/ms);
  assert.match(read(project, adapterPaths[1]), /iHGEN Web Development Agent Kit/);
  const geminiSettings = JSON.parse(read(project, adapterPaths[2]));
  assert(geminiSettings.context.fileName.includes(".agent-core/instructions/GEMINI.md"));
  assert.match(kit(project, "doctor").stdout, /Status: HEALTHY/);
}

try {
  const malformed = path.join(temp, "malformed");
  fs.mkdirSync(malformed);
  const brokenContent = `# Team-owned content\n${startMarker}\nmissing end marker\n`;
  write(malformed, "AGENTS.md", brokenContent);
  const rejected = spawnSync(process.execPath, [installer, "install", malformed, "--local-instructions"], { cwd: malformed, encoding: "utf8" });
  assert.notEqual(rejected.status, 0, "invalid shared markers should block migration");
  assert.equal(read(malformed, "AGENTS.md"), brokenContent, "failed migration modified team-owned instructions");
  assert(!fs.existsSync(path.join(malformed, ".agent-kit.json")), "failed migration partially installed Web Kit");

  const fresh = path.join(temp, "fresh");
  fs.mkdirSync(fresh);
  run("git", ["init", "-q"], fresh);
  write(fresh, "package.json", '{"name":"fresh-project"}\n');
  kit(fresh, "install", "--local-instructions");
  for (const name of sharedPaths) assert.equal(fs.existsSync(path.join(fresh, name)), false, `${name} created in local mode`);
  expectLocal(fresh);
  kit(fresh, "update");
  expectLocal(fresh);
  for (const name of sharedPaths) assert.equal(fs.existsSync(path.join(fresh, name)), false, `${name} created during local update`);
  // Doctor fails closed if local rules could accidentally be committed.
  fs.unlinkSync(path.join(fresh, ".agent-core/instructions/.gitignore"));
  const unprotected = spawnSync(process.execPath, [installer, "doctor", fresh], { cwd: fresh, encoding: "utf8" });
  assert.notEqual(unprotected.status, 0, "doctor accepted unprotected local instruction files");
  kit(fresh, "update");
  expectLocal(fresh);

  // Local adapters must also be ignored when the install predates git init.
  const beforeGit = path.join(temp, "before-git-init");
  fs.mkdirSync(beforeGit);
  write(beforeGit, "package.json", '{"name":"before-git-init"}\n');
  kit(beforeGit, "install", "--local-instructions");
  run("git", ["init", "-q"], beforeGit);
  expectLocal(beforeGit);

  const migrated = path.join(temp, "migrated");
  fs.mkdirSync(migrated);
  run("git", ["init", "-q"], migrated);
  write(migrated, "package.json", '{"name":"migrated-project"}\n');
  const preserved = new Map();
  for (const name of sharedPaths) {
    const prefix = `# Existing ${name}\r\nUser-owned instructions stay intact.\r\n`;
    const suffix = `\r\nTeam footer for ${name}.\r\n`;
    write(migrated, name, `${prefix}${suffix}`);
    preserved.set(name, { prefix, suffix });
  }
  kit(migrated, "install");
  for (const name of sharedPaths) assert(read(migrated, name).includes(startMarker), `${name}: shared install didn't add roles`);

  kit(migrated, "update", "--local-instructions");
  expectLocal(migrated);
  const afterMigration = new Map();
  for (const name of sharedPaths) {
    const value = read(migrated, name);
    assert(!value.includes(startMarker), `${name}: old Web Kit roles weren't removed`);
    assert(value.startsWith(preserved.get(name).prefix), `${name}: project-owned prefix altered`);
    assert(value.endsWith(preserved.get(name).suffix), `${name}: project-owned suffix altered`);
    afterMigration.set(name, value);
  }
  kit(migrated, "update");
  for (const name of sharedPaths) assert.equal(read(migrated, name), afterMigration.get(name), `${name}: later update edited team instructions`);
  expectLocal(migrated);

  // Existing, tracked Gemini settings and local adapter-name collisions must
  // remain untouched, never hidden or overwritten on the user's behalf.
  const collisions = path.join(temp, "collisions");
  fs.mkdirSync(collisions);
  run("git", ["init", "-q"], collisions);
  write(collisions, "package.json", '{"name":"collision-project"}\n');
  write(collisions, adapterPaths[2], '{"context":{"fileName":"TEAM.md"},"ui":{"theme":"custom"}}\n');
  write(collisions, adapterPaths[0], "# Teammate's Copilot rules\n");
  run("git", ["add", adapterPaths[2], adapterPaths[0]], collisions);
  kit(collisions, "install", "--local-instructions");
  assert.equal(read(collisions, adapterPaths[2]), '{"context":{"fileName":"TEAM.md"},"ui":{"theme":"custom"}}\n');
  assert.equal(read(collisions, adapterPaths[0]), "# Teammate's Copilot rules\n");
  const blockedAdapters = JSON.parse(read(collisions, ".agent-kit.json")).ai_compatibility.local_adapters;
  assert.match(blockedAdapters.gemini, /blocked: existing tracked/);
  assert.match(blockedAdapters["github-copilot"], /blocked: tracked team/);
  const blockedDoctor = spawnSync(process.execPath, [installer, "doctor", collisions], { cwd: collisions, encoding: "utf8" });
  assert.notEqual(blockedDoctor.status, 0, "doctor must disclose adapters that could not safely activate");
  assert.match(blockedDoctor.stdout, /Inactive local AI adapters: github-copilot, gemini/);

  // Existing private Gemini settings keep unrelated keys, preserve an existing
  // scalar fileName, and can be restored without leaving Web Kit context behind.
  const personal = path.join(temp, "private-settings");
  fs.mkdirSync(personal);
  run("git", ["init", "-q"], personal);
  write(personal, "package.json", '{"name":"personal-settings"}\n');
  write(personal, ".gemini/.gitignore", "/.gitignore\n/settings.json\n");
  const originalGeminiSettings = { context: { fileName: "CUSTOM.md" }, ui: { theme: "my-theme" } };
  write(personal, adapterPaths[2], `${JSON.stringify(originalGeminiSettings)}\n`);
  kit(personal, "install", "--local-instructions");
  expectLocal(personal);
  assert.deepEqual(JSON.parse(read(personal, adapterPaths[2])).context.fileName,
    ["CUSTOM.md", ".agent-core/instructions/GEMINI.md"]);
  write(personal, adapterPaths[0], `${read(personal, adapterPaths[0])}\n# My personal Copilot note\n`);
  kit(personal, "update");
  assert(read(personal, adapterPaths[0]).includes("My personal Copilot note"), "update discarded personal adapter edits");
  kit(personal, "update", "--shared-instructions");
  assert.deepEqual(JSON.parse(read(personal, adapterPaths[2])), originalGeminiSettings);
  assert(!fs.existsSync(path.join(personal, adapterPaths[1])), "generated Cursor adapter survived shared opt-in");
  assert(read(personal, adapterPaths[0]).includes("My personal Copilot note"), "shared opt-in discarded personal adapter edits");
  assert(!read(personal, adapterPaths[0]).includes(startMarker), "shared opt-in retained Copilot Web Kit roles");

  // The real provider binaries are never called; inspect the exact prompt
  // handed to the existing mock Codex/Claude adapters (including rollover).
  for (const provider of ["codex", "claude"]) {
    const envName = provider === "codex" ? "WEB_KIT_CODEX_BIN" : "WEB_KIT_CLAUDE_BIN";
    run(process.execPath, [
      path.join(migrated, ".agent-core/bin/session-controller.mjs"),
      "--project", migrated, "--provider", provider,
      "--threshold", "50", "--max-cycles", "6",
      "--task-id", `local-${provider}`, "--prompt", "Implement the private feature",
    ], migrated, { [envName]: mockProvider, WEB_KIT_TEST_PROVIDER: provider });
    const calls = read(migrated, `.agent-core/state/mock-${provider}-calls.jsonl`).trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(calls.length, 3, `${provider}: expected initial, resume and rollover calls`);
    for (const call of calls) {
      const prompt = provider === "claude" ? call.args[call.args.indexOf("-p") + 1] : call.args.at(-1);
      assert(prompt.includes(`.agent-core/instructions/${provider === "claude" ? "CLAUDE.md" : "AGENTS.md"}`), `${provider}: local instruction source not named`);
      assert(prompt.includes("Web Development Agent Kit"), `${provider}: local instructions not injected`);
      assert(prompt.includes("Project-owned instructions") || prompt.includes("project's own AGENTS.md"), `${provider}: team instructions not preserved`);
    }
  }

  // Normal interactive providers started through the installed transparent
  // supervisor also opt in, without relying on a shared root instruction file.
  const isolatedHome = path.join(temp, "home");
  const supervisorHome = path.join(isolatedHome, ".web-kit");
  const launchLog = path.join(temp, "native-launch.json");
  const providerStub = path.join(temp, "native-provider.mjs");
  fs.mkdirSync(isolatedHome, { recursive: true });
  fs.writeFileSync(providerStub, [
    'import fs from "node:fs";',
    'fs.writeFileSync(process.env.WEB_KIT_TEST_LAUNCH_LOG, JSON.stringify(process.argv.slice(2)));',
  ].join("\n"), "utf8");
  const common = {
    WEB_KIT_HOME: supervisorHome, WEB_KIT_USER_HOME: isolatedHome,
    WEB_KIT_DISABLE_SHELL_PROFILE: "1", CODEX_HOME: path.join(isolatedHome, ".codex"),
    WEB_KIT_REAL_CODEX_BIN: providerStub, WEB_KIT_REAL_CLAUDE_BIN: providerStub,
    WEB_KIT_TEST_LAUNCH_LOG: launchLog,
  };
  run(process.execPath, [path.join(migrated, ".agent-core/bin/supervisor-setup.mjs"), "install", "local-smoke"], migrated, common);
  const supervisor = path.join(supervisorHome, "context-supervisor.mjs");
  for (const provider of ["codex", "claude"]) {
    run(process.execPath, [supervisor, provider], migrated, common);
    const args = JSON.parse(fs.readFileSync(launchLog, "utf8"));
    if (provider === "codex") {
      assert(args.some(arg => arg.startsWith("developer_instructions=") && arg.includes("Web Development Agent Kit")),
        "Codex interactive supervisor didn't inject local guidance");
    } else {
      const index = args.indexOf("--append-system-prompt-file");
      assert(index >= 0 && args[index + 1] === path.join(migrated, ".agent-core/instructions/CLAUDE.md"),
        "Claude interactive supervisor didn't append local guidance");
    }
  }
  // Never silently replace provider-specific custom developer instructions.
  run(process.execPath, [supervisor, "codex", "-c", 'developer_instructions="custom"'], migrated, common);
  const custom = JSON.parse(fs.readFileSync(launchLog, "utf8"));
  assert.equal(custom.filter(arg => arg.startsWith("developer_instructions=")).length, 1,
    "Existing Codex developer instructions must not be overwritten");

  kit(migrated, "update", "--shared-instructions");
  for (const name of sharedPaths) assert(read(migrated, name).includes(startMarker), `${name}: shared mode not restored`);
  for (const relative of adapterPaths) {
    assert(!fs.existsSync(path.join(migrated, relative)), `${relative}: local adapter was not removed on shared opt-in`);
    assert.notEqual(spawnSync("git", ["check-ignore", "-q", relative], { cwd: migrated }).status, 0,
      `${relative}: Git exclusion survived shared opt-in`);
  }
  assert.equal(JSON.parse(read(migrated, ".agent-kit.json")).ai_compatibility.instruction_scope, "shared");
  console.log("Local Web Kit AI instructions: PASS (all five clients, private adapters, migration, Git ignore, conflicts, managed + native Codex/Claude, rollover, shared opt-in).");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
