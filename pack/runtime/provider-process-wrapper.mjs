#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function webKitHome() { return path.resolve(process.env.WEB_KIT_HOME || path.join(os.homedir(), ".web-kit")); }
function shimBin() { return path.join(webKitHome(), "bin"); }
function normalized(value) {
  try { return path.resolve(String(value || "")); }
  catch { return String(value || ""); }
}

function candidateNames(name) {
  return [name];
}

function resolveProvider(provider) {
  const explicit = process.env.WEB_KIT_PROVIDER_WRAPPER_TARGET;
  if (explicit) return path.resolve(explicit);

  const excluded = new Set([
    normalized(shimBin()),
    normalized(webKitHome()),
  ]);
  const self = normalized(process.argv[1]);

  for (const dir of String(process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    let resolvedDir;
    try { resolvedDir = path.resolve(dir); }
    catch { continue; }
    if (excluded.has(resolvedDir)) continue;
    for (const name of candidateNames(provider)) {
      const candidate = path.join(resolvedDir, name);
      try {
        if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
        const resolvedCandidate = normalized(candidate);
        if (resolvedCandidate === self) continue;
        return candidate;
      } catch {}
    }
  }
  return null;
}

function providerLaunch(file, args) {
  if (/\.(?:mjs|cjs|js)$/i.test(file)) return { command: process.execPath, args: [file, ...args] };
  return { command: file, args };
}

function readProcessTable() {
  const variants = [
    ["-eo", "pid=,ppid="],
    ["-axo", "pid=,ppid="],
  ];
  for (const args of variants) {
    const result = spawnSync("ps", args, { encoding: "utf8", windowsHide: true });
    if (result.error || result.status !== 0) continue;
    const rows = [];
    for (const line of String(result.stdout || "").split(/\r?\n/)) {
      const match = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]) });
    }
    if (rows.length) return rows;
  }
  return [];
}

function descendants(rootPid) {
  const rows = readProcessTable();
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row.pid);
  }
  const out = [];
  const walk = (pid, depth) => {
    for (const child of children.get(pid) || []) {
      out.push({ pid: child, depth });
      walk(child, depth + 1);
    }
  };
  walk(rootPid, 1);
  return out.sort((a, b) => b.depth - a.depth).map((entry) => entry.pid);
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

function signal(pid, name) {
  try { process.kill(pid, name); return true; }
  catch { return false; }
}

async function waitGone(pids, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pids.some(alive)) return true;
    await sleep(100);
  }
  return !pids.some(alive);
}

function restoreTerminal() {
  if (process.platform === "win32" || !process.stdin.isTTY) return;
  try { spawnSync("stty", ["sane"], { stdio: "inherit", windowsHide: true, timeout: 2000 }); }
  catch {}
}

async function terminateTree(rootPid) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return;

  const tracked = [...new Set([...descendants(rootPid), rootPid])];
  for (const pid of tracked) signal(pid, "SIGINT");
  if (await waitGone(tracked, 1500)) { restoreTerminal(); return; }

  const afterInt = [...new Set([...tracked.filter(alive), ...descendants(rootPid), rootPid])];
  for (const pid of afterInt) if (alive(pid)) signal(pid, "SIGTERM");
  if (await waitGone(afterInt, 1500)) { restoreTerminal(); return; }

  const afterTerm = [...new Set([...afterInt.filter(alive), ...descendants(rootPid), rootPid])];
  for (const pid of afterTerm) if (alive(pid)) signal(pid, "SIGKILL");
  await waitGone(afterTerm, 1000);
  restoreTerminal();
}

async function main() {
  if (process.platform !== "linux") {
    console.error("Web Kit provider process wrapper is Linux-only.");
    return 2;
  }

  const provider = String(process.env.WEB_KIT_PROVIDER_WRAPPER_NAME || "").trim().toLowerCase();
  if (!new Set(["codex", "claude"]).has(provider)) {
    console.error("Web Kit provider process wrapper: missing provider identity.");
    return 2;
  }

  const real = resolveProvider(provider);
  if (!real) {
    console.error(`Web Kit provider process wrapper: real ${provider} executable not found.`);
    return 127;
  }

  const args = process.argv.slice(2);
  const launch = providerLaunch(real, args);
  const env = { ...process.env };
  delete env.WEB_KIT_PROVIDER_WRAPPER_TARGET;
  delete env.WEB_KIT_PROVIDER_WRAPPER_NAME;
  if (provider === "codex") delete env.WEB_KIT_REAL_CODEX_BIN;
  else delete env.WEB_KIT_REAL_CLAUDE_BIN;

  const child = spawn(launch.command, launch.args, {
    stdio: "inherit",
    env,
    windowsHide: true,
  });

  let stopping = false;
  let childCode = 0;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await terminateTree(child.pid);
    process.exitCode = 0;
  };

  process.on("SIGTERM", () => { void stop(); });
  process.on("SIGINT", () => { void stop(); });

  return await new Promise((resolve) => {
    child.once("error", () => resolve(127));
    child.once("close", async (code) => {
      childCode = code ?? 1;
      if (stopping) {
        restoreTerminal();
        resolve(0);
        return;
      }
      resolve(childCode);
    });
  });
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(`[Web Kit] Linux provider wrapper error: ${error.message}`);
  process.exitCode = 1;
});
