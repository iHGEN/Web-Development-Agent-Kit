#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import AdmZip from "adm-zip";

const ACTIONS = new Set(["install", "update", "doctor", "scan"]);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return {}; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function parseArgs(argv) {
  const out = { action: "install", repo: null, ref: null, source: null, sha256: null, project: ".", forceAgents: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i] || null;
    if (arg === "--action") out.action = next();
    else if (arg.startsWith("--action=")) out.action = arg.slice(9);
    else if (arg === "--repo") out.repo = next();
    else if (arg.startsWith("--repo=")) out.repo = arg.slice(7);
    else if (arg === "--ref") out.ref = next();
    else if (arg.startsWith("--ref=")) out.ref = arg.slice(6);
    else if (arg === "--source") out.source = next();
    else if (arg.startsWith("--source=")) out.source = arg.slice(9);
    else if (arg === "--sha256") out.sha256 = next();
    else if (arg.startsWith("--sha256=")) out.sha256 = arg.slice(9);
    else if (arg === "--project") out.project = next() || ".";
    else if (arg.startsWith("--project=")) out.project = arg.slice(10);
    else if (arg === "--force-agents") out.forceAgents = true;
  }
  return out;
}
function sourceFor(args, project) {
  const saved = readJson(path.join(project, ".agent-kit-source.json"));
  if (args.source) return { source: args.source, repo: args.repo || saved.repo || null, ref: args.ref || saved.ref || "main" };
  if (args.repo || args.ref) {
    const repo = args.repo || saved.repo;
    const ref = args.ref || saved.ref || "main";
    if (!repo) throw new Error("A GitHub --ref requires --repo or a previously saved repository.");
    return { source: `https://codeload.github.com/${repo}/zip/${encodeURIComponent(ref)}`, repo, ref };
  }
  if (saved.source) return { source: saved.source, repo: saved.repo || null, ref: saved.ref || "main" };
  if (saved.repo) return { source: `https://codeload.github.com/${saved.repo}/zip/${encodeURIComponent(saved.ref || "main")}`, repo: saved.repo, ref: saved.ref || "main" };
  throw new Error("Use --repo OWNER/REPO or --source ZIP_URL for the first remote action.");
}
async function download(url, output) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "web-dev-agent-kit/1.1-node" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const body = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(output, body);
    console.log(`Download complete: ${(body.length / 1024 / 1024).toFixed(1)} MiB`);
  } finally {
    clearTimeout(timer);
  }
}
function copyLocalSource(source, output) {
  let local = source;
  if (source.startsWith("file://")) local = fileURLToPath(source);
  local = path.resolve(local.replace(/^~(?=$|[\\/])/, os.homedir()));
  fs.copyFileSync(local, output);
  console.log(`Using local Web Kit archive: ${local}`);
}
function findRoot(extract) {
  const queue = [extract];
  while (queue.length) {
    const current = queue.shift();
    if (fs.existsSync(path.join(current, "scripts", "agent-kit.mjs")) && fs.existsSync(path.join(current, "pack")) && fs.existsSync(path.join(current, "AGENTS.template.md"))) return current;
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch {}
    for (const entry of entries) if (entry.isDirectory()) queue.push(path.join(current, entry.name));
  }
  throw new Error("Kit root not found in downloaded archive.");
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!ACTIONS.has(args.action)) throw new Error(`Unsupported action: ${args.action}`);
  const project = path.resolve(args.project);
  if (["install", "update"].includes(args.action)) fs.mkdirSync(project, { recursive: true });
  else if (!fs.existsSync(project)) throw new Error(`Project does not exist: ${project}`);

  const selected = sourceFor(args, project);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-"));
  const archive = path.join(temp, "kit.zip");
  const extract = path.join(temp, "extract");
  fs.mkdirSync(extract, { recursive: true });

  try {
    const sourcePath = selected.source.startsWith("file://") ? fileURLToPath(selected.source) : selected.source;
    if (selected.source.startsWith("file://") || fs.existsSync(path.resolve(sourcePath))) copyLocalSource(selected.source, archive);
    else {
      console.log(`Downloading ${selected.source}`);
      try { await download(selected.source, archive); }
      catch (error) {
        throw new Error(`Failed to download Web Kit source: ${selected.source}\nIf this is an npm release, make sure the matching GitHub tag exists before publishing.\nDetails: ${error.message}`);
      }
    }

    console.log("Verifying downloaded archive...");
    const digest = sha256(archive);
    if (args.sha256 && digest.toLowerCase() !== args.sha256.toLowerCase()) throw new Error(`SHA-256 mismatch. Expected ${args.sha256}, got ${digest}`);

    console.log("Extracting Web Kit...");
    new AdmZip(archive).extractAllTo(extract, true);
    const kit = findRoot(extract);
    const cli = path.join(kit, "scripts", "agent-kit.mjs");
    const cmd = [cli, args.action, project];
    if (args.forceAgents) cmd.push("--force-agents");

    console.log(`Running Web Kit ${args.action} against ${project}...`);
    const result = spawnSync(process.execPath, cmd, { stdio: "inherit", windowsHide: true });
    if (result.error || result.status !== 0) return result.error ? 1 : (result.status ?? 1);

    if (["install", "update"].includes(args.action)) {
      writeJson(path.join(project, ".agent-kit-source.json"), {
        repo: selected.repo,
        ref: selected.ref,
        source: selected.source,
        sha256: digest,
        runtime: "node+npm",
      });
      console.log("Remote Web Development Agent Kit action complete.");
      console.log("Runtime requirement: Node.js + npm only. A system Python installation is not required.");
      console.log("Future update: npx @ihgen/web-kit update --project .");
    }
    return 0;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
