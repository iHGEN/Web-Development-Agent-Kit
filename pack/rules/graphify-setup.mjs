#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_REL = path.join(".agent-core", "state", "graphify-install.json");
const BOOTSTRAP_ROLE_REL = path.join(".agent-core", "state", "graphify-bootstrap-role.md");
const GRAPH_REL = path.join("graphify-out", "graph.json");
const PROTECTED_INSTRUCTION_PATHS = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  path.join(".github", "copilot-instructions.md"),
  path.join(".cursor", "rules", "ihgen-web-kit.mdc"),
];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return {}; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeState(project, values) {
  const file = path.join(project, STATE_REL);
  const current = readJson(file);
  Object.assign(current, values);
  writeJson(file, current);
}

function commandWorks(command, args = ["--version"]) {
  const result = spawnSync(command, args, { stdio: "ignore", windowsHide: true });
  return !result.error && result.status === 0;
}

function candidateBins(name) {
  const home = os.homedir();
  const windows = process.platform === "win32";
  const suffix = windows ? ".exe" : "";
  return [
    name,
    path.join(home, ".local", "bin", `${name}${suffix}`),
    path.join(home, ".cargo", "bin", `${name}${suffix}`),
  ];
}

function findBinary(name) {
  for (const candidate of candidateBins(name)) {
    if (candidate === name) {
      if (commandWorks(candidate)) return candidate;
    } else if (fs.existsSync(candidate) && commandWorks(candidate)) {
      return candidate;
    }
  }
  return null;
}

function run(command, args = [], options = {}) {
  console.log(`+ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: options.stdio || "inherit",
    windowsHide: true,
  });
  return result.error ? 1 : (result.status ?? 1);
}

async function installUv() {
  console.log("uv is not installed. Installing uv with Astral's official standalone installer...");
  const env = { ...process.env, UV_NO_MODIFY_PATH: "1" };

  if (process.platform === "win32") {
    const shell = commandWorks("powershell", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"])
      ? "powershell"
      : commandWorks("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"])
        ? "pwsh"
        : null;
    if (!shell) {
      console.error("PowerShell is required to bootstrap uv on Windows.");
      return null;
    }
    const script = "$env:UV_NO_MODIFY_PATH='1'; irm https://astral.sh/uv/install.ps1 | iex";
    if (run(shell, ["-NoProfile", "-ExecutionPolicy", "ByPass", "-Command", script], { env }) !== 0) return null;
  } else if (commandWorks("curl", ["--version"])) {
    const shellCommand = "curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh";
    if (run("sh", ["-c", shellCommand], { env }) !== 0) return null;
  } else if (commandWorks("wget", ["--version"])) {
    const shellCommand = "wget -qO- https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh";
    if (run("sh", ["-c", shellCommand], { env }) !== 0) return null;
  } else {
    try {
      const response = await fetch("https://astral.sh/uv/install.sh", { redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-uv-"));
      const installer = path.join(tempDir, "install.sh");
      fs.writeFileSync(installer, await response.text(), "utf8");
      const rc = run("sh", [installer], { env });
      fs.rmSync(tempDir, { recursive: true, force: true });
      if (rc !== 0) return null;
    } catch (error) {
      console.error(`Unable to download the uv installer: ${error.message}`);
      return null;
    }
  }

  return findBinary("uv");
}

function snapshotInstructionFiles(project) {
  const snapshots = new Map();
  for (const rel of PROTECTED_INSTRUCTION_PATHS) {
    const file = path.join(project, rel);
    if (fs.existsSync(file)) {
      snapshots.set(rel, { existed: true, bytes: fs.readFileSync(file) });
    } else {
      snapshots.set(rel, { existed: false, bytes: null });
    }
  }
  return snapshots;
}

function restoreInstructionFiles(project, snapshots) {
  for (const [rel, snapshot] of snapshots.entries()) {
    const file = path.join(project, rel);
    if (snapshot.existed) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, snapshot.bytes);
    } else if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
    }
  }
}

function configureProject(project, graphify) {
  const snapshots = snapshotInstructionFiles(project);
  try {
    return run(graphify, ["install", "--project"], { cwd: project });
  } finally {
    restoreInstructionFiles(project, snapshots);
  }
}

function bootstrapRoleText() {
  return `# Temporary Role — Build the Initial Graphify Project Graph

This role is temporary and applies to the **current AI coding assistant working in this project**.

## Goal

Create \`graphify-out/graph.json\` so Web Kit can use refresh-gated Graphify navigation.

## Required action

1. Check whether \`graphify-out/graph.json\` already exists.
2. If it does not exist, invoke the Graphify skill registered for this assistant and build the graph for the repository root (\`.\`).
   - In slash-command assistants, use \`/graphify .\`.
   - In Codex, invoke the installed Graphify skill (\`$graphify\`) for the repository root.
3. Wait for Graphify to finish and verify that \`graphify-out/graph.json\` exists.
4. As soon as the graph exists, run:

\`\`\`bash
node .agent-core/rules/graphify-setup.mjs --project . --complete
\`\`\`

5. The completion command deactivates this role and removes this file. Do not continue treating this as an active role after completion.

## Boundaries

- Do not replace the initial Graphify build with broad repository grepping.
- Do not edit application code as part of this temporary role.
- Do not modify project-owned AI instruction text to complete Graphify setup.
- After completion, normal Web Kit rules apply: Graphify is navigation evidence only, freshness is controlled by the Graph Refresh Gate, and exact source/diff/tests/runtime remain authoritative.
`;
}

function activateBootstrapRole(project) {
  const rolePath = path.join(project, BOOTSTRAP_ROLE_REL);
  fs.mkdirSync(path.dirname(rolePath), { recursive: true });
  fs.writeFileSync(rolePath, bootstrapRoleText(), "utf8");
  writeState(project, {
    bootstrap_role_active: true,
    bootstrap_role_path: BOOTSTRAP_ROLE_REL.split(path.sep).join("/"),
    current_ai_action_required: true,
    completion_command: "node .agent-core/rules/graphify-setup.mjs --project . --complete",
  });
}

function removeBootstrapRole(project) {
  fs.rmSync(path.join(project, BOOTSTRAP_ROLE_REL), { force: true });
  writeState(project, { bootstrap_role_active: false, current_ai_action_required: false });
}

function initializeRefreshState(project) {
  const refreshScript = path.join(__dirname, "graphify-refresh.mjs");
  return fs.existsSync(refreshScript)
    ? run(process.execPath, [refreshScript, "--project", project, "--initialize"], { cwd: project })
    : 0;
}

function completeBootstrap(project) {
  const graphReady = fs.existsSync(path.join(project, GRAPH_REL));
  if (!graphReady) {
    console.error("Graphify bootstrap cannot complete yet: graphify-out/graph.json is still missing.");
    console.error("Keep the temporary current-AI role active and build the initial graph first.");
    writeState(project, {
      graph_ready: false,
      initial_graph_required: true,
      bootstrap_role_active: true,
      current_ai_action_required: true,
      status: "awaiting-initial-graph",
    });
    return 2;
  }

  removeBootstrapRole(project);
  writeState(project, {
    graph_ready: true,
    initial_graph_required: false,
    status: "graph-built-awaiting-freshness-gate",
  });
  initializeRefreshState(project);
  console.log("Initial Graphify graph detected.");
  console.log("Temporary current-AI Graphify bootstrap role removed.");
  console.log("Before the first relationship query, Web Kit's Graph Refresh Gate will confirm/refresh graph freshness.");
  return 0;
}

function parseArgs(argv) {
  const result = { project: ".", yes: false, check: false, complete: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--yes") result.yes = true;
    else if (arg === "--check") result.check = true;
    else if (arg === "--complete") result.complete = true;
    else if (arg === "--project") result.project = argv[++i] || ".";
    else if (arg.startsWith("--project=")) result.project = arg.slice(10);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = path.resolve(args.project);
  let graphify = findBinary("graphify");

  if (args.check) {
    console.log(JSON.stringify({
      installed: Boolean(graphify),
      binary: graphify,
      graph_ready: fs.existsSync(path.join(project, GRAPH_REL)),
      bootstrap_role_active: fs.existsSync(path.join(project, BOOTSTRAP_ROLE_REL)),
      bootstrap_role_path: BOOTSTRAP_ROLE_REL.split(path.sep).join("/"),
    }, null, 2));
    return 0;
  }

  if (args.complete) return completeBootstrap(project);
  if (!args.yes) {
    console.error("Refusing non-confirmed Graphify installation. Re-run with --yes.");
    return 2;
  }

  let uv = findBinary("uv");
  let uvInstalledByWebKit = false;
  if (!graphify) {
    if (!uv) {
      uv = await installUv();
      uvInstalledByWebKit = Boolean(uv);
    }
    if (!uv) {
      writeState(project, {
        installed: false,
        configured: false,
        status: "uv-install-failed",
        bootstrap_role_active: false,
        guidance: "Install uv from https://docs.astral.sh/uv/getting-started/installation/ and retry `npx @ihgen/web-kit graphify`.",
      });
      console.error("uv installation failed. Web Kit will continue using standard routing.");
      return 0;
    }

    console.log(`uv detected: ${uv}`);
    const installRc = run(uv, ["tool", "install", "graphifyy"]);
    if (installRc !== 0) {
      writeState(project, {
        installed: false,
        configured: false,
        status: "graphify-install-failed",
        uv_binary: uv,
        uv_installed_by_web_kit: uvInstalledByWebKit,
      });
      console.error("Graphify installation failed. Web Kit will continue using standard routing.");
      return 0;
    }
    graphify = findBinary("graphify");
  }

  if (!graphify) {
    console.error("Graphify was installed but its executable could not be located.");
    writeState(project, { installed: false, configured: false, status: "graphify-path-unresolved" });
    return 0;
  }

  console.log(`Graphify CLI detected: ${graphify}`);
  const configured = configureProject(project, graphify) === 0;
  const graphReady = fs.existsSync(path.join(project, GRAPH_REL));

  if (!configured) {
    removeBootstrapRole(project);
    writeState(project, {
      installed: true,
      binary: graphify,
      uv_binary: uv,
      uv_installed_by_web_kit: uvInstalledByWebKit,
      configured: false,
      status: "configuration-failed",
      graph_ready: graphReady,
      initial_graph_required: !graphReady,
    });
    console.error("Graphify CLI is installed, but repo-local assistant registration failed.");
    console.error("Web Kit will continue using standard routing until Graphify is ready.");
    return 0;
  }

  writeState(project, {
    installed: true,
    installer: uv ? "uv" : "existing",
    binary: graphify,
    uv_binary: uv,
    uv_installed_by_web_kit: uvInstalledByWebKit,
    configured: true,
    status: graphReady ? "ready" : "awaiting-current-ai-build",
    graph_ready: graphReady,
    initial_graph_required: !graphReady,
  });

  console.log("Graphify is installed and registered for supported assistants in this project.");
  console.log("Project-owned AI instruction files were restored byte-for-byte after Graphify registration.");
  if (graphReady) {
    removeBootstrapRole(project);
    initializeRefreshState(project);
    console.log("Existing graph detected. No temporary initial-build role is needed.");
    console.log("Web Kit's Graph Refresh Gate will control freshness after code-changing steps.");
  } else {
    activateBootstrapRole(project);
    console.log("Temporary current-AI Graphify bootstrap role activated:");
    console.log(`  ${BOOTSTRAP_ROLE_REL.split(path.sep).join("/")}`);
    console.log("The current AI should now build the initial graph using its installed Graphify skill.");
    console.log("After graphify-out/graph.json is created, the role instructs the AI to run the Node completion command, which removes the temporary role.");
  }
  return 0;
}

process.exitCode = await main();
