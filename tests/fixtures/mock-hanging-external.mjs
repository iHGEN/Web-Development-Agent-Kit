#!/usr/bin/env node
// Git/gh executable replacement: forward normal Git invocations and hang on
// the requested operation to verify the bounded synchronous-command runner.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const mode = process.env.WEB_KIT_REVIEW_TEST_HANG_EXTERNAL;
if ((mode === "git" && args.includes("fetch"))
  || (mode === "gh" && args[0] === "pr" && args[1] === "create")) {
  setInterval(() => {}, 1000);
} else if (mode === "git") {
  const result = spawnSync("git", args, { cwd: process.cwd(), env: process.env,
    encoding: "utf8", timeout: 15000, windowsHide: true });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
} else {
  process.exit(8);
}
