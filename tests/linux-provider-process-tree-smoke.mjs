#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") {
  console.log(`Linux provider process-tree smoke: SKIP (${process.platform})`);
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const wrapper = path.join(repo, "pack", "runtime", "provider-process-wrapper.mjs");
const rootFixture = path.join(repo, "tests", "fixtures", "mock-provider-tree-root.mjs");
const state = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-linux-tree-"));

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}
function assert(value, message) { if (!value) throw new Error(message); }

const child = spawn(process.execPath, [wrapper], {
  env: {
    ...process.env,
    WEB_KIT_PROVIDER_WRAPPER_NAME: "codex",
    WEB_KIT_PROVIDER_WRAPPER_TARGET: rootFixture,
    WEB_KIT_TREE_TEST_DIR: state,
  },
  stdio: "ignore",
  windowsHide: true,
});

const pidFile = path.join(state, "pids.json");
for (let i = 0; i < 100 && !fs.existsSync(pidFile); i += 1) await sleep(50);
assert(fs.existsSync(pidFile), "provider tree fixture did not start");
const pids = JSON.parse(fs.readFileSync(pidFile, "utf8"));
assert(alive(pids.root), "provider root is not alive before shutdown");
assert(alive(pids.leaf), "provider descendant is not alive before shutdown");

process.kill(child.pid, "SIGTERM");
const closed = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 8000);
  child.once("close", () => { clearTimeout(timer); resolve(true); });
});
assert(closed, "Linux provider wrapper did not exit after rollover shutdown");

for (let i = 0; i < 30 && (alive(pids.root) || alive(pids.leaf)); i += 1) await sleep(100);
assert(!alive(pids.root), `provider root ${pids.root} survived wrapper shutdown`);
assert(!alive(pids.leaf), `provider descendant ${pids.leaf} survived wrapper shutdown`);

console.log("Linux provider process-tree smoke: PASS");
