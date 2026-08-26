#!/usr/bin/env node
import fs from "node:fs";

function replaceExact(file, before, after) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(before)) throw new Error(`${file}: expected patch anchor not found`);
  fs.writeFileSync(file, text.replace(before, after), "utf8");
}

function replaceRegex(file, pattern, replacement, label) {
  const text = fs.readFileSync(file, "utf8");
  if (!pattern.test(text)) throw new Error(`${file}: ${label} anchor not found`);
  fs.writeFileSync(file, text.replace(pattern, replacement), "utf8");
}

// 1) Security review runtime: local git exclusion + no raw untracked evidence in worktree.
const engine = "pack/runtime/security-review.mjs";
replaceExact(
  engine,
  'const UNTRACKED_EVIDENCE_BINARY_SAMPLE_BYTES = 8 * 1024;\n',
  'const UNTRACKED_EVIDENCE_BINARY_SAMPLE_BYTES = 8 * 1024;\nconst REVIEW_STATE_GIT_EXCLUDE = "/.agent-core/security-reviews/";\n'
);
replaceExact(
  engine,
  'function gitLines(project, args) { return git(project, args).split(/\\r?\\n/).map((x) => x.trim()).filter(Boolean); }\n',
  `function gitLines(project, args) { return git(project, args).split(/\\r?\\n/).map((x) => x.trim()).filter(Boolean); }\nfunction resolveGitPath(project, name) {\n  const value = git(project, ["rev-parse", "--git-path", name]);\n  if (!value) return null;\n  return path.isAbsolute(value) ? value : path.resolve(project, value);\n}\nfunction ensureReviewStateGitExcluded(project) {\n  const excludeFile = resolveGitPath(project, "info/exclude");\n  if (!excludeFile) throw new Error("Could not resolve .git/info/exclude for security-review state protection.");\n  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });\n  let text = readText(excludeFile, "");\n  const lines = text.split(/\\r?\\n/).map((line) => line.trim());\n  if (!lines.includes(REVIEW_STATE_GIT_EXCLUDE) && !lines.includes(".agent-core/security-reviews/")) {\n    if (text && !text.endsWith("\\n")) text += "\\n";\n    fs.writeFileSync(excludeFile, \`\${text}\${REVIEW_STATE_GIT_EXCLUDE}\\n\`, "utf8");\n  }\n  return true;\n}\n`
);
replaceRegex(
  engine,
  /function untrackedEvidenceSummary\(evidence\) \{[\s\S]*?\n\}\n\nfunction changedFiles/,
  `function untrackedEvidenceSummary(evidence) {\n  return {\n    schema_version: evidence.schema_version,\n    limits: evidence.limits,\n    total_untracked_files: evidence.total_untracked_files,\n    represented_files: evidence.represented_files,\n    omitted_files: evidence.omitted_files,\n    captured_text_bytes: evidence.captured_text_bytes,\n    files: (evidence.files || []).map(({ content, ...metadata }) => metadata),\n  };\n}\nfunction redactSensitiveText(value) {\n  let text = String(value ?? "");\n  text = text.replace(/-----BEGIN [^-\\r\\n]*PRIVATE KEY-----[\\s\\S]*?-----END [^-\\r\\n]*PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]");\n  text = text.replace(/\\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16})\\b/g, "[REDACTED_TOKEN]");\n  text = text.replace(/(\\b(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|client[_-]?secret|access[_-]?key)\\b\\s*[:=]\\s*)(["'\\\`])([^"'\\\`\\r\\n]*)(\\2)/gi, "$1$2[REDACTED]$4");\n  text = text.replace(/(\\b(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|client[_-]?secret|access[_-]?key)\\b\\s*[:=]\\s*)([^\\s#;,]+)/gi, "$1[REDACTED]");\n  return text;\n}\nfunction reviewerUntrackedEvidence(evidence) {\n  return {\n    ...untrackedEvidenceSummary(evidence),\n    retention: "EPHEMERAL_REDACTED_OUTSIDE_WORKTREE",\n    files: (evidence.files || []).map((item) => item.status === "CAPTURED_TEXT"\n      ? { ...item, content: redactSensitiveText(item.content), secret_values_redacted: true }\n      : { ...item }),\n  };\n}\nfunction withEphemeralUntrackedEvidence(evidence, action) {\n  if (!evidence?.total_untracked_files) return action(null);\n  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "web-kit-security-untracked-"));\n  const evidenceFile = path.join(tempRoot, "untracked-evidence.json");\n  try {\n    writeJson(evidenceFile, reviewerUntrackedEvidence(evidence));\n    try { fs.chmodSync(evidenceFile, 0o600); } catch {}\n    return action(evidenceFile);\n  } finally {\n    fs.rmSync(tempRoot, { recursive: true, force: true });\n  }\n}\n\nfunction changedFiles`,
  "untracked evidence summary"
);
replaceExact(
  engine,
  'function reviewerPrompt(contextRel, untrackedEvidenceRel, previousRel) {\n',
  'function reviewerPrompt(contextRel, ephemeralUntrackedEvidenceFile, previousRel) {\n'
);
replaceExact(
  engine,
  '${untrackedEvidenceRel ? `- ${untrackedEvidenceRel} (bounded untracked-file text evidence; inspect CAPTURED_TEXT entries and respect explicit binary/truncation/limit markers)` : ""}\\n',
  '${ephemeralUntrackedEvidenceFile ? `- ${ephemeralUntrackedEvidenceFile} (EPHEMERAL_UNTRACKED_EVIDENCE: redacted bounded untracked-file text outside the worktree; inspect CAPTURED_TEXT entries; this file is deleted after the review)` : ""}\\n'
);
replaceExact(
  engine,
  '  if (git(project, ["rev-parse", "--is-inside-work-tree"]) !== "true") throw new Error("security-review requires a Git repository.");\n\n  const branch =',
  '  if (git(project, ["rev-parse", "--is-inside-work-tree"]) !== "true") throw new Error("security-review requires a Git repository.");\n  ensureReviewStateGitExcluded(project);\n\n  const branch ='
);
replaceExact(
  engine,
  `    const scanners = persistScannerArtifacts(project, runtimeDir, reviewNumber, scannerResults);\n    const untrackedEvidenceFile = untrackedEvidence.total_untracked_files\n      ? path.join(runtimeDir, \`untracked-evidence-\${String(reviewNumber).padStart(3, "0")}.json\`)\n      : null;\n    if (untrackedEvidenceFile) writeJson(untrackedEvidenceFile, untrackedEvidence);\n    const untrackedEvidenceRel = untrackedEvidenceFile ? posix(path.relative(project, untrackedEvidenceFile)) : null;`,
  `    const scanners = persistScannerArtifacts(project, runtimeDir, reviewNumber, scannerResults);\n    const untrackedEvidenceMetadataFile = untrackedEvidence.total_untracked_files\n      ? path.join(runtimeDir, \`untracked-evidence-\${String(reviewNumber).padStart(3, "0")}.json\`)\n      : null;\n    if (untrackedEvidenceMetadataFile) writeJson(untrackedEvidenceMetadataFile, untrackedEvidenceSummary(untrackedEvidence));\n    const untrackedEvidenceMetadataRel = untrackedEvidenceMetadataFile ? posix(path.relative(project, untrackedEvidenceMetadataFile)) : null;`
);
replaceExact(
  engine,
  '      untracked_evidence_file: untrackedEvidenceRel,\n      untracked_evidence_summary: untrackedEvidenceSummary(untrackedEvidence),\n',
  '      untracked_evidence_metadata_file: untrackedEvidenceMetadataRel,\n      untracked_evidence_summary: untrackedEvidenceSummary(untrackedEvidence),\n      untracked_raw_evidence_persisted_in_worktree: false,\n      review_state_git_excluded: true,\n'
);
replaceExact(
  engine,
  '      provider = chooseProvider(args.provider);\n      model = invokeProvider(provider, project, reviewerPrompt(contextRel, untrackedEvidenceRel, previousRel), args.timeoutMs);\n',
  '      provider = chooseProvider(args.provider);\n      model = withEphemeralUntrackedEvidence(untrackedEvidence, (ephemeralUntrackedEvidenceFile) =>\n        invokeProvider(provider, project, reviewerPrompt(contextRel, ephemeralUntrackedEvidenceFile, previousRel), args.timeoutMs));\n'
);
replaceExact(
  engine,
  '      attack_surfaces: surfaces,\n      scan_only: args.scanOnly,\n',
  '      attack_surfaces: surfaces,\n      untracked_evidence_metadata_file: untrackedEvidenceMetadataRel,\n      untracked_raw_evidence_persisted_in_worktree: false,\n      review_state_git_excluded: true,\n      scan_only: args.scanOnly,\n'
);

// 2) Installer/update: protect generated state through local Git exclude.
const installer = "scripts/agent-kit.mjs";
replaceExact(
  installer,
  'const IGNORE_DIRS = new Set([\n',
  'const SECURITY_REVIEW_STATE_EXCLUDE = "/.agent-core/security-reviews/";\nconst IGNORE_DIRS = new Set([\n'
);
replaceExact(
  installer,
  'function posix(value) { return value.split(path.sep).join("/"); }\n',
  `function posix(value) { return value.split(path.sep).join("/"); }\nfunction ensureSecurityReviewStateExcluded(project) {\n  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: project, encoding: "utf8", windowsHide: true });\n  if (inside.error || inside.status !== 0 || String(inside.stdout || "").trim() !== "true") return false;\n  const gitPath = spawnSync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: project, encoding: "utf8", windowsHide: true });\n  if (gitPath.error || gitPath.status !== 0) return false;\n  const value = String(gitPath.stdout || "").trim();\n  if (!value) return false;\n  const excludeFile = path.isAbsolute(value) ? value : path.resolve(project, value);\n  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });\n  let text = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, "utf8") : "";\n  const lines = text.split(/\\r?\\n/).map((line) => line.trim());\n  if (!lines.includes(SECURITY_REVIEW_STATE_EXCLUDE) && !lines.includes(".agent-core/security-reviews/")) {\n    if (text && !text.endsWith("\\n")) text += "\\n";\n    fs.writeFileSync(excludeFile, \`\${text}\${SECURITY_REVIEW_STATE_EXCLUDE}\\n\`, "utf8");\n  }\n  return true;\n}\n`
);
replaceExact(
  installer,
  '  const { skills, evidence } = detect(project);\n  const core = path.join(project, ".agent-core");\n',
  '  const { skills, evidence } = detect(project);\n  const securityReviewStateExcluded = ensureSecurityReviewStateExcluded(project);\n  const core = path.join(project, ".agent-core");\n'
);
replaceExact(
  installer,
  '  console.log("Automatic context rollover: .agent-core/bin/session-controller.mjs (default threshold 50%)");\n',
  '  console.log("Automatic context rollover: .agent-core/bin/session-controller.mjs (default threshold 50%)");\n  console.log(`Security review state: ${securityReviewStateExcluded ? "protected by local .git/info/exclude" : "Git local exclude will be enforced when security-review runs"}`);\n'
);

// 3) Mock reviewer: prove ephemeral evidence exists during review, is redacted, then let caller verify cleanup.
const mock = "tests/fixtures/mock-security-provider.mjs";
replaceExact(
  mock,
  'const args = process.argv.slice(2);\nconst source =',
  `const args = process.argv.slice(2);\nif (process.env.WEB_KIT_TEST_REQUIRE_UNTRACKED_EVIDENCE === "1") {\n  const prompt = args[0] === "exec" ? String(args.at(-1) || "") : String(args[args.indexOf("-p") + 1] || "");\n  const match = prompt.match(/- (.+?) \\(EPHEMERAL_UNTRACKED_EVIDENCE:/);\n  if (!match) { console.error("ephemeral untracked evidence path missing from reviewer prompt"); process.exit(5); }\n  const evidenceFile = match[1];\n  if (!fs.existsSync(evidenceFile)) { console.error("ephemeral untracked evidence file missing during provider review"); process.exit(6); }\n  const evidenceText = fs.readFileSync(evidenceFile, "utf8");\n  if (!evidenceText.includes("eval(input)")) { console.error("ephemeral evidence omitted generic untracked source content"); process.exit(7); }\n  const sentinel = process.env.WEB_KIT_TEST_SECRET_SENTINEL || "";\n  if (sentinel && evidenceText.includes(sentinel)) { console.error("secret sentinel leaked into reviewer evidence without redaction"); process.exit(8); }\n  const auditFile = process.env.WEB_KIT_TEST_UNTRACKED_AUDIT_FILE;\n  if (auditFile) fs.writeFileSync(auditFile, evidenceFile, "utf8");\n}\nconst source =`
);

// 4) Regression tests: local exclude + no secret residue + ephemeral cleanup.
const test = "tests/security-review-smoke.mjs";
replaceExact(
  test,
  'function assert(value, message) { if (!value) throw new Error(message); }\n',
  `function assert(value, message) { if (!value) throw new Error(message); }\nfunction treeContains(root, needle) {\n  if (!fs.existsSync(root)) return false;\n  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {\n    const full = path.join(root, entry.name);\n    if (entry.isDirectory()) { if (treeContains(full, needle)) return true; }\n    else if (entry.isFile()) {\n      try { if (fs.readFileSync(full, "utf8").includes(needle)) return true; } catch {}\n    }\n  }\n  return false;\n}\n`
);
replaceExact(
  test,
  'assert(fs.existsSync(path.join(project, ".agent-core", "rules", "security-review.md")), "security review rule was not installed");\n',
  `assert(fs.existsSync(path.join(project, ".agent-core", "rules", "security-review.md")), "security review rule was not installed");\nconst gitExcludeValue = run("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: project }).stdout.trim();\nconst gitExcludeFile = path.isAbsolute(gitExcludeValue) ? gitExcludeValue : path.resolve(project, gitExcludeValue);\nassert(fs.readFileSync(gitExcludeFile, "utf8").split(/\\r?\\n/).map((line) => line.trim()).includes("/.agent-core/security-reviews/"), "installer did not protect security review state with .git/info/exclude");\n`
);
replaceExact(
  test,
  'fs.writeFileSync(path.join(project, "src", "large.txt"), "A".repeat(70 * 1024));\n',
  'fs.writeFileSync(path.join(project, "src", "large.txt"), "A".repeat(70 * 1024));\nconst secretSentinel = "WEB_KIT_TEST_SECRET_RESIDUE_8f9c2a";\nfs.writeFileSync(path.join(project, "src", "credentials.local"), `password="${secretSentinel}"\\n`);\n'
);
replaceRegex(
  test,
  /const untrackedContext = json\(path\.join\(untrackedRoot, "runtime", "review-context-001\.json"\)\);[\s\S]*?assert\(untrackedContext\.untracked_evidence_summary\.files\.every\(\(item\) => !\("content" in item\)\), "review context summary duplicated raw untracked content instead of referencing the bounded evidence file"\);/,
  `const untrackedContext = json(path.join(untrackedRoot, "runtime", "review-context-001.json"));\nassert(untrackedContext.untracked_evidence_metadata_file, "untracked evidence metadata file was not recorded in review context");\nassert(untrackedContext.untracked_raw_evidence_persisted_in_worktree === false, "review context claims raw untracked evidence is persisted in the worktree");\nassert(untrackedContext.review_state_git_excluded === true, "review context did not record local Git protection for generated state");\nconst untrackedMetadata = json(path.resolve(project, ...untrackedContext.untracked_evidence_metadata_file.split("/")));\nconst genericEntry = untrackedMetadata.files.find((item) => item.path === "src/new.js");\nconst binaryEntry = untrackedMetadata.files.find((item) => item.path === "src/blob.bin");\nconst largeEntry = untrackedMetadata.files.find((item) => item.path === "src/large.txt");\nassert(genericEntry?.status === "CAPTURED_TEXT" && !("content" in genericEntry), "worktree metadata persisted raw generic untracked content");\nassert(binaryEntry?.status === "SKIPPED_BINARY" && !("content" in binaryEntry), "binary untracked file was not safely excluded from text evidence");\nassert(largeEntry?.status === "CAPTURED_TEXT" && largeEntry.truncated === true, "large untracked text file was not bounded/truncated");\nassert(largeEntry.captured_bytes <= untrackedMetadata.limits.max_bytes_per_file, "per-file untracked evidence byte limit was exceeded");\nassert(untrackedMetadata.captured_text_bytes <= untrackedMetadata.limits.max_total_bytes, "total untracked evidence byte limit was exceeded");\nassert(untrackedContext.untracked_evidence_summary.files.every((item) => !("content" in item)), "review context summary duplicated raw untracked content");\nassert(!treeContains(untrackedRoot, secretSentinel), "secret sentinel persisted inside generated security review state");\n\nconst ephemeralAuditFile = path.join(tempRoot, "ephemeral-untracked-evidence-path.txt");\nconst fullUntrackedEnv = {\n  ...baseEnv,\n  WEB_KIT_TEST_REQUIRE_UNTRACKED_EVIDENCE: "1",\n  WEB_KIT_TEST_SECRET_SENTINEL: secretSentinel,\n  WEB_KIT_TEST_UNTRACKED_AUDIT_FILE: ephemeralAuditFile,\n};\nrun(process.execPath, [engine, "--project", project, "--base", "main", "--provider", "codex", "--no-scanners"], { cwd: project, env: fullUntrackedEnv });\nassert(fs.existsSync(ephemeralAuditFile), "mock reviewer did not observe ephemeral untracked evidence");\nconst ephemeralEvidenceFile = fs.readFileSync(ephemeralAuditFile, "utf8").trim();\nassert(ephemeralEvidenceFile && !fs.existsSync(ephemeralEvidenceFile), "ephemeral untracked evidence was not deleted after provider review");\nassert(!treeContains(untrackedRoot, secretSentinel), "secret sentinel remained in worktree review state after full review");\n\nfs.rmSync(path.join(project, "src", "credentials.local"), { force: true });\nrun("git", ["add", "."], { cwd: project });\nconst stagedAfterSecurityReview = run("git", ["diff", "--cached", "--name-only"], { cwd: project }).stdout.split(/\\r?\\n/).filter(Boolean);\nassert(!stagedAfterSecurityReview.some((file) => file.replace(/\\\\/g, "/").startsWith(".agent-core/security-reviews/")), "normal git add . staged generated security review state");\nassert(!treeContains(untrackedRoot, secretSentinel), "removing the original credential left a generated secret residue in the worktree");`,
  "untracked residue regression"
);

// 5) Documentation contract.
const rule = "pack/rules/security-review.md";
replaceExact(
  rule,
  'Captured untracked text is appended to the internal `diffText()` evidence consumed by `attackSurface()`. The same bounded evidence is persisted as `runtime/untracked-evidence-NNN.json`, referenced from `review-context-NNN.json`, and included in the full reviewer\'s required read-first list. The context summary contains metadata only and does not duplicate raw captured content.\n',
  'Captured untracked text is appended to the internal `diffText()` evidence consumed by `attackSurface()`, but **raw untracked text is never persisted inside the project worktree**. `runtime/untracked-evidence-NNN.json` stores metadata only. For a full AI review, Web Kit creates a redacted, permission-restricted ephemeral evidence file outside the worktree, gives that path to the isolated reviewer, and deletes the file immediately after the provider returns.\n\nInstall/update adds `/.agent-core/security-reviews/` to the repository-local `.git/info/exclude` when Git is available, and `security-review` enforces the same protection on every run. This is local-only protection and does not modify the project-owned `.gitignore`. A normal `git add .` must not stage generated security-review state.\n'
);

console.log("Security review residue fix applied.");
