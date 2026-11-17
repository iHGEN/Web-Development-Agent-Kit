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
  assert.equal(JSON.parse(read(migrated, ".agent-kit.json")).ai_compatibility.instruction_scope, "shared");
  console.log("Local Web Kit AI instructions: PASS (fresh, migration, Git ignore, persistence, managed + native Codex/Claude, rollover, shared opt-in).");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
