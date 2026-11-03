#!/usr/bin/env node
// Source-repository acceptance glue. Portable fixtures never establish native acceptance.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
const safeId = value => typeof value === "string" && /^[a-zA-Z0-9._-]{1,120}$/.test(value) && ![".", ".."].includes(value);
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
export const suites = [
  { id: "proxy", file: "tests/review-sandbox-proxy-smoke.mjs", native: [] },
  { id: "sandbox", file: "tests/review-sandbox-smoke.mjs", native: ["Native read/write, aliases and descendant isolation: PASS", "Real Codex contained app-server startup and unchanged runtime ID: PASS"] },
  { id: "rules", file: "tests/review-rules-isolation-smoke.mjs", native: ["Real Codex allow-rule classification: PASS", "Native allow-rule read/write enforcement through the runner: PASS", "Native unsafe runtime ID guard before provider startup: PASS"] },
  { id: "acceptance", file: "tests/review-isolation-acceptance-smoke.mjs", native: [] },
];

export function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  const result = { portable: false };
  const names = new Map([["--project", "project"], ["--task-id", "taskId"], ["--output", "output"]]);
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    if (seen.has(option)) throw new Error("Duplicate option: " + option);
    seen.add(option);
    if (option === "--portable") { result.portable = true; continue; }
    const name = names.get(option);
    const value = argv[++i];
    if (!name || !value?.trim() || value.startsWith("--") || /[\0\r\n]/.test(value)) throw new Error("Unknown option or missing value: " + option);
    result[name] = value;
  }
  if (result.portable && (result.project || result.taskId)) throw new Error("--portable cannot be combined with --project or --task-id.");
  if (!result.portable && (!result.project || !safeId(result.taskId))) throw new Error("Native acceptance requires --project <installed-target> and a safe --task-id <existing-task>.");
  return result;
}

function nearestRepository(project) {
  let directory = project;
  while (directory) {
    if (fs.existsSync(path.join(directory, ".git"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return project;
}

export function createOutputDirectory(requested, forbiddenRoots = []) {
  if (!requested) {
    const temporary = fs.realpathSync(os.tmpdir());
    if (forbiddenRoots.some(root => inside(root, temporary))) throw new Error("The temporary directory is inside a tested repository; choose --output outside both repositories.");
    return fs.realpathSync(fs.mkdtempSync(path.join(temporary, "web-kit-review-acceptance-")));
  }
  const absolute = path.resolve(requested);
  const directory = path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
  if (forbiddenRoots.some(root => inside(root, directory))) throw new Error("--output must be outside the kit and target repositories, so evidence cannot change the tested source.");
  fs.mkdirSync(directory, { mode: 0o700 }); // Exclusive: an existing directory is never reused.
  return directory;
}

export function runCommand(report, directory, id, command, args, options = {}) {
  const prefix = String(report.commands.length + 1).padStart(2, "0") + "-" + id;
  const started = new Date().toISOString();
  const child = spawnSync(command, args, { cwd: options.cwd || sourceRoot, env: options.env || process.env,
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    timeout: options.timeout || 30000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 });
  const record = { id, command, args, cwd: options.cwd || sourceRoot, started_at: started,
    completed_at: new Date().toISOString(), exit_code: child.status, signal: child.signal,
    error: child.error?.code || null, status: !child.error && child.status === 0 ? "PASS" : "FAIL",
    stdout_file: prefix + ".stdout.log", stderr_file: prefix + ".stderr.log",
    output_complete: !child.error && !child.signal };
  if (options.nativeSuite) record.required_environment = { WEB_KIT_REQUIRE_NATIVE_SANDBOX_TEST: "1" };
  fs.writeFileSync(path.join(directory, record.stdout_file), child.stdout || "", { flag: "wx", mode: 0o600 });
  fs.writeFileSync(path.join(directory, record.stderr_file), child.stderr || "", { flag: "wx", mode: 0o600 });
  report.commands.push(record);
  return { ...record, stdout: child.stdout || "", stderr: child.stderr || "" };
}

function checked(result) {
  if (result.status !== "PASS") throw new Error("Command failed or was unavailable: " + result.id + "; inspect its captured logs.");
  return result.stdout;
}

function sourceSnapshot(run, label) {
  const top = checked(run(label + "-root", "git", ["rev-parse", "--show-toplevel"])).trim();
  if (fs.realpathSync(top) !== fs.realpathSync(sourceRoot)) throw new Error("Run this command from a complete Web Kit source checkout.");
  const [commit, tree] = checked(run(label + "-revision", "git", ["show", "-s", "--format=%H%n%T", "HEAD"])).trim().split("\n");
  const tracked = checked(run(label + "-tree", "git", ["ls-tree", "-r", "-z", "HEAD"])).split("\0").filter(Boolean);
  const status = checked(run(label + "-status", "git", ["status", "--porcelain=v1", "--untracked-files=no"]));
  const digest = crypto.createHash("sha256");
  const changed = [];
  const files = [];
  for (const entry of tracked) {
    const match = /^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (!match) throw new Error("Unsupported tracked source entry; native evidence requires ordinary files.");
    const [, mode, object, relative] = match;
    files.push(relative);
    let bytes;
    try {
      const file = path.join(sourceRoot, relative);
      const stat = fs.lstatSync(file);
      if (mode === "120000" && stat.isSymbolicLink()) bytes = Buffer.from(fs.readlinkSync(file));
      else if (stat.isFile() && mode !== "120000" && stat.size <= 8 * 1024 * 1024) bytes = fs.readFileSync(file);
      else throw new Error("Source file type or size changed.");
      const actual = crypto.createHash(object.length === 64 ? "sha256" : "sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      if (actual !== object || (mode !== "120000" && process.platform !== "win32" && Boolean(stat.mode & 0o111) !== (mode === "100755"))) changed.push(relative);
    } catch { changed.push(relative); bytes = Buffer.from("<missing or unsupported>"); }
    digest.update(relative + "\0").update(bytes).update("\0");
  }
  return { commit, tree, tracked_clean: !status && !changed.length, tracked_status: status,
    changed_files: changed, working_digest: digest.digest("hex"), tracked_files: files.length,
    acceptance_files_tracked: ["scripts/verify-review-isolation.mjs", ...suites.map(s => s.file)].every(file => files.includes(file)) };
}

function safeFile(root, relative) {
  let current = root;
  for (const part of relative.split("/")) {
    if (!part || [".", ".."].includes(part) || part.includes("\\")) throw new Error("Unsafe evidence path.");
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Installed runtime and evidence paths must not traverse symlinks.");
  }
  const stat = fs.statSync(current);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error("Expected a bounded regular file.");
  return current;
}

export function installedManifest(source, project) {
  const runtime = fs.readdirSync(path.join(source, "pack/runtime"));
  if (!runtime.includes("code-review.mjs")) throw new Error("The source runtime is incomplete.");
  const mappings = runtime.map(name => ["pack/runtime/" + name, ".agent-core/bin/" + name]).concat([
    ["pack/agents/code-reviewer.md", ".agent-core/agents/code-reviewer.md"],
    ...["project-paths.mjs", "scope-guard.mjs", "pre-pr-review.md"].map(name => ["pack/rules/" + name, ".agent-core/rules/" + name]),
  ]);
  return mappings.map(([sourcePath, installedPath]) => {
    const sourceHash = hash(fs.readFileSync(safeFile(source, sourcePath)));
    try {
      const installedHash = hash(fs.readFileSync(safeFile(project, installedPath)));
      return { source: sourcePath, installed: installedPath, source_sha256: sourceHash,
        installed_sha256: installedHash, status: sourceHash === installedHash ? "MATCH" : "MISMATCH" };
    } catch { return { source: sourcePath, installed: installedPath, source_sha256: sourceHash, installed_sha256: null, status: "MISSING_OR_UNSAFE" }; }
  });
}

export function nativeEnvironmentProblems(env) {
  return Object.keys(env).filter(name => env[name] && (/^WEB_KIT_TEST_/i.test(name)
    || /^WEB_KIT_CODE_REVIEW_.*(?:_BIN|VERIFIED)$/i.test(name)
    || /^(?:NODE_OPTIONS|NODE_PATH|SANDBOX_EXEC)$/i.test(name)));
}

export function assessSuites(results, native) {
  if (results.length !== suites.length || results.some((result, i) => result.id !== suites[i].id || result.status !== "PASS" || !result.output_complete)) {
    return { status: "FAIL", exit_code: 1, native_acceptance: false, reasons: ["One or more required regression suites failed or did not complete."] };
  }
  const missing = native ? suites.flatMap((suite, i) => suite.native.filter(marker => !results[i].stdout.includes(marker))) : [];
  return missing.length ? { status: "BLOCKED", exit_code: 4, native_acceptance: false, reasons: ["Native/real Codex coverage was not demonstrated: " + missing.join("; ")] }
    : { status: native ? "SUITES_PASS" : "PORTABLE_PASS", exit_code: 0, native_acceptance: false, reasons: [] };
}

export function assertCheckEvidence(job, snapshot) {
  if (job.task_id !== snapshot.task_id || job.status === "DONE" || job.pr_bound !== true) throw new Error("Use an existing active PR-bound task with its original scope.");
  const quality = job.quality;
  if (!quality?.required_checks?.length || !quality.requirements?.length || !Array.isArray(quality.checks)) throw new Error("Existing declared checks and acceptance evidence are required before native acceptance.");
  const latest = new Map(quality.checks.map(check => [check.script, check]));
  const current = check => check?.status === "PASS" && check.exit_code === 0 && check.source_digest === snapshot.source_digest && check.change_digest === snapshot.change_digest;
  for (const definition of quality.required_checks) {
    const record = latest.get(definition.id);
    if (!current(record) || record.definition_digest !== hash(JSON.stringify(definition))) throw new Error("Required check has no current successful execution: " + definition.id);
  }
  if ([...latest.values()].some(check => !current(check))) throw new Error("A recorded check failed or is stale; provide current evidence separately.");
  for (const requirement of quality.requirements) {
    const evidence = requirement.verification;
    if (evidence?.status !== "PASS" || !evidence.evidence?.length || evidence.source_digest !== snapshot.source_digest || evidence.change_digest !== snapshot.change_digest
      || !["manual", "check"].includes(evidence.method) || (evidence.method === "check" && !current(latest.get(evidence.check_script)))) {
      throw new Error("Acceptance requirement has no current passing evidence: " + requirement.id);
    }
  }
}

export function assessReviewEvidence({ result, validation, job, command, previousRuns }) {
  const artifact = validation.envelope;
  const provenance = artifact?.provenance;
  const outer = provenance?.outer_sandbox;
  const run = result?.run_id;
  if (!safeId(run) || previousRuns.includes(run) || result.task_id !== job.task_id || artifact?.task_id !== job.task_id || artifact?.run_id !== run
    || result.report_path !== `.agent-core/state/code-reviews/${job.task_id}/${run}.json`
    || job.quality?.review_attempt?.run_id !== run || job.quality.review_attempt.status !== "COMPLETE"
    || job.quality.code_review?.report_path !== result.report_path || job.quality.code_review.artifact_digest !== validation.digest) throw new Error("Review output is old, superseded, or not tied to this task and its fresh artifact.");
  if (result.provider !== "codex" || provenance?.kind !== "provider-process" || provenance.provider !== "codex" || provenance.fresh_session !== true
    || provenance.read_only !== true || provenance.exit_code !== 0 || !Number.isSafeInteger(provenance.pid) || provenance.pid <= 0
    || !Number.isFinite(Date.parse(provenance.started_at)) || !Number.isFinite(Date.parse(provenance.completed_at))
    || Date.parse(provenance.started_at) < Date.parse(command.started_at) || Date.parse(provenance.completed_at) > Date.parse(command.completed_at)
    || Date.parse(provenance.completed_at) < Date.parse(provenance.started_at)
    || outer?.backend !== "macos-seatbelt" || outer.schema_version !== 1 || outer.verified !== true || outer.protected_filesystem_read_only !== true
    || outer.inherited_by_children !== true || outer.host_socket_probes_denied !== true || outer.network !== "bounded-model-connect-proxy"
    || !/^[a-f0-9]{64}$/.test(outer.profile_sha256 || "")) throw new Error("Fresh real Codex execution with verified native outer-sandbox provenance was not demonstrated.");
  if (command.error || !command.output_complete || ![0, 4].includes(command.exit_code) || !Array.isArray(result.reasons)
    || !["READY TO OPEN PR", "NOT READY", "VERIFICATION BLOCKED"].includes(result.verdict)
    || (result.verdict !== validation.verdict && result.verdict !== "VERIFICATION BLOCKED")
    || result.review_verdict !== validation.verdict || artifact.verdict !== validation.verdict) throw new Error("Review command and validated artifact disagree.");
  const ready = result.verdict === "READY TO OPEN PR" && validation.verdict === "READY TO OPEN PR";
  if (ready && (command.exit_code !== 0 || result.reasons.length || validation.reasons.length || job.quality.code_review.status !== "PASS")) throw new Error("Readiness still has verification gaps or inconsistent evidence.");
  if (!ready && command.exit_code !== 4) throw new Error("A non-ready review must retain its failing exit status.");
  return { acceptable: ready, review_execution: "COMPLETED", target_verdict: result.verdict };
}

function codexOnPath() {
  const shim = path.resolve(process.env.WEB_KIT_HOME || path.join(os.homedir(), ".web-kit"), "bin");
  for (const entry of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    if (path.resolve(entry) === shim) continue;
    try {
      const file = fs.realpathSync(path.join(path.resolve(entry), "codex"));
      fs.accessSync(file, fs.constants.X_OK);
      if (fs.statSync(file).isFile() && !inside(path.join(sourceRoot, "tests/fixtures"), file)) return file;
    } catch { /* Missing PATH candidates are not evidence. */ }
  }
  throw new Error("A real authenticated Codex CLI must be available on PATH.");
}

async function main(argv) {
  let options;
  let directory;
  try {
    options = parseArgs(argv);
    if (options.help) {
      console.log("Usage:\n  node scripts/verify-review-isolation.mjs --project <installed-target> --task-id <existing-task> [--output <new-directory>]\n  node scripts/verify-review-isolation.mjs --portable [--output <new-directory>]\n\nNative acceptance requires macOS, real Codex on PATH, a clean committed source checkout,\nmatching installed runtime and current recorded target checks. It runs the installed\nreviewer once; it does not install/update the target or run its project checks.\nPortable runs the isolation regressions and verifier smoke only; it is not native proof.\nReports and bounded stdout/stderr logs are preserved in an exclusive new directory.\nExit 0: PASS or PORTABLE_PASS; 1: suite failure; 2: invalid arguments/output;\n4: BLOCKED or target NOT_READY. Existing output directories are never overwritten.");
      return 0;
    }
    const excluded = [fs.realpathSync(sourceRoot)];
    if (options.project && fs.existsSync(options.project)) excluded.push(nearestRepository(fs.realpathSync(options.project)));
    directory = createOutputDirectory(options.output, excluded);
  } catch (error) { console.log(JSON.stringify({ status: "INVALID", exit_code: 2, native_acceptance: false, reasons: [error.message] })); return 2; }
  const report = { schema_version: 1, mode: options.portable ? "portable" : "native", status: "BLOCKED", exit_code: 4,
    native_acceptance: false, started_at: new Date().toISOString(), source_root: sourceRoot,
    host: { platform: process.platform, architecture: process.arch, release: os.release(), node: process.version },
    project: options.project ? path.resolve(options.project) : null, task_id: options.taskId || null,
    review_execution: "NOT_RUN", reasons: [], commands: [] };
  const run = (id, command, args, extra) => runCommand(report, directory, id, command,
    command === "git" ? ["-c", "core.fsmonitor=false", ...args] : args, extra);
  let project;
  let codex;
  try {
    report.source_before = sourceSnapshot(run, "source-before");
    let env = { ...process.env, WEB_KIT_REQUIRE_NATIVE_SANDBOX_TEST: options.portable ? "0" : "1" };
    let contract;
    let quality;
    let before;
    const readJob = () => JSON.parse(fs.readFileSync(safeFile(project, `.agent-core/state/jobs/${options.taskId}.json`), "utf8"));
    if (!options.portable) {
      if (process.platform !== "darwin") throw new Error(`Native acceptance requires actual macOS; current platform is ${process.platform}.`);
      const overrides = nativeEnvironmentProblems(process.env);
      if (overrides.length) throw new Error("Native acceptance refuses test/provider/platform overrides: " + overrides.join(", "));
      if (!report.source_before.tracked_clean || !report.source_before.acceptance_files_tracked) throw new Error("Native acceptance requires all tracked kit source, including this verifier and its suites, committed and clean against HEAD.");
      report.host.macos = checked(run("macos-version", "/usr/bin/sw_vers", [])).trim();
      checked(run("node-version", process.execPath, ["--version"]));
      codex = codexOnPath();
      const version = checked(run("codex-version", codex, ["--version"])).trim();
      if (!/^codex-cli \d[^\r\n]*$/.test(version)) throw new Error("The PATH executable did not identify itself as Codex CLI.");
      report.codex = { executable: codex, version, sha256: hash(fs.readFileSync(codex)) };
      const bin = path.join(directory, "codex-path");
      fs.mkdirSync(bin, { mode: 0o700 });
      fs.symlinkSync(codex, path.join(bin, "codex"));
      env.PATH = [bin, ...(process.env.PATH || "").split(path.delimiter).filter(Boolean).map(entry => path.resolve(entry))].join(path.delimiter);
      project = fs.realpathSync(path.resolve(options.project));
      report.project = project;
      report.installed_before = installedManifest(sourceRoot, project);
      if (report.installed_before.some(file => file.status !== "MATCH")) throw new Error("Installed runtime or reviewer instructions differ from this source checkout; see installed_before.");
      contract = await import("../pack/runtime/review-contract.mjs");
      quality = await import("../pack/runtime/quality-pipeline.mjs");
      const job = readJob();
      if (job.task_id !== options.taskId || job.status === "DONE" || job.pr_bound !== true) throw new Error("The requested task must already be active and PR-bound.");
      before = contract.captureReviewSnapshot(project, job, quality.sourceDigest);
      assertCheckEvidence(job, before);
      quality.assertSpecificationReady(job, project);
      report.prerequisites = { status: "PASS", snapshot: before, required_checks: job.quality.required_checks.map(check => check.id) };
    }
    const results = suites.map(suite => run(suite.id, process.execPath, [path.join(sourceRoot, suite.file)], { env, timeout: 300000, nativeSuite: !options.portable }));
    Object.assign(report, assessSuites(results, !options.portable));
    if (report.exit_code === 0 && !options.portable) {
      report.status = "BLOCKED"; report.exit_code = 4;
      report.installed_pre_review = installedManifest(sourceRoot, project);
      if (report.installed_pre_review.some(file => file.status !== "MATCH")) throw new Error("Installed kit changed before target review.");
      const previousJob = readJob();
      const current = contract.captureReviewSnapshot(project, previousJob, quality.sourceDigest);
      if (!contract.sameReviewSnapshot(before, current, true)) throw new Error("Target source or its recorded evidence changed before review.");
      const reviewDirectory = path.join(project, ".agent-core/state/code-reviews", options.taskId);
      const previousRuns = fs.existsSync(reviewDirectory) ? fs.readdirSync(reviewDirectory).map(file => file.replace(/\.json$/, "")) : [];
      if (previousJob.quality.review_attempt?.run_id) previousRuns.push(previousJob.quality.review_attempt.run_id);
      const command = run("target-review", process.execPath, [path.join(project, ".agent-core/bin/code-review.mjs"), "--project", project,
        "--task-id", options.taskId, "--provider", "codex", "--json"], { cwd: project, env: { ...env, WEB_KIT_CODE_REVIEW_CODEX_BIN: codex }, timeout: 240000 });
      report.review_execution = "UNVERIFIED";
      const result = JSON.parse(command.stdout);
      report.target_result = result;
      if (!result.report_path) {
        if (Array.isArray(result.reasons)) report.reasons.push(...result.reasons);
        throw new Error("Target review returned no fresh artifact; its result and logs remain available.");
      }
      const afterJob = readJob();
      const after = contract.captureReviewSnapshot(project, afterJob, quality.sourceDigest);
      if (!contract.sameReviewSnapshot(before, after, true)) throw new Error("Target source or recorded checks changed during review.");
      const validation = contract.validateReviewArtifact(project, result.report_path, afterJob, after, afterJob.quality.code_review?.artifact_digest);
      const bytes = fs.readFileSync(safeFile(project, result.report_path));
      if (hash(bytes) !== validation.digest) throw new Error("Review artifact changed before evidence preservation.");
      fs.writeFileSync(path.join(directory, "review-artifact.json"), bytes, { flag: "wx", mode: 0o600 });
      report.review_artifact = { file: "review-artifact.json", sha256: validation.digest };
      const assessed = assessReviewEvidence({ result, validation, job: afterJob, command, previousRuns });
      Object.assign(report, assessed);
      report.status = assessed.acceptable ? "PASS" : result.verdict === "NOT READY" ? "NOT_READY" : "BLOCKED";
      report.exit_code = assessed.acceptable ? 0 : 4;
      report.native_acceptance = assessed.acceptable;
      report.reasons = [...new Set([...result.reasons, ...validation.reasons])];
    }
  } catch (error) { report.status = "BLOCKED"; report.exit_code = 4; report.native_acceptance = false; report.reasons.push(error.message); }
  finally {
    try {
      report.source_after = sourceSnapshot(run, "source-after");
      report.source_unchanged = report.source_before?.commit === report.source_after.commit && report.source_before?.tree === report.source_after.tree
        && report.source_before?.working_digest === report.source_after.working_digest && report.source_before?.tracked_status === report.source_after.tracked_status;
      if (!report.source_unchanged || (!options.portable && !report.source_after.tracked_clean)) throw new Error("Kit source changed or was not clean through the end of acceptance.");
      if (project && report.installed_before) {
        report.installed_after = installedManifest(sourceRoot, project);
        if (report.installed_after.some(file => file.status !== "MATCH")) throw new Error("Installed kit changed or mismatched during acceptance.");
      }
      if (codex && hash(fs.readFileSync(codex)) !== report.codex.sha256) throw new Error("Codex executable changed during acceptance.");
    } catch (error) { report.status = "BLOCKED"; report.exit_code = 4; report.native_acceptance = false; report.reasons.push(error.message); }
    report.completed_at = new Date().toISOString();
    fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, exit_code: report.exit_code, mode: report.mode, native_acceptance: report.native_acceptance,
      target_verdict: report.target_result?.verdict || null, report_directory: directory, report_path: path.join(directory, "report.json"), reasons: report.reasons }, null, 2));
  }
  return report.exit_code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
