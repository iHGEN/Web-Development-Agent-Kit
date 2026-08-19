#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.WEB_KIT_TREE_TEST_DIR;
if (!outDir) process.exit(91);
fs.mkdirSync(outDir, { recursive: true });

const leaf = path.join(here, "mock-provider-tree-leaf.mjs");
const child = spawn(process.execPath, [leaf], { stdio: "inherit", env: process.env, windowsHide: true });
fs.writeFileSync(path.join(outDir, "pids.json"), JSON.stringify({ root: process.pid, leaf: child.pid }), "utf8");

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
