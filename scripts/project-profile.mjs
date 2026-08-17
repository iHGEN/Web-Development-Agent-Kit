#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IGNORE_DIRS = new Set([
  ".git", ".agents", ".agent-core", "node_modules", "vendor", "bin", "obj",
  ".next", "dist", "build", "coverage", ".idea", ".vscode", ".cache", "graphify-out",
]);
const ALLOWED_HIDDEN_DIRS = new Set([".github", ".devcontainer"]);
const IMPORTANT_ROOT_FILES = new Set([
  "package.json", "composer.json", "tsconfig.json", "pyproject.toml", "go.mod",
  "Cargo.toml", "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
  "compose.yml", "compose.yaml", "pnpm-workspace.yaml", "turbo.json", "nx.json",
  "vite.config.ts", "vite.config.js", "next.config.js", "next.config.mjs",
  "next.config.ts", "artisan",
]);
const GRAPHIFY_MCP_CONFIGS = [
  ".mcp.json", "mcp.json", ".cursor/mcp.json", ".gemini/settings.json",
  ".vscode/mcp.json", ".codex/config.toml",
];
const CATEGORY_LABELS = {
  languages: "Languages",
  frontend: "Frontend",
  backend: "Backend",
  "api-realtime": "API / Realtime",
  auth: "Authentication / Authorization",
  data: "Data / ORM",
  "distributed-jobs": "Distributed / Jobs",
  "storage-media": "Storage / Media",
  testing: "Testing",
  "observability-performance": "Observability / Performance",
  "devops-delivery": "DevOps / Delivery",
  packages: "Package Management",
  integrations: "Integrations",
  "architecture-patterns": "Architecture",
};

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function detectProjectName(project) {
  const pkg = readJson(path.join(project, "package.json"));
  if (typeof pkg.name === "string" && pkg.name.trim()) return pkg.name.trim();

  const composer = readJson(path.join(project, "composer.json"));
  if (typeof composer.name === "string" && composer.name.trim()) return composer.name.trim();

  try {
    const entries = fs.readdirSync(project, { withFileTypes: true });
    const sln = entries.find((e) => e.isFile() && e.name.endsWith(".sln"));
    if (sln) return path.parse(sln.name).name;
    const csproj = entries.find((e) => e.isFile() && e.name.endsWith(".csproj"));
    if (csproj) return path.parse(csproj.name).name;
  } catch {}

  return path.basename(project);
}

function looksLikeGraphifyCodeMcp(text) {
  const lower = String(text || "").toLowerCase();
  return lower.includes("graphify.serve") || lower.includes("graphify-mcp") ||
    (lower.includes("graphify") && lower.includes("graphify-out/graph.json"));
}

export function detectGraphify(project) {
  const graphPath = path.join(project, "graphify-out", "graph.json");
  const graphReady = fs.existsSync(graphPath) && fs.statSync(graphPath).isFile();
  const configHits = [];

  for (const rel of GRAPHIFY_MCP_CONFIGS) {
    const file = path.join(project, rel);
    if (!fs.existsSync(file)) continue;
    try {
      if (looksLikeGraphifyCodeMcp(fs.readFileSync(file, "utf8"))) configHits.push(rel);
    } catch {}
  }

  const installState = readJson(path.join(project, ".agent-core", "state", "graphify-install.json"));
  const detected = graphReady || configHits.length > 0 || installState.configured === true;
  let note;
  if (graphReady) {
    note = "Graphify graph snapshot detected. Use graph-assisted navigation only after the managed freshness gate reports a clean graph; verify behavior from exact source.";
  } else if (detected) {
    note = "Graphify integration detected but no project graph snapshot is ready. Use standard routing until graphify-out/graph.json exists.";
  } else {
    note = "Graphify not detected in this project; use standard repository routing.";
  }

  return {
    detected,
    graph_ready: graphReady,
    graph_path: graphReady ? "graphify-out/graph.json" : null,
    local_mcp_configured: configHits.length > 0,
    config_files: configHits.sort(),
    routing_mode: graphReady ? "graphify-assisted" : "standard",
    fallback_mode: "standard",
    runtime_tool_required: graphReady,
    source_authority: "repository source",
    note,
  };
}

export function buildStructureSummary(project, maxDepth = 2, maxEntries = 70) {
  const directories = new Set();
  const rootFiles = new Set();

  function walk(current, depth) {
    if (directories.size + rootFiles.size >= maxEntries * 2) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith(".") && !ALLOWED_HIDDEN_DIRS.has(entry.name)) continue;
        const full = path.join(current, entry.name);
        const rel = path.relative(project, full).split(path.sep).join("/");
        const relDepth = rel.split("/").filter(Boolean).length;
        if (relDepth >= 1 && relDepth <= maxDepth) directories.add(`${rel}/`);
        if (depth + 1 < maxDepth) walk(full, depth + 1);
      } else if (depth === 0) {
        if (IMPORTANT_ROOT_FILES.has(entry.name) || entry.name.endsWith(".sln") || entry.name.endsWith(".csproj")) {
          rootFiles.add(entry.name);
        }
      }
    }
  }

  walk(project, 0);
  return [...directories, ...rootFiles].sort().slice(0, maxEntries);
}

export function groupDetectedSkills(skills, kitRoot) {
  const catalog = readJson(path.join(kitRoot, "pack", "router", "skill-catalog.json"));
  const categoryBySkill = new Map();
  for (const item of Array.isArray(catalog.skills) ? catalog.skills : []) {
    if (item && typeof item === "object") categoryBySkill.set(item.name, item.category);
  }

  const grouped = {};
  for (const skill of skills) {
    const category = categoryBySkill.get(skill);
    const label = CATEGORY_LABELS[category];
    if (!label) continue;
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(skill);
  }

  for (const label of Object.keys(grouped)) {
    grouped[label] = [...new Set(grouped[label])].sort();
  }
  return grouped;
}

export function buildProjectProfile(project, kitRoot, version) {
  const cfg = readJson(path.join(project, ".agent-kit.json"));
  const index = readJson(path.join(project, ".agent-core", "index", "project-index.json"));
  const skills = Array.isArray(cfg.detected_skills) ? cfg.detected_skills : [];

  return {
    name: detectProjectName(project),
    directory: path.basename(project),
    domain: "web",
    kit_version: version,
    technology_groups: groupDetectedSkills(skills, kitRoot),
    detected_skills: [...new Set(skills)].sort(),
    capabilities: { graphify: detectGraphify(project) },
    structure: buildStructureSummary(project),
    manifests: Array.isArray(index.manifests) ? index.manifests : [],
    config_files: Array.isArray(index.config_files) ? index.config_files : [],
    test_roots: Array.isArray(index.test_roots) ? index.test_roots : [],
    migration_roots: Array.isArray(index.migration_roots) ? index.migration_roots : [],
    source: "Generated from lightweight structural discovery; source contents are not embedded.",
  };
}

export function applyProjectProfile(project, { kitRoot, version } = {}) {
  project = path.resolve(project);
  kitRoot = kitRoot ? path.resolve(kitRoot) : path.resolve(__dirname, "..");
  if (!version) {
    try { version = fs.readFileSync(path.join(kitRoot, "VERSION"), "utf8").trim(); }
    catch { version = "unknown"; }
  }

  const profile = buildProjectProfile(project, kitRoot, version);
  const profilePath = path.join(project, ".agent-core", "index", "project-profile.json");
  writeJson(profilePath, profile);

  const cfgPath = path.join(project, ".agent-kit.json");
  const cfg = readJson(cfgPath);
  if (Object.keys(cfg).length) {
    cfg.project = {
      name: profile.name,
      directory: profile.directory,
      domain: profile.domain,
      technology_groups: profile.technology_groups,
    };
    cfg.capabilities = profile.capabilities;
    writeJson(cfgPath, cfg);
  }

  return { path: profilePath, action: "updated machine-readable project profile", profile };
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === __filename;
}

if (isMain()) {
  const args = process.argv.slice(2);
  const projectArg = args.find((arg) => !arg.startsWith("-")) || ".";
  const result = applyProjectProfile(projectArg);
  console.log(result.action);
  console.log(`Project: ${result.profile.name}`);
}
