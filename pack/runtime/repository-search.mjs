#!/usr/bin/env node
// Fast, deterministic navigation evidence for Web Kit. Never substitutes for source verification.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const EXCLUDE_DIRS = new Set([
  ".git", ".agent-core", ".agents", "graphify-out", "node_modules", "vendor",
  "dist", "build", "coverage", ".next", ".cache", ".idea", ".vscode", "bin", "obj",
]);
const EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".py",
  ".go", ".rs", ".cs", ".java", ".kt", ".swift", ".php", ".rb", ".vue",
  ".svelte", ".html", ".css", ".scss", ".less", ".sql", ".graphql", ".gql",
  ".json", ".jsonc", ".yaml", ".yml", ".toml", ".xml", ".sh", ".mdx",
]);
const SPECIAL_FILES = new Set(["Dockerfile", "Makefile", "Gemfile", "Procfile"]);
const IGNORE_FILES = /^(?:\.env(?:\..*)?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|.*\.(?:pem|key|p12|pfx|crt|map|min\.js))$/i;
const MAX_INDEX_BYTES = 512 * 1024;
const MAX_SEARCH_BYTES = 2 * 1024 * 1024;
const STOPWORDS = new Set(["the", "this", "that", "where", "what", "which", "when", "from", "into", "with", "does", "should", "could", "would", "find", "show", "code", "file", "function", "feature", "for", "and", "not", "are", "was", "have", "has"]);

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function atomicJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
    fs.renameSync(temp, file);
  } catch { /* Read-only projects still support searching without persistence. */ }
}
function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function validFile(rel) {
  const parts = rel.split("/");
  if (parts.some((part) => EXCLUDE_DIRS.has(part))) return false;
  const base = parts.at(-1);
  return !IGNORE_FILES.test(base) && (EXTENSIONS.has(path.extname(base).toLowerCase()) || SPECIAL_FILES.has(base));
}
function fileList(project) {
  const git = spawnSync("git", ["-C", project, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "buffer", windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  if (!git.error && git.status === 0) {
    return [...new Set(git.stdout.toString("utf8").split("\0"))].filter(Boolean)
      .map((p) => p.replaceAll("\\", "/")).filter(validFile).sort();
  }
  const files = [];
  function walk(dir, prefix = "") {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const item of entries) {
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory() && !EXCLUDE_DIRS.has(item.name)) walk(path.join(dir, item.name), rel);
      else if (item.isFile() && validFile(rel)) files.push(rel);
    }
  }
  walk(project);
  return files.sort();
}
function tokenize(s) {
  return [...new Set(String(s).replace(/([a-z\d])([A-Z])/g, "$1 $2").toLowerCase()
    .match(/[\p{L}\p{N}_]{2,}/gu)?.flatMap((part) => part.split("_"))
    .filter((part) => part.length > 1 && !STOPWORDS.has(part)) || [])].slice(0, 10);
}
function extractSymbols(source) {
  const results = [];
  const patterns = [
    /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var|struct)\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_][\w]*)\b/,
    /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/,
    /\b(?:fn|trait)\s+([A-Za-z_][\w]*)\b/,
  ];
  for (const [n, line] of source.split(/\r?\n/).entries()) {
    for (const pattern of patterns) {
      const match = pattern.exec(line);
      if (match && !results.some((x) => x.name === match[1])) {
        results.push({ name: match[1], line: n + 1 });
        break;
      }
    }
    if (results.length >= 100) break;
  }
  return results;
}
function buildIndex(project) {
  const file = path.join(project, ".agent-core", "index", "search-index.json");
  const previous = readJson(file, { version: 1, entries: {} });
  const entries = {};
  let updated = 0;
  const fingerprint = crypto.createHash("sha256");
  for (const rel of fileList(project)) {
    const full = path.join(project, rel);
    let stat;
    try { stat = fs.lstatSync(full, { bigint: true }); } catch { continue; }
    if (!stat.isFile()) continue; // Never follow symlinks outside the project.
    const signature = `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    fingerprint.update(rel + "\0" + signature + "\n");
    if (previous.version === 1 && previous.entries?.[rel]?.signature === signature) {
      entries[rel] = previous.entries[rel];
      continue;
    }
    let symbols = [];
    if (stat.size <= BigInt(MAX_INDEX_BYTES)) {
      try { symbols = extractSymbols(fs.readFileSync(full, "utf8")); } catch { /* Individual unreadable files are omitted. */ }
    }
    entries[rel] = { signature, symbols };
    updated++;
  }
  const result = { version: 1, fingerprint: fingerprint.digest("hex"), entries };
  if (previous.fingerprint !== result.fingerprint) atomicJson(file, result);
  return { ...result, updated, total: Object.keys(entries).length };
}
function queryKind(query, explicit) {
  if (["exact", "feature", "relationship"].includes(explicit)) return explicit;
  if (/\b(call(?:s|ed|ers)?|depend(?:s|encies)?|impact|affect(?:s|ed)?|connected|trace|relationship|references|used by)\b/i.test(query)) return "relationship";
  if (/\b(where is|defined|exact|error|symbol|endpoint|implementation of)\b/i.test(query)) return "exact";
  return "feature";
}
function scanMatches(project, entries, query, words, kind) {
  const fileHits = new Map();
  const naturalQuestion = kind === "exact" && /\s/.test(query) && !/[`"']/.test(query) && words.length > 1;
  const needle = naturalQuestion ? words[0] : query;
  const matchType = naturalQuestion ? "feature" : kind;
  const args = ["--no-heading", "--line-number", "--color=never", "--ignore-case", "--max-count=2", "--max-filesize=2M"];
  if (matchType === "exact") args.push("--fixed-strings", "-e", needle);
  else for (const word of words) args.push("--fixed-strings", "-e", word);
  args.push("--", ".");
  const rg = spawnSync("rg", args, { cwd: project, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (!rg.error && (rg.status === 0 || rg.status === 1)) {
    for (const line of (rg.stdout || "").split(/\r?\n/)) {
      const match = /^(?:\.\/|\.\\)?(.+?):(\d+):/.exec(line);
      const rel = match?.[1]?.replaceAll("\\", "/");
      if (!rel || !entries[rel]) continue;
      if (!fileHits.has(rel)) fileHits.set(rel, Number(match[2]));
    }
    return { hits: fileHits, engine: "rg", incomplete: Object.values(entries).some((item) => BigInt(item.signature.split(":")[0]) > BigInt(MAX_SEARCH_BYTES)) };
  }
  // Portable fallback: scan current files, never saved source snippets.
  let skipped = 0;
  for (const rel of Object.keys(entries)) {
    const full = path.join(project, rel);
    try {
      if (fs.statSync(full).size > MAX_SEARCH_BYTES) { skipped++; continue; }
      const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
      const matchLine = lines.findIndex((line) => matchType === "exact"
        ? line.toLowerCase().includes(needle.toLowerCase())
        : words.some((word) => line.toLowerCase().includes(word)));
      if (matchLine >= 0) fileHits.set(rel, matchLine + 1);
    } catch { skipped++; }
  }
  return { hits: fileHits, engine: "node", incomplete: skipped > 0 };
}
function rank(index, hits, query, words, kind, limit) {
  const exact = query.toLowerCase();
  const items = [];
  for (const [rel, entry] of Object.entries(index.entries)) {
    const fileName = path.basename(rel).toLowerCase();
    const symbols = entry.symbols || [];
    const symbol = symbols.find((x) => x.name.toLowerCase() === exact)
      || symbols.find((x) => words.some((w) => tokenize(x.name).includes(w)));
    const pathHits = words.filter((w) => rel.toLowerCase().includes(w));
    const symbolHits = words.filter((w) => symbols.some((x) => tokenize(x.name).includes(w)));
    const line = hits.get(rel);
    if (kind === "exact" && !line && !symbols.some((item) => item.name.toLowerCase() === exact)) continue;
    if (!line && !pathHits.length && !symbolHits.length) continue;
    let score = pathHits.length * 6 + symbolHits.length * 8 + (line ? 4 : 0);
    if (fileName.includes(exact)) score += 12;
    if (symbols.some((x) => x.name.toLowerCase() === exact)) score += 18;
    if (line && kind === "exact") score += 14;
    items.push({ path: rel, symbol: symbol?.name || null, line: line || symbol?.line || null,
      score, reason: [pathHits.length ? "path-match" : null, symbolHits.length ? "symbol-match" : null,
        line ? "current-source-match" : null].filter(Boolean), navigation_evidence_only: true });
  }
  return items.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}
function parseArgs(argv) {
  const args = { project: ".", type: "auto", limit: 10, query: "", status: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project") args.project = argv[++i];
    else if (argv[i] === "--query") args.query = argv[++i];
    else if (argv[i] === "--type") args.type = argv[++i];
    else if (argv[i] === "--limit") args.limit = Number(argv[++i]);
    else if (argv[i] === "--status") args.status = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!["auto", "exact", "feature", "relationship"].includes(args.type)) throw new Error("Invalid --type");
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 30) throw new Error("--limit must be 1..30");
  if (!args.status && (!args.query || args.query.length > 300)) throw new Error("--query must be 1..300 characters");
  return args;
}
function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = path.resolve(args.project);
  const started = process.hrtime.bigint();
  const cacheFile = path.join(project, ".agent-core", "state", "repository-search-cache.json");
  const metricsFile = path.join(project, ".agent-core", "state", "metrics", "repository-search.json");
  const metrics = readJson(metricsFile, { version: 1, searches: 0, cache_hits: 0, index_updates: 0, elapsed_ms: 0 });
  if (args.status) {
    console.log(JSON.stringify({ metrics, index: readJson(path.join(project, ".agent-core", "index", "search-index.json"), {}).fingerprint || null }, null, 2));
    return;
  }
  const index = buildIndex(project);
  const type = queryKind(args.query, args.type);
  const key = digest(JSON.stringify([index.fingerprint, type, args.query.toLowerCase(), args.limit]));
  const saved = readJson(cacheFile, { version: 1, fingerprint: "", items: {} });
  const cache = saved.version === 1 && saved.fingerprint === index.fingerprint ? saved.items || {} : {};
  const cached = Boolean(cache[key]);
  let sourceResult = cache[key];
  if (!cached) {
    const words = tokenize(args.query);
    const match = scanMatches(project, index.entries, args.query, words.length ? words : [args.query.toLowerCase()], type);
    // Only source-derived data may be cached. Graphify readiness is external to
    // the source fingerprint and must be re-evaluated for every invocation.
    sourceResult = {
      search_engine: match.engine,
      candidates: rank(index, match.hits, args.query, words, type, args.limit),
      incomplete: match.incomplete,
    };
    cache[key] = sourceResult;
    const keys = Object.keys(cache);
    while (keys.length > 80) delete cache[keys.shift()];
    atomicJson(cacheFile, { version: 1, fingerprint: index.fingerprint, items: cache });
  }
  const graphReady = type === "relationship" &&
    fs.existsSync(path.join(project, "graphify-out", "graph.json"));
  // Whitelist source-only properties when reading cached entries as well, so
  // stale guidance from caches written by older versions cannot leak through.
  const result = {
    type,
    search_engine: sourceResult.search_engine,
    candidates: sourceResult.candidates,
    incomplete: sourceResult.incomplete,
    graphify: graphReady ? "run-freshness-gate-before-query" : "not-needed",
    next_step: graphReady
      ? "Run node .agent-core/rules/graphify-refresh.mjs --project . --task-id <task-id>; use Graphify only if clean, then verify exact source."
      : "Inspect candidate symbols in current source; expand only with supporting evidence.",
    source_authority: "current repository files, diff, tests and runtime",
  };
  const elapsed = Number(process.hrtime.bigint() - started) / 1_000_000;
  metrics.searches = (metrics.searches || 0) + 1;
  metrics.cache_hits = (metrics.cache_hits || 0) + Number(cached);
  metrics.index_updates = (metrics.index_updates || 0) + index.updated;
  metrics.elapsed_ms = Math.round((metrics.elapsed_ms || 0) + elapsed);
  atomicJson(metricsFile, metrics);
  console.log(JSON.stringify({ ...result, cached, index_files: index.total, index_updated: index.updated, elapsed_ms: Math.round(elapsed * 100) / 100 }, null, 2));
}
try { main(); } catch (error) { console.error(`repository-search: ${error.message}`); process.exitCode = 2; }
