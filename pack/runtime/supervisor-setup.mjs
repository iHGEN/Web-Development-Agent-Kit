#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const START = "# >>> ihgen-web-kit-context-supervisor >>>";
const END = "# <<< ihgen-web-kit-context-supervisor <<<";

function userHome() { return path.resolve(process.env.WEB_KIT_USER_HOME || os.homedir()); }
function webKitHome() { return path.resolve(process.env.WEB_KIT_HOME || path.join(userHome(), ".web-kit")); }
function readJson(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  if (process.platform !== "win32") { try { fs.chmodSync(dst, 0o755); } catch {} }
}
function shellQuote(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'`; }
function normalizedPath(value) {
  const text = String(value || "").replace(/^"|"$/g, "");
  if (!text) return "";
  let resolved;
  try { resolved = path.resolve(text); } catch { resolved = text; }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function replaceMarked(text, block) {
  const start = text.indexOf(START);
  if (start < 0) return `${text}${text && !text.endsWith("\n") ? "\n" : ""}\n${block}\n`;
  const end = text.indexOf(END, start);
  if (end < 0) return `${text}${text && !text.endsWith("\n") ? "\n" : ""}\n${block}\n`;
  return text.slice(0, start) + block + text.slice(end + END.length);
}
function writeProfile(file, block) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const next = replaceMarked(current, block);
    if (next !== current) fs.writeFileSync(file, next, "utf8");
    return true;
  } catch { return false; }
}

function writeShims(base, binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const supervisor = path.join(base, "context-supervisor.mjs");
  const processWrapper = path.join(base, "provider-process-wrapper.mjs");
  for (const provider of ["codex", "claude"]) {
    const sh = path.join(binDir, provider);
    if (process.platform === "linux") {
      const realVar = provider === "codex" ? "WEB_KIT_REAL_CODEX_BIN" : "WEB_KIT_REAL_CLAUDE_BIN";
      fs.writeFileSync(sh, `#!/bin/sh\nif [ -n \"\${${realVar}:-}\" ]; then\n  export WEB_KIT_PROVIDER_WRAPPER_TARGET=\"\$${realVar}\"\nelse\n  unset WEB_KIT_PROVIDER_WRAPPER_TARGET\nfi\nexport WEB_KIT_PROVIDER_WRAPPER_NAME=${provider}\nexport ${realVar}=${shellQuote(processWrapper)}\nexec node ${shellQuote(supervisor)} ${provider} \"$@\"\n`, "utf8");
    } else {
      fs.writeFileSync(sh, `#!/bin/sh\nexec node ${shellQuote(supervisor)} ${provider} \"$@\"\n`, "utf8");
    }
    try { fs.chmodSync(sh, 0o755); } catch {}
    fs.writeFileSync(path.join(binDir, `${provider}.cmd`), `@echo off\r\nnode \"${supervisor}\" ${provider} %*\r\n`, "utf8");
  }
}

function installProfiles(binDir, home) {
  if (process.env.WEB_KIT_DISABLE_SHELL_PROFILE === "1") return [];
  const written = [];
  const posixBlock = `${START}\n# Added by iHGEN Web Kit. Transparent only inside projects containing .agent-kit.json.\n# Keep Web Kit first even when another profile already placed it later in PATH.\n__ihgen_web_kit_bin=${shellQuote(binDir)}\ncase "$PATH" in\n  "$__ihgen_web_kit_bin"|"$__ihgen_web_kit_bin":*) ;;\n  *) export PATH="$__ihgen_web_kit_bin:$PATH" ;;\nesac\nunset __ihgen_web_kit_bin\n${END}`;
  const profiles = new Set([path.join(home, ".bashrc"), path.join(home, ".zshrc"), path.join(home, ".profile")]);
  if (process.platform === "darwin") profiles.add(path.join(home, ".zprofile"));
  if (process.platform === "win32" && (process.env.MSYSTEM || process.env.SHELL?.includes("bash"))) profiles.add(path.join(home, ".bash_profile"));
  for (const file of profiles) if (writeProfile(file, posixBlock)) written.push(file);

  try {
    const fish = path.join(home, ".config", "fish", "conf.d", "ihgen-web-kit.fish");
    fs.mkdirSync(path.dirname(fish), { recursive: true });
    fs.writeFileSync(fish, `# iHGEN Web Kit transparent context supervisor\nif test \"$PATH[1]\" != ${JSON.stringify(binDir)}\n    set -gx PATH ${JSON.stringify(binDir)} $PATH\nend\n`, "utf8");
    written.push(fish);
  } catch {}

  if (process.platform === "win32") {
    const escaped = binDir.replace(/'/g, "''");
    const psBlock = `${START}\n$__ihgenWebKitBin = '${escaped}'\n$__ihgenWebKitRest = @($env:Path -split ';' | Where-Object { $_ -and ($_ -ne $__ihgenWebKitBin) })\n$env:Path = (($__ihgenWebKitBin) + ';' + ($__ihgenWebKitRest -join ';')).TrimEnd(';')\nRemove-Variable __ihgenWebKitRest -ErrorAction SilentlyContinue\nRemove-Variable __ihgenWebKitBin -ErrorAction SilentlyContinue\n${END}`;
    for (const file of [
      path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
      path.join(home, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
    ]) if (writeProfile(file, psBlock)) written.push(file);
  }
  return written;
}

function persistWindowsPath(binDir) {
  if (process.platform !== "win32" || process.env.WEB_KIT_DISABLE_SHELL_PROFILE === "1") return false;
  const shell = ["pwsh.exe", "powershell.exe"].find((candidate) => {
    const result = spawnSync("where.exe", [candidate], { stdio: "ignore", windowsHide: true });
    return !result.error && result.status === 0;
  });
  if (!shell) return false;
  const script = `$bin=${JSON.stringify(binDir)};$p=[Environment]::GetEnvironmentVariable('Path','User');$parts=@($p -split ';'|?{$_ -and $_ -ne $bin});[Environment]::SetEnvironmentVariable('Path',(($bin)+';'+($parts -join ';')).TrimEnd(';'),'User')`;
  const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore", windowsHide: true });
  return !result.error && result.status === 0;
}

function install(version) {
  if (process.env.WEB_KIT_DISABLE_CONTEXT_SUPERVISOR === "1") return { enabled: false, skipped: true };
  const home = userHome();
  const base = webKitHome();
  const binDir = path.join(base, "bin");
  const required = ["context-supervisor.mjs", "provider-bridge.mjs", "provider-process-wrapper.mjs"];
  for (const name of required) if (!fs.existsSync(path.join(here, name))) throw new Error(`Installed Web Kit runtime missing ${name}`);
  fs.mkdirSync(base, { recursive: true });
  for (const name of required) copyFile(path.join(here, name), path.join(base, name));
  copyFile(path.join(here, "supervisor-setup.mjs"), path.join(base, "supervisor-setup.mjs"));
  writeShims(base, binDir);
  const configFile = path.join(base, "config.json");
  const old = readJson(configFile, {});
  const config = {
    ...old,
    schema_version: 1,
    enabled: old.enabled !== false,
    threshold_percent: Number.isFinite(Number(old.threshold_percent)) ? Number(old.threshold_percent) : 50,
    version,
    bin_dir: binDir,
    linux_process_tree_wrapper: process.platform === "linux",
    installed_at: new Date().toISOString(),
  };
  writeJson(configFile, config);
  const profiles = installProfiles(binDir, home);
  const windowsPath = persistWindowsPath(binDir);
  return {
    enabled: config.enabled,
    base,
    bin_dir: binDir,
    threshold_percent: config.threshold_percent,
    linux_process_tree_wrapper: config.linux_process_tree_wrapper,
    profiles,
    windows_user_path_updated: windowsPath,
    restart_shell_required: true,
  };
}

function status() {
  const base = webKitHome();
  const binDir = path.join(base, "bin");
  const config = readJson(path.join(base, "config.json"), {});
  const shims = ["codex", "claude"].map((provider) => process.platform === "win32" ? path.join(binDir, `${provider}.cmd`) : path.join(binDir, provider));
  const wanted = normalizedPath(binDir);
  const pathEntries = String(process.env.PATH || "").split(path.delimiter).filter(Boolean).map(normalizedPath);
  const pathIndex = pathEntries.findIndex((entry) => entry === wanted);
  const processWrapperInstalled = fs.existsSync(path.join(base, "provider-process-wrapper.mjs"));
  return {
    installed: fs.existsSync(path.join(base, "context-supervisor.mjs"))
      && fs.existsSync(path.join(base, "provider-bridge.mjs"))
      && processWrapperInstalled
      && shims.every((file) => fs.existsSync(file)),
    enabled: config.enabled !== false,
    threshold_percent: Number(config.threshold_percent || 50),
    base,
    bin_dir: binDir,
    path_present: pathIndex >= 0,
    path_index: pathIndex,
    path_preferred: pathIndex === 0,
    linux_process_tree_wrapper: process.platform === "linux" && processWrapperInstalled,
  };
}

const command = process.argv[2] || "install";
if (command === "install") console.log(JSON.stringify(install(process.argv[3] || "unknown"), null, 2));
else if (command === "status") console.log(JSON.stringify(status(), null, 2));
else { console.error("Usage: supervisor-setup.mjs <install|status> [version]"); process.exitCode = 2; }
