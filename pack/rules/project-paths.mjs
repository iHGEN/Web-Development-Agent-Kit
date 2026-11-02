// Keep task state local to an installed project while Git evidence spans the
// complete repository. Canonical paths also account for macOS temp aliases and
// Windows drive casing/separators.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const realpath = fs.realpathSync.native;

export function sameDirectory(a, b) {
  const canonical = value => {
    const result = realpath(value);
    return process.platform === "win32" ? result.toLowerCase() : result;
  };
  return canonical(a) === canonical(b);
}

export function repositoryContext(project) {
  const projectRoot = realpath(path.resolve(project));
  if (!fs.statSync(projectRoot).isDirectory()) throw new Error("--project must name a directory.");
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: projectRoot, encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error("Cannot resolve the project's Git repository: " + (result.error?.message || result.stderr?.trim() || "Git returned no root."));
  }
  const repositoryRoot = realpath(result.stdout.replace(/\r?\n$/, ""));
  const relative = path.relative(repositoryRoot, projectRoot);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) {
    throw new Error("The project must be within its Git repository.");
  }
  const projectPrefix = relative.split(path.sep).join("/");
  return {
    projectRoot, repositoryRoot, projectPrefix,
    statePrefix: (projectPrefix ? projectPrefix + "/" : "") + ".agent-core/state/",
  };
}
