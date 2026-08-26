#!/usr/bin/env node
import fs from "node:fs";

function replaceExact(file, before, after) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(before)) throw new Error(`${file}: expected patch anchor not found`);
  fs.writeFileSync(file, text.replace(before, after), "utf8");
}

const engine = "pack/runtime/security-review.mjs";
let text = fs.readFileSync(engine, "utf8");
const functionPattern = /function persistScannerArtifacts\(project, runtimeDir, scanners\) \{[\s\S]*?\n\}\n\nfunction providerOverride/;
if (!functionPattern.test(text)) throw new Error("security-review.mjs: persistScannerArtifacts anchor not found");
const immutableFunction = `function persistScannerArtifacts(project, runtimeDir, reviewNumber, scanners) {
  const reviewArtifactDir = path.join(runtimeDir, \`review-\${String(reviewNumber).padStart(3, "0")}\`);
  fs.mkdirSync(reviewArtifactDir, { recursive: true });
  return scanners.map((item) => {
    if (!item.temp_artifact || !fs.existsSync(item.temp_artifact)) {
      const { temp_artifact, ...rest } = item;
      return rest;
    }
    const target = path.join(reviewArtifactDir, \`\${item.name}.json\`);
    fs.copyFileSync(item.temp_artifact, target);
    const bytes = fs.readFileSync(target);
    const { temp_artifact, ...rest } = item;
    return {
      ...rest,
      artifact: posix(path.relative(project, target)),
      artifact_review: reviewNumber,
      artifact_sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      artifact_size: bytes.length,
    };
  });
}

function providerOverride`;
text = text.replace(functionPattern, immutableFunction);
const oldInvocation = "const scanners = persistScannerArtifacts(project, runtimeDir, scannerResults);";
if (!text.includes(oldInvocation)) throw new Error("security-review.mjs: scanner persistence invocation anchor not found");
text = text.replace(oldInvocation, "const scanners = persistScannerArtifacts(project, runtimeDir, reviewNumber, scannerResults);");
fs.writeFileSync(engine, text, "utf8");

const test = "tests/security-review-smoke.mjs";
replaceExact(
  test,
  'function sha(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }',
  'function sha(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }\nfunction fileSha(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }'
);
replaceExact(
  test,
  `assert(scanOnly.scanners.find((s) => s.name === "semgrep")?.status === "FINDINGS", "fake Semgrep finding was not captured");
assert(scanOnly.scanner_finding_count >= 1, "scan-only scanner finding count was not surfaced");
assert(scanOnly.finding_lifecycle_verified === false, "scan-only incorrectly claimed SEC lifecycle verification");`,
  `const firstSemgrep = scanOnly.scanners.find((s) => s.name === "semgrep");
assert(firstSemgrep?.status === "FINDINGS", "fake Semgrep finding was not captured");
assert(scanOnly.scanner_finding_count >= 1, "scan-only scanner finding count was not surfaced");
assert(scanOnly.finding_lifecycle_verified === false, "scan-only incorrectly claimed SEC lifecycle verification");
const firstReviewDir = \`review-\${String(scanOnly.review_number).padStart(3, "0")}\`;
assert(firstSemgrep?.artifact?.includes(\`/runtime/\${firstReviewDir}/semgrep.json\`), "scanner artifact is not review-specific");
assert(firstSemgrep?.artifact_review === scanOnly.review_number, "scanner artifact review provenance is missing");
const firstArtifact = path.resolve(project, ...firstSemgrep.artifact.split("/"));
assert(fs.existsSync(firstArtifact), "review-specific Semgrep artifact was not persisted");
const firstArtifactHash = fileSha(firstArtifact);
assert(firstSemgrep.artifact_sha256 === firstArtifactHash, "scanner artifact SHA-256 does not match persisted evidence");
assert(firstSemgrep.artifact_size === fs.statSync(firstArtifact).size, "scanner artifact size metadata does not match persisted evidence");
const firstHistoryPath = path.join(root, "history", \`review-\${String(scanOnly.review_number).padStart(3, "0")}.json\`);
const firstHistoryBefore = json(firstHistoryPath);
assert(firstHistoryBefore.scanners.find((s) => s.name === "semgrep")?.artifact === firstSemgrep.artifact, "immutable history does not reference its own scanner artifact");`
);
replaceExact(
  test,
  `assert(isolated.scanners.find((s) => s.name === "semgrep")?.status === "PASS", "generated review state was visible to Semgrep and created self-noise");
assert(fs.existsSync(path.join(project, ".agent-core", "security-reviews")), "review state was not restored after scanner isolation");
assert(isolated.decision === "INCONCLUSIVE" && isolated.rating === null, "scanner-isolation scan-only run became merge-approvable");`,
  `const secondSemgrep = isolated.scanners.find((s) => s.name === "semgrep");
assert(secondSemgrep?.status === "PASS", "generated review state was visible to Semgrep and created self-noise");
assert(fs.existsSync(path.join(project, ".agent-core", "security-reviews")), "review state was not restored after scanner isolation");
assert(isolated.decision === "INCONCLUSIVE" && isolated.rating === null, "scanner-isolation scan-only run became merge-approvable");
assert(secondSemgrep?.artifact !== firstSemgrep.artifact, "later review reused the prior scanner artifact path");
assert(secondSemgrep?.artifact_review === isolated.review_number, "later scanner artifact has wrong review provenance");
assert(fs.existsSync(firstArtifact), "review #1 scanner artifact disappeared after review #2");
assert(fileSha(firstArtifact) === firstArtifactHash, "review #1 scanner artifact bytes changed after review #2");
const firstHistoryAfter = json(firstHistoryPath);
const historicalSemgrep = firstHistoryAfter.scanners.find((s) => s.name === "semgrep");
assert(historicalSemgrep?.artifact === firstSemgrep.artifact, "review #1 history artifact path changed after review #2");
assert(historicalSemgrep?.artifact_sha256 === firstArtifactHash, "review #1 history artifact hash changed after review #2");
assert(fileSha(path.resolve(project, ...historicalSemgrep.artifact.split("/"))) === firstArtifactHash, "review #1 history no longer resolves to its original scanner evidence");`
);

const rule = "pack/rules/security-review.md";
replaceExact(
  rule,
  `└── runtime/
    ├── review-context-001.json
    └── scanner evidence`,
  `└── runtime/
    ├── review-context-001.json
    ├── review-001/
    │   ├── semgrep.json
    │   ├── osv-scanner.json
    │   ├── gitleaks.json
    │   └── trivy.json
    ├── review-002/
    │   └── ...
    └── ...`
);
replaceExact(
  rule,
  "Scanner artifacts are first written outside the repository and copied back only after scanning finishes.",
  "Scanner artifacts are first written outside the repository and copied back only after scanning finishes. Each review receives a dedicated `runtime/review-NNN/` evidence directory; historical review JSON never points at a mutable shared scanner filename. Scanner records include the review number, SHA-256 digest, and byte size so persisted evidence can be audited for immutability."
);

console.log("Immutable scanner evidence patch applied.");
