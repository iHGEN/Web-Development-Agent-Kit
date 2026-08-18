#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { applyProjectProfile, readJson, writeJson } from "./project-profile.mjs";
import { applyAiCompatibility, findUnmanagedGraphifyConflicts, ROLE_START, ROLE_END } from "./ai-compat.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KIT_ROOT = path.resolve(__dirname, "..");
const PACK = path.join(KIT_ROOT, "pack");
const VERSION = fs.readFileSync(path.join(KIT_ROOT, "VERSION"), "utf8").trim();
const IGNORE_DIRS = new Set([
  ".git", ".agents", ".agent-core", "node_modules", "vendor", "bin", "obj",
  ".next", "dist", "build", "coverage", ".idea", ".vscode", ".cache", "graphify-out",
]);

function posix(value) { return value.split(path.sep).join("/"); }

function walkFiles(project) {
  const files = [];
  function walk(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        files.push({ full, rel: posix(path.relative(project, full)) });
      }
    }
  }
  walk(project);
  return files;
}

function buildProjectIndex(project) {
  const files = walkFiles(project);
  const extensionCounts = {};
  const topDirs = new Set();
  const manifests = new Set();
  const testRoots = new Set();
  const migrationRoots = new Set();
  const configFiles = new Set();
  const manifestNames = new Set([
    "package.json", "composer.json", "tsconfig.json", "pyproject.toml", "go.mod", "Cargo.toml",
    "Dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml",
  ]);
  const configNames = new Set([
    "appsettings.json", "appsettings.development.json", "vite.config.ts", "vite.config.js",
    "next.config.js", "next.config.mjs", "next.config.ts", "tailwind.config.js", "tailwind.config.ts",
  ]);

  for (const { rel } of files) {
    const parts = rel.split("/");
    if (parts.length) topDirs.add(parts[0]);
    const ext = path.extname(rel).toLowerCase() || "<none>";
    extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
    const name = path.basename(rel);
    if (manifestNames.has(name) || name.endsWith(".csproj") || name.endsWith(".sln")) manifests.add(rel);
    const lowerParts = parts.map((part) => part.toLowerCase());
    if (lowerParts.some((part) => ["test", "tests", "__tests__", "spec", "specs"].includes(part)) && parts.length > 1) testRoots.add(parts[0]);
    if (lowerParts.includes("migration") || lowerParts.includes("migrations")) {
      if (parts.length > 1) migrationRoots.add(parts[0]);
    }
    if (configNames.has(name.toLowerCase())) configFiles.add(rel);
  }

  const sortedExtensions = Object.fromEntries(Object.entries(extensionCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  return {
    top_level: [...topDirs].sort(),
    manifests: [...manifests].sort().slice(0, 200),
    config_files: [...configFiles].sort().slice(0, 200),
    test_roots: [...testRoots].sort(),
    migration_roots: [...migrationRoots].sort(),
    extension_counts: sortedExtensions,
    note: "Structural routing index only; source contents are intentionally not embedded.",
  };
}

function globRegex(pattern) {
  let out = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        i += 1;
        if (pattern[i + 1] === "/") {
          i += 1;
          out += "(?:.*/)?";
        } else out += ".*";
      } else out += "[^/]*";
    } else if (char === "?") out += "[^/]";
    else out += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${out}$`);
}

function fileMatches(rel, pattern) {
  const normalized = posix(rel);
  try { return globRegex(pattern).test(normalized) || globRegex(pattern).test(path.basename(normalized)); }
  catch { return normalized === pattern || path.basename(normalized) === pattern.replace(/^\*\*\//, ""); }
}

function npmPackages(files) {
  const out = new Set();
  for (const { full, rel } of files) {
    if (path.basename(rel) !== "package.json") continue;
    const data = readJson(full);
    for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const key of Object.keys(data[section] || {})) out.add(key);
    }
  }
  return out;
}

function composerPackages(files) {
  const out = new Set();
  for (const { full, rel } of files) {
    if (path.basename(rel) !== "composer.json") continue;
    const data = readJson(full);
    for (const section of ["require", "require-dev"]) {
      for (const key of Object.keys(data[section] || {})) out.add(key);
    }
  }
  return out;
}

function combinedText(files, predicate) {
  const chunks = [];
  for (const file of files) {
    if (!predicate(file)) continue;
    try { chunks.push(fs.readFileSync(file.full, "utf8")); }
    catch {}
  }
  return chunks.join("\n");
}

function matchingFileContains(files, mapping) {
  const hits = [];
  if (!mapping || typeof mapping !== "object") return hits;
  for (const [filename, needles] of Object.entries(mapping)) {
    for (const file of files) {
      if (path.basename(file.rel) !== filename) continue;
      let text = "";
      try { text = fs.readFileSync(file.full, "utf8"); }
      catch { continue; }
      const lower = text.toLowerCase();
      for (const needle of needles || []) {
        if (lower.includes(String(needle).toLowerCase())) hits.push(`${file.rel}: ${needle}`);
      }
    }
  }
  return hits;
}

function detect(project) {
  const files = walkFiles(project);
  const npms = npmPackages(files);
  const composers = composerPackages(files);
  const csproj = combinedText(files, (f) => f.rel.toLowerCase().endsWith(".csproj")).toLowerCase();
  const compose = combinedText(files, (f) => ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].includes(path.basename(f.rel))).toLowerCase();
  const manifest = readJson(path.join(PACK, "router", "skill-map.json"));
  const detected = new Set(Array.isArray(manifest.always_install) ? manifest.always_install : []);
  const evidence = {};
  for (const skill of detected) evidence[skill] = ["web pack baseline"];

  for (const rule of Array.isArray(manifest.rules) ? manifest.rules : []) {
    const reasons = [];
    const patterns = Array.isArray(rule.any_files) ? rule.any_files : [];
    const matches = files.filter((file) => patterns.some((pattern) => fileMatches(file.rel, pattern))).map((file) => file.rel);
    if (matches.length) reasons.push(`files: ${[...new Set(matches)].sort().slice(0, 5).join(", ")}`);

    const npmHits = (rule.npm_packages || []).filter((pkg) => npms.has(pkg)).sort();
    if (npmHits.length) reasons.push(`npm: ${npmHits.join(", ")}`);
    const composerHits = (rule.composer_packages || []).filter((pkg) => composers.has(pkg)).sort();
    if (composerHits.length) reasons.push(`composer: ${composerHits.join(", ")}`);
    const csHits = (rule.csproj_contains || []).filter((needle) => csproj.includes(String(needle).toLowerCase()));
    if (csHits.length) reasons.push(`csproj: ${csHits.join(", ")}`);
    const imageHits = (rule.compose_images || []).filter((needle) => compose.includes(String(needle).toLowerCase()));
    if (imageHits.length) reasons.push(`compose image: ${imageHits.join(", ")}`);
    const fileContains = matchingFileContains(files, rule.file_contains);
    if (fileContains.length) reasons.push(`file content: ${fileContains.slice(0, 5).join(", ")}`);

    if (reasons.length) {
      detected.add(rule.skill);
      evidence[rule.skill] = reasons;
    }
  }
  return { skills: [...detected].sort(), evidence };
}

function copyTree(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

function renderConfig(skills, evidence) {
  return { kit: "web-dev-agent-kit", version: VERSION, domain: "web", runtime: "node+npm", detected_skills: skills, evidence };
}

function writeProjectUpdater(project) {
  const file = path.join(project, ".agent-core", "bin", "web-kit-update.mjs");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, "../..");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npx, ["--yes", "@ihgen/web-kit", "update", "--project", project, ...process.argv.slice(2)], { stdio: "inherit", windowsHide: true });
process.exit(result.error ? 1 : (result.status ?? 1));
`, "utf8");
}

function install(project) {
  project = path.resolve(project);
  fs.mkdirSync(project, { recursive: true });
  const { skills, evidence } = detect(project);
  const core = path.join(project, ".agent-core");
  copyTree(path.join(PACK, "agents"), path.join(core, "agents"));
  copyTree(path.join(PACK, "rules"), path.join(core, "rules"));
  copyTree(path.join(PACK, "contracts"), path.join(core, "contracts"));
  copyTree(path.join(PACK, "registry"), path.join(core, "registry"));
  copyTree(path.join(PACK, "runtime"), path.join(core, "bin"));

  const skillRoot = path.join(project, ".agents", "skills");
  fs.mkdirSync(skillRoot, { recursive: true });
  for (const skill of skills) copyTree(path.join(PACK, "skills", skill), path.join(skillRoot, skill));

  writeJson(path.join(project, ".agent-kit.json"), renderConfig(skills, evidence));
  writeJson(path.join(core, "index", "project-index.json"), buildProjectIndex(project));
  fs.mkdirSync(path.join(core, "routing"), { recursive: true });
  fs.copyFileSync(path.join(PACK, "router", "context-policy.json"), path.join(core, "routing", "context-policy.json"));
  fs.copyFileSync(path.join(PACK, "router", "agent-route-map.json"), path.join(core, "routing", "agent-route-map.json"));
  fs.mkdirSync(path.join(core, "catalog"), { recursive: true });
  fs.copyFileSync(path.join(PACK, "router", "skill-catalog.json"), path.join(core, "catalog", "skill-catalog.json"));

  const profileResult = applyProjectProfile(project, { kitRoot: KIT_ROOT, version: VERSION });
  const compatibility = applyAiCompatibility(project, profileResult.profile);
  writeProjectUpdater(project);

  console.log(`Web Agent Kit ${VERSION} installed`);
  console.log(`Runtime: Node.js ${process.version}; Python is not required by Web Kit`);
  console.log(`Project: ${profileResult.profile.name}`);
  console.log(`Project directory: ${project}`);
  console.log(`Agents: ${fs.existsSync(path.join(core, "agents")) ? fs.readdirSync(path.join(core, "agents")).filter((name) => name.endsWith(".md")).length : 0}`);
  console.log(`Skills: ${skills.join(", ")}`);
  console.log("AI instructions: existing files preserved; missing files created once with project summary; managed roles synchronized");
  console.log(`Canonical workflow: ${compatibility.canonical_workflow}`);
  console.log("Automatic context rollover: .agent-core/bin/session-controller.mjs (default threshold 50%)");
  return 0;
}

function hasRolesBlock(file) {
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, "utf8");
  return text.includes(ROLE_START) && text.includes(ROLE_END);
}

function doctor(project) {
  project = path.resolve(project);
  const { skills: expected } = detect(project);
  const cfg = readJson(path.join(project, ".agent-kit.json"));
  const profile = readJson(path.join(project, ".agent-core", "index", "project-profile.json"));
  const graphState = readJson(path.join(project, ".agent-core", "state", "graphify.json"));
  const installState = readJson(path.join(project, ".agent-core", "state", "graphify-install.json"));
  const actualGraphReady = fs.existsSync(path.join(project, "graphify-out", "graph.json"));
  const sessionController = path.join(project, ".agent-core", "bin", "session-controller.mjs");
  const rolloverRule = path.join(project, ".agent-core", "rules", "context-rollover.md");
  const skillRoot = path.join(project, ".agents", "skills");
  const installed = fs.existsSync(skillRoot)
    ? fs.readdirSync(skillRoot, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(skillRoot, e.name, "SKILL.md"))).map((e) => e.name).sort()
    : [];
  const missing = expected.filter((skill) => !installed.includes(skill));
  const stale = installed.filter((skill) => !expected.includes(skill));
  const agentDir = path.join(project, ".agent-core", "agents");
  const agentFiles = fs.existsSync(agentDir) ? fs.readdirSync(agentDir).filter((name) => name.endsWith(".md")) : [];
  const instructionPaths = {
    "AGENTS.md": path.join(project, "AGENTS.md"),
    "CLAUDE.md": path.join(project, "CLAUDE.md"),
    "GEMINI.md": path.join(project, "GEMINI.md"),
    "GitHub Copilot": path.join(project, ".github", "copilot-instructions.md"),
    "Cursor": path.join(project, ".cursor", "rules", "ihgen-web-kit.mdc"),
  };
  const rolesOk = Object.values(instructionPaths).every(hasRolesBlock);
  const warnings = [];
  const cfgGraphify = cfg.capabilities?.graphify || {};
  const profileGraphify = profile.capabilities?.graphify || {};

  for (const key of ["detected", "graph_ready", "routing_mode"]) {
    if (Object.keys(cfgGraphify).length && Object.keys(profileGraphify).length && cfgGraphify[key] !== profileGraphify[key]) {
      warnings.push(`Graphify metadata mismatch for ${key}: .agent-kit.json=${JSON.stringify(cfgGraphify[key])}, project-profile.json=${JSON.stringify(profileGraphify[key])}`);
    }
  }
  if (Object.keys(cfgGraphify).length && cfgGraphify.graph_ready !== actualGraphReady) warnings.push(`.agent-kit.json Graphify graph_ready=${cfgGraphify.graph_ready} but graph presence is ${actualGraphReady}`);
  if (Object.keys(profileGraphify).length && profileGraphify.graph_ready !== actualGraphReady) warnings.push(`project-profile.json Graphify graph_ready=${profileGraphify.graph_ready} but graph presence is ${actualGraphReady}`);
  if (Object.keys(installState).length && installState.graph_ready !== actualGraphReady) warnings.push(`graphify-install.json graph_ready=${installState.graph_ready} but graph presence is ${actualGraphReady}`);
  if (actualGraphReady && !Object.keys(graphState).length) warnings.push("Graphify graph exists but freshness state is missing");

  for (const [label, file] of Object.entries(instructionPaths)) {
    if (label === "Cursor") continue;
    for (const issue of findUnmanagedGraphifyConflicts(file)) warnings.push(`${label}: ${issue}; canonical Graph Refresh Gate should control Graphify refresh/use`);
  }

  console.log(`Web Agent Kit Doctor — ${project}`);
  console.log(`Runtime: Node.js ${process.version} — Python requirement: NONE for Web Kit`);
  console.log(`Detected skills: ${expected.join(", ")}`);
  console.log(`Installed skills: ${installed.length ? installed.join(", ") : "(none)"}`);
  console.log(`Agent definitions: ${agentFiles.length}`);
  console.log(`Config: ${Object.keys(cfg).length ? "OK" : "MISSING"}`);
  console.log(`Project index: ${fs.existsSync(path.join(project, ".agent-core", "index", "project-index.json")) ? "OK" : "MISSING"}`);
  console.log(`Project profile: ${fs.existsSync(path.join(project, ".agent-core", "index", "project-profile.json")) ? "OK" : "MISSING"}`);
  console.log(`Routing policy: ${fs.existsSync(path.join(project, ".agent-core", "routing", "context-policy.json")) ? "OK" : "MISSING"}`);
  console.log(`AI managed roles: ${rolesOk ? "OK" : "MISSING"}`);
  console.log(`Session Controller: ${fs.existsSync(sessionController) ? "OK" : "MISSING"}`);
  console.log(`Context rollover rule: ${fs.existsSync(rolloverRule) ? "OK" : "MISSING"}`);
  console.log(`Graphify graph: ${actualGraphReady ? "READY" : "NOT READY"}`);
  if (missing.length) console.log(`Missing skills: ${missing.join(", ")}`);
  if (stale.length) console.log(`Installed but no longer detected: ${stale.join(", ")}`);
  if (warnings.length) {
    console.log("Warnings:");
    for (const warning of warnings) console.log(`  - ${warning}`);
    console.log("Metadata repair: run `node .agent-core/rules/graphify-refresh.mjs --project . --task-id metadata-sync` once.");
  }

  const healthy = !missing.length && agentFiles.length > 0 && Object.keys(cfg).length && rolesOk
    && fs.existsSync(path.join(project, ".agent-core", "index", "project-profile.json"))
    && fs.existsSync(sessionController) && fs.existsSync(rolloverRule);
  console.log(healthy ? (warnings.length ? "Status: HEALTHY WITH WARNINGS" : "Status: HEALTHY") : "Status: NEEDS ATTENTION");
  return healthy ? 0 : 1;
}

function scan(project) {
  project = path.resolve(project);
  const { skills, evidence } = detect(project);
  const result = renderConfig(skills, evidence);
  result.project_index = buildProjectIndex(project);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

function showCatalog() {
  const catalog = readJson(path.join(PACK, "router", "skill-catalog.json"));
  console.log(`Web skill catalog: ${catalog.count || 0} skills`);
  for (const [category, names] of Object.entries(catalog.categories || {}).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`\n[${category}] ${names.length}`);
    console.log(`  ${names.join(", ")}`);
  }
  return 0;
}

function addSkill(project, skill) {
  project = path.resolve(project);
  const source = path.join(PACK, "skills", skill);
  if (!fs.existsSync(path.join(source, "SKILL.md"))) {
    console.error(`Unknown skill: ${skill}`);
    return 2;
  }
  copyTree(source, path.join(project, ".agents", "skills", skill));
  const cfgPath = path.join(project, ".agent-kit.json");
  const cfg = readJson(cfgPath);
  if (Object.keys(cfg).length) {
    cfg.activated_skills = [...new Set([...(cfg.activated_skills || []), skill])].sort();
    writeJson(cfgPath, cfg);
  }
  console.log(`Activated skill: ${skill}`);
  return 0;
}

function setupGraphify(project) {
  const installedScript = path.join(path.resolve(project), ".agent-core", "rules", "graphify-setup.mjs");
  const sourceScript = path.join(PACK, "rules", "graphify-setup.mjs");
  const script = fs.existsSync(installedScript) ? installedScript : sourceScript;
  const result = spawnSync(process.execPath, [script, "--project", path.resolve(project), "--yes"], { stdio: "inherit", windowsHide: true });
  return result.error ? 1 : (result.status ?? 1);
}

function parseCli(argv) {
  const command = argv[0];
  const rest = argv.slice(1);
  return { command, rest };
}

const { command, rest } = parseCli(process.argv.slice(2));
let rc = 0;
if (["scan", "doctor", "update", "install", "graphify"].includes(command)) {
  const project = rest.find((arg) => !arg.startsWith("-")) || ".";
  if (rest.includes("--force-agents")) console.warn("--force-agents is deprecated and ignored: Web Kit never overwrites project-owned AI instruction content.");
  if (command === "scan") rc = scan(project);
  else if (command === "doctor") rc = doctor(project);
  else if (command === "graphify") rc = setupGraphify(project);
  else rc = install(project);
} else if (command === "catalog") rc = showCatalog();
else if (command === "add-skill") rc = addSkill(rest[0] || ".", rest[1] || "");
else {
  console.error("Usage: node scripts/agent-kit.mjs <install|update|scan|doctor|graphify|catalog|add-skill> [project] [skill]");
  rc = 2;
}
process.exitCode = rc;
