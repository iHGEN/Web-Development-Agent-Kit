#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commitSha(value, label) {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) || /^0+$/.test(value)) {
    throw new Error(`${label} must be a nonzero full commit SHA.`);
  }
  if (git("rev-parse", "--verify", `${value}^{commit}`) !== value) {
    throw new Error(`${label} must identify the exact commit.`);
  }
  return value;
}

function identity(versionText, packageText, label) {
  const version = versionText.trim();
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
    throw new Error(`${label} VERSION must be a stable semantic version.`);
  }
  const pkg = JSON.parse(packageText);
  if (pkg.name !== "@ihgen/web-kit" || pkg.version !== version) {
    throw new Error(`${label} package identity/version does not match VERSION.`);
  }
  return version;
}

function committedVersion(sha, label) {
  return identity(git("show", `${sha}:VERSION`), git("show", `${sha}:package.json`), label);
}

function compareVersions(candidate, baseline) {
  const left = candidate.split(".").map(BigInt);
  const right = baseline.split(".").map(BigInt);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

try {
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (!["pull_request", "push", "workflow_dispatch"].includes(eventName)) {
    throw new Error(`Unsupported release event: ${eventName || "missing"}.`);
  }
  if (!process.env.GITHUB_EVENT_PATH || !process.env.GITHUB_OUTPUT) {
    throw new Error("GITHUB_EVENT_PATH and GITHUB_OUTPUT are required.");
  }
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("Invalid GitHub event payload.");
  const candidateSha = commitSha(process.env.GITHUB_SHA, "Candidate SHA");
  if (git("rev-parse", "HEAD") !== candidateSha) throw new Error("Checkout HEAD does not match GITHUB_SHA.");
  const version = committedVersion(candidateSha, "Candidate");
  if (identity(fs.readFileSync("VERSION", "utf8"), fs.readFileSync("package.json", "utf8"), "Checkout") !== version) {
    throw new Error("Checkout version differs from the committed candidate.");
  }

  let baselineVersion = null;
  let releaseRequested = true;
  let reason = "Explicit workflow dispatch; existing registry, branch and immutable-tag safeguards still apply.";
  if (eventName !== "workflow_dispatch") {
    const baselineSha = commitSha(eventName === "pull_request" ? event.pull_request?.base?.sha : event.before, "Baseline SHA");
    baselineVersion = committedVersion(baselineSha, "Baseline");
    const comparison = compareVersions(version, baselineVersion);
    if (comparison < 0) throw new Error(`VERSION must not decrease from ${baselineVersion} to ${version}.`);
    releaseRequested = comparison > 0;
    reason = releaseRequested
      ? `VERSION increases from ${baselineVersion} to ${version}.`
      : `VERSION remains ${version}; validate the source change without starting a release.`;
  }

  fs.appendFileSync(process.env.GITHUB_OUTPUT, `release_requested=${releaseRequested}\nversion=${version}\n`);
  console.log(JSON.stringify({ release_requested: releaseRequested, version, baseline_version: baselineVersion, reason }));
} catch (error) {
  console.error(`Release intent validation failed: ${error.message}`);
  process.exitCode = 1;
}
