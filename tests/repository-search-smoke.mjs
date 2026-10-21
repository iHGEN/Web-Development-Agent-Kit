#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = path.join(repo, "pack", "runtime", "repository-search.mjs");
const gate = path.join(repo, "pack", "rules", "graphify-refresh.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-search-test-"));
function run(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { cwd: root, encoding: "utf8", windowsHide: true, ...opts });
  assert.equal(r.status, 0, `${bin} ${args.join(" ")} failed:\n${r.stderr || r.stdout || r.error}`);
  return r.stdout.trim();
}
function search(query, type = "auto", opts = {}) {
  return JSON.parse(run(process.execPath, [helper, "--project", root, "--query", query, "--type", type], opts));
}
function git(...args) { return run("git", args); }
function commit(message) { git("add", "-A"); git("commit", "-qm", message); }
const write = (rel, content) => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};

git("init", "-q");
git("config", "user.email", "web-kit-test@example.invalid");
git("config", "user.name", "Web Kit Tests");
write(".gitignore", ".agent-core/\ngraphify-out/\n");
write("src/booking.ts", "export async function sendBookingConfirmation() { return true; }\n");
write("src/payments.ts", "export function chargePayment() { return true; }\n");
write("README.md", "initial documentation\n");
commit("initial files");

const first = search("sendBookingConfirmation", "exact");
assert.equal(first.cached, false);
assert.equal(first.candidates[0].path, "src/booking.ts");
assert.equal(first.candidates[0].symbol, "sendBookingConfirmation");
assert.equal(search("sendBookingConfirmation", "exact").cached, true, "identical source should reuse search result");
assert.equal(search("booking confirmation", "feature").candidates[0].path, "src/booking.ts");
assert.equal(search("Where is sendBookingConfirmation defined?", "auto").candidates[0].path, "src/booking.ts");
assert.equal(search("unrelated missing name", "exact").candidates.length, 0);

write("README.md", "documentation only\n");
commit("update docs");
assert.equal(search("sendBookingConfirmation", "exact").cached, true, "docs-only commit should not invalidate source search");
write("src/booking.ts", "export async function sendCustomerNotice() { return true; }\n");
const updated = search("sendBookingConfirmation", "exact");
assert.equal(updated.cached, false, "uncommitted source edit should invalidate cache");
assert.equal(updated.candidates.length, 0);
assert.equal(search("sendCustomerNotice", "exact").candidates[0].symbol, "sendCustomerNotice");
write("src/new-handler.ts", "export function approveReservation() { return true; }\n");
assert.equal(search("approveReservation", "exact").candidates[0].path, "src/new-handler.ts", "new files must be searchable");

// No shell utilities available: the helper must use its portable Node fallback.
const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-no-cli-"));
const portable = search("customer notice", "feature", { env: { ...process.env, PATH: emptyPath } });
assert.equal(portable.search_engine, "node");
assert.equal(portable.candidates[0].path, "src/booking.ts");

write("graphify-out/graph.json", JSON.stringify({ nodes: [], edges: [] }));
const rel = search("what calls approveReservation", "relationship");
assert.equal(rel.type, "relationship");
assert.equal(rel.graphify, "run-freshness-gate-before-query", "relationship search must not assume graph freshness");
const status = JSON.parse(run(process.execPath, [helper, "--project", root, "--status"]));
assert.ok(status.metrics.cache_hits >= 2);
assert.ok(status.metrics.searches >= 9);

// The graph gate must ignore documentation-only commits, detect source changes,
// and not refresh again when the same source is merely staged or committed.
assert.ok(fs.existsSync(gate), "managed Graphify gate source missing");
const mock = path.join(root, "mock-graphify.mjs");
write("mock-graphify.mjs", `#!/usr/bin/env node\nimport fs from "node:fs";\nif (process.argv[2] === "--version") process.exit(0);\nif (process.argv[2] === "update") { fs.appendFileSync(process.env.WEB_KIT_GRAPHIFY_TEST_LOG, "update\\n"); process.exit(0); }\nprocess.exit(1);\n`);
fs.chmodSync(mock, 0o755);
git("add", "src/booking.ts", "src/new-handler.ts");
commit("update booking logic");
const log = path.join(root, "graphify-refresh-calls.log");
const env = { ...process.env, WEB_KIT_GRAPHIFY_BIN: mock, WEB_KIT_GRAPHIFY_TEST_LOG: log };
function gateCall() { run(process.execPath, [gate, "--project", root, "--task-id", "TEST-SEARCH"], { env }); }
function refreshCount() { return fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split(/\n/).filter(Boolean).length : 0; }
gateCall();
assert.equal(refreshCount(), 1, "initial graph needs exactly one refresh");
gateCall();
assert.equal(refreshCount(), 1, "unchanged source must use clean graph");
write("README.md", "another documentation change\n");
commit("docs-only commit");
gateCall();
assert.equal(refreshCount(), 1, "docs-only HEAD changes must not refresh graph");
write("src/payments.ts", "export function chargePayment() { return false; }\n");
gateCall();
assert.equal(refreshCount(), 2, "uncommitted source change must refresh graph");
gateCall();
assert.equal(refreshCount(), 2, "repeat unchanged source must reuse refreshed graph");
commit("payment logic commit");
gateCall();
assert.equal(refreshCount(), 2, "committing unchanged working source should not refresh graph");

console.log("Repository search and Graphify selective refresh smoke: PASS");
