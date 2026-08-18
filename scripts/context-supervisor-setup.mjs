#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KIT_ROOT = path.resolve(__dirname, "..");
const START = "# >>> ihgen-web-kit-context-supervisor >>>";
const END = "# <<< ihgen-web-kit-context-supervisor <<<";
const PS_START = "# >>> ihgen-web-kit-context-supervisor >>>";
const PS_END = "# <<< ihgen-web-kit-context-supervisor <<<";

function userHome() {
  return path.resolve(process.env.WEB_KIT_USER_HOME || os.homedir());
}

function webKitHome() {
  return path.resolve(process.env.WEB_KIT_HOME || path.join(userHome(), ".web-kit"));
}

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  if (process.platform !== "win32") {
    try { fs.chmodSync(dst, 0o755); } catch {}
  }
}

function replaceMarkedBlock(text, start, end, block) {
  const startIndex = text.indexOf(start);
  if (startIndex < 0) return `${text}${text && !text.endsWith("\n") ? "\n" : ""}\n${block}\n`;
  const endIndex = text.indexOf(end, startIndex);
  if (endIndex < 0) return `${text}${text && !text.endsWith("\n") ? "\n" : ""}\n${block}\n`;
  return text.slice(0, startIndex) + block + text.slice(endIndex + end.length);
}

function writeProfileBlock(file, block, start = START, end = END) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const next = replaceMarkedBlock(current, start, end, block);
    if (next !== current) fs.writeFileSync(file, next, "utf8");
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function installPosixProfiles(binDir, home) {
  if (process.env.WEB_KIT_DISABLE_SHELL_PROFILE === "1") return [];
  const block = `${START}\n# Added by iHGEN Web Kit. Keeps normal codex/claude commands while enabling context rollover in Web-Kit projects.\ncase ":$PATH:" in\n  *:${shellQuote(binDir).slice(1, -1)}:*) ;;\n  *) export PATH=${shellQuote(binDir)}:$PATH ;;\nesac\n${END}`;
  const candidates = new Set();
  if (process.platform === "darwin") candidates.add(path.join(home, ".zshrc"));
  candidates.add(path.join(home, ".bashrc"));
  candidates.add(path.join(home, ".zshrc"));
  candidates.add(path.join(home, ".profile"));
  if (process.platform === "win32" && (process.env.MSYSTEM || process.env.SHELL?.includes("bash"))) {
    candidates.add(path.join(home, ".bash_profile"));
  }
  const written = [];
  for (const file of candidates) if (writeProfileBlock(file, block)) written.push(file);
  return written;
}

function installFishProfile(binDir, home) {
  if (process.env.WEB_KIT_DISABLE_SHELL_PROFILE === "1") return null;
  const file = path.join(home, ".config", "fish", "conf.d", "ihgen-web-kit.fish");
  const block = `# iHGEN Web Kit transparent context supervisor\nif not contains -- ${JSON.stringify(binDir)} $PATH\n    set -gx PATH ${JSON.stringify(binDir)} $PATH\nend\n`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, block, "utf8");
    return file;
  } catch { return null; }
}

function installPowerShellProfiles(binDir, home) {
  if (process.platform !== "win32" || process.env.WEB_KIT_DISABLE_SHELL_PROFILE === "1") return [];
  const escaped = binDir.replace(/'/g, "''");
  const block = `${PS_START}\n# Added by iHGEN Web Kit.\n$__ihgenWebKitBin = '${escaped}'\nif (-not (($env:Path -split ';') -contains $__ihgenWebKitBin)) { $env:Path = \"$__ihgenWebKitBin;$env:Path\" }\nRemove-Variable __ihgenWebKitBin -ErrorAction SilentlyContinue\n${PS_END}`;
  const candidates = [
    path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
    path.join(home, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
  ];
  const written = [];
  for (const file of candidates) if (writeProfileBlock(file, block, PS_START, PS_END)) written.push(file);
  return written;
}

function persistWindowsUserPath(binDir) {
  if (process.platform !== "win32" || process.env.WEB_KIT_DISABLE_SHELL_PROFILE === "1") return false;
  const ps = ["pwsh.exe", "powershell.exe"].find((candidate) => {
    const result = spawnSync("where.exe", [candidate], { stdio: "ignore", windowsHide: true });
    return !result.error && result.status === 0;
  });
  if (!ps) return false;
  const script = [
    `$bin = ${JSON.stringify(binDir)}`,
    `$current = [Environment]::GetEnvironmentVariable('Path','User')`,
    `$parts = @($current -split ';' | Where-Object { $_ -and ($_ -ne $bin) })`,
    `[Environment]::SetEnvironmentVariable('Path', (($bin) + ';' + ($parts -join ';')).TrimEnd(';'), 'User')`,
  ].join("; ");
  const result = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore", windowsHide: true });
  return !result.error && result.status === 0;
}

function writeShims(base, binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const supervisor = path.join(base, "context-supervisor.mjs");
  const posixSupervisor = shellQuote(supervisor);
  for (const provider of ["codex", "claude"]) {
    const sh = path.join(binDir, provider);
    fs.writeFileSync(sh, `#!/bin/sh\nexec node ${posixSupervisor} ${provider} \"$@\"\n`, "utf8");
    try { fs.chmodSync(sh, 0o755); } catch {}
    const cmd = path.join(binDir, `${provider}.cmd`);
    fs.writeFileSync(cmd, `@echo off\r\nnode \"${supervisor}\" ${provider} %*\r\n`, "utf8");
  }
}

export function installContextSupervisor({ version = "unknown" } = {}) {
  if (process.env.WEB_KIT_DISABLE_CONTEXT_SUPERVISOR === "1") {
    return { enabled: false, skipped: true, reason: "WEB_KIT_DISABLE_CONTEXT_SUPERVISOR=1" };
  }

  const home = userHome();
  const base = webKitHome();
  const binDir = path.join(base, "bin");
  const runtime = path.join(KIT_ROOT, "pack", "runtime");
  const files = ["context-supervisor.mjs", "provider-bridge.mjs"];
  const missing = files.filter((name) => !fs.existsSync(path.join(runtime, name)));
  if (missing.length) throw new Error(`Context supervisor runtime missing: ${missing.join(", ")}`);

  fs.mkdirSync(base, { recursive: true });
  for (const name of files) copyFile(path.join(runtime, name), path.join(base, name));
  copyFile(__filename, path.join(base, "supervisor-setup.mjs"));
  writeShims(base, binDir);

  const configFile = path.join(base, "config.json");
  const current = readJson(configFile, {});
  const config = {
    ...current,
    schema_version: 1,
    enabled: current.enabled !== false,
    threshold_percent: Number.isFinite(Number(current.threshold_percent)) ? Number(current.threshold_percent) : 50,
    version,
    bin_dir: binDir,
    installed_at: new Date().toISOString(),
  };
  writeJson(configFile, config);

  const posixProfiles = installPosixProfiles(binDir, home);
  const fishProfile = installFishProfile(binDir, home);
  const powerShellProfiles = installPowerShellProfiles(binDir, home);
  const windowsPath = persistWindowsUserPath(binDir);

  return {
    enabled: config.enabled,
    base,
    bin_dir: binDir,
    threshold_percent: config.threshold_percent,
    posix_profiles: posixProfiles,
    fish_profile: fishProfile,
    powershell_profiles: powerShellProfiles,
    windows_user_path_updated: windowsPath,
    restart_shell_required: true,
  };
}

export function contextSupervisorStatus() {
  const base = webKitHome();
  const binDir = path.join(base, "bin");
  const config = readJson(path.join(base, "config.json"), {});
  return {
    installed: fs.existsSync(path.join(base, "context-supervisor.mjs"))
      && fs.existsSync(path.join(base, "provider-bridge.mjs"))
      && (fs.existsSync(path.join(binDir, "codex")) || fs.existsSync(path.join(binDir, "codex.cmd")))
      && (fs.existsSync(path.join(binDir, "claude")) || fs.existsSync(path.join(binDir, "claude.cmd"))),
    enabled: config.enabled !== false,
    threshold_percent: Number(config.threshold_percent || 50),
    base,
    bin_dir: binDir,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const command = process.argv[2] || "install";
  if (command === "status") {
    console.log(JSON.stringify(contextSupervisorStatus(), null, 2));
  } else if (command === "install") {
    console.log(JSON.stringify(installContextSupervisor({ version: process.argv[3] || "manual" }), null, 2));
  } else {
    console.error("Usage: node supervisor-setup.mjs <install|status> [version]");
    process.exitCode = 2;
  }
}
