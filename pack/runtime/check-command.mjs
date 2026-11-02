// Resolve external checks without converting their argv into shell source.
import fs from "node:fs";
import path from "node:path";

const win = path.win32;
const MAX_SHIM_BYTES = 64 * 1024;
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

function environmentValue(env, name) {
  // Match Node's case-insensitive, first-lexicographic-key Windows environment.
  const key = Object.keys(env).sort().find(key => key.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

function fileStat(file, fileSystem) {
  try {
    const stat = fileSystem.statSync(file);
    return stat.isFile() ? stat : null;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

function findWindowsCommand(command, cwd, env, fileSystem) {
  const explicit = /[\\/]/.test(command) || /^[a-z]:/i.test(command);
  const extensions = String(environmentValue(env, "PATHEXT") ?? DEFAULT_PATHEXT)
    .split(";").filter(ext => /^\.[a-z0-9]+$/i.test(ext));
  // An extensionless sibling is usually npm's POSIX shell wrapper. Windows
  // command lookup must select the PATHEXT candidate, not that shell file.
  const names = win.extname(command) ? [command] : extensions.map(ext => command + ext);
  const dirs = explicit ? [cwd] : [cwd, ...String(environmentValue(env, "PATH") ?? "")
    .split(";").map(dir => dir.replace(/^"(.*)"$/, "$1"))];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = win.resolve(cwd, dir, name);
      if (fileStat(candidate, fileSystem)) return candidate;
    }
  }
  return null;
}

function unsupportedBatch(file, reason) {
  const error = new Error(`Cannot launch Windows check ${JSON.stringify(file)}: ${reason}. `
    + "Automatic batch dispatch supports only unmodified npm Node cmd-shims without interpreter flags or environment assignments. "
    + "Register node.exe with the actual JavaScript entry point as the first --arg, or register an explicit interpreter and its documented arguments for a custom .cmd/.bat script.");
  error.code = "UNSUPPORTED_CHECK_BATCH";
  return error;
}

function npmNodeTarget(body) {
  // Whole-body matching is intentional: extracting the last quoted .js path
  // would silently discard setup commands, fixed arguments, or another branch.
  // Shapes: npm/cmd-shim v8.0.0 and v9.0.2 lib/index.js (also earlier releases
  // emitting the identical v8 shape). No batch instructions are evaluated.
  const normalized = body.replace(/\r\n/g, "\n");
  const match = normalized.match(/"%_prog%"  "%dp0%\\([^"\r\n]+)" %\*\n?$/);
  if (!match) return null;
  const target = match[1];
  const head = "@ECHO off\nGOTO start\n:find_dp0\nSET dp0=%~dp0\nEXIT /b\n:start\nSETLOCAL\nCALL :find_dp0\n\n"
    + 'IF EXIST "%dp0%\\node.exe" (\n  SET "_prog=%dp0%\\node.exe"\n) ELSE (\n  SET "_prog=node"\n';
  const tail = 'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & ';
  const invocation = `"%_prog%"  "%dp0%\\${target}" %*`;
  const oldShape = head + "  SET PATHEXT=%PATHEXT:;.JS;=;%\n)\n\n" + tail + invocation;
  const newShape = head + ")\n\n" + tail + "set PATHEXT=%PATHEXT:;.JS;=;% & " + invocation;
  const withoutFinalNewline = normalized.replace(/\n$/, "");
  return withoutFinalNewline === oldShape || withoutFinalNewline === newShape ? target : null;
}

/** Plan an external check launch. npm package.json scripts use their existing path.
 * fileSystem/platform allow deterministic Windows resolution tests on any host.
 */
export function resolveCheckCommand(command, args, {
  cwd = process.cwd(), env = process.env, platform = process.platform, fileSystem = fs,
} = {}) {
  if (typeof command !== "string" || !command || /[\0\r\n]/.test(command)
    || !Array.isArray(args) || args.some(value => typeof value !== "string" || value.includes("\0"))) {
    throw new Error("External checks require an executable name and literal string arguments without NUL characters.");
  }
  const direct = { command, args: [...args], shell: false };
  if (platform !== "win32") return direct;
  if (command.includes('"') || /^[a-z]:(?![\\/])/i.test(command)) {
    throw new Error("Use an unquoted Windows executable path, absolute or relative to the project; drive-relative paths are unsupported.");
  }
  // Native executables need no shim handling; retain Node's own search behavior.
  if (/\.(?:exe|com)$/i.test(command)) return direct;
  const file = findWindowsCommand(command, cwd, env, fileSystem);
  if (!file) {
    const error = new Error(`Windows check command ${JSON.stringify(command)} was not found in the project directory or PATH. Register an existing executable or an explicit interpreter.`);
    error.code = "CHECK_COMMAND_NOT_FOUND";
    throw error;
  }
  if (!/\.(?:cmd|bat)$/i.test(file)) return { ...direct, command: file };
  if (!/\.cmd$/i.test(file)) throw unsupportedBatch(file, "custom .bat scripts require an explicit interpreter");
  const stat = fileStat(file, fileSystem);
  if (!stat || stat.size > MAX_SHIM_BYTES) throw unsupportedBatch(file, "the wrapper is missing or exceeds 64 KiB");
  const target = npmNodeTarget(fileSystem.readFileSync(file, "utf8"));
  if (!target) throw unsupportedBatch(file, "the wrapper is not a recognized complete npm Node shim");
  if (win.isAbsolute(target) || /[:%"<>|?*\0\r\n]/.test(target)) {
    throw unsupportedBatch(file, "the shim target must be a literal relative path without batch variable expansion");
  }
  const entry = win.resolve(win.dirname(file), target);
  if (!fileStat(entry, fileSystem)) throw unsupportedBatch(file, "the shim's JavaScript entry point is missing or is not a file");
  const siblingNode = win.join(win.dirname(file), "node.exe");
  const node = fileStat(siblingNode, fileSystem) ? siblingNode
    : findWindowsCommand("node.exe", cwd, env, fileSystem);
  if (!node) throw unsupportedBatch(file, "node.exe is missing beside the shim and from PATH");
  return { command: node, args: [entry, ...args], shell: false };
}
