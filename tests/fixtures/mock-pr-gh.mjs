#!/usr/bin/env node
// A harmless gh stand-in: writes the invocation and emits a synthetic URL.
import fs from "node:fs";
const args = process.argv.slice(2);
if (args[0] !== "pr" || args[1] !== "create" || !args.includes("--head") || !args.includes("--base")) process.exit(6);
if (process.env.WEB_KIT_REVIEW_TEST_CAPTURE) {
  fs.writeFileSync(process.env.WEB_KIT_REVIEW_TEST_CAPTURE, JSON.stringify({ args, cwd: process.cwd() }));
}
console.log("https://github.com/fixture/project/pull/123");
