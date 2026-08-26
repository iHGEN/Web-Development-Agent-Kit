# Web Kit Security PR Review

## Purpose

`security-review` is an independent, read-only PR-style security review of the current branch against its base branch. It is designed to find **all security issues relevant to the changed attack surface**, not merely run a fixed OWASP checklist.

The review must never claim that all vulnerabilities are impossible or that a 5/5 score guarantees safety. The goal is broad, systematic, evidence-backed review with persistent findings and explicit coverage.

## Universal triggers

From a terminal:

```bash
npx @ihgen/web-kit security-review
```

Inside any AI provider that can follow project instructions and execute local tools:

```text
run security-review
```

Optional provider-neutral forms:

```text
run security-review deep
run security-review base develop
run security-review provider gemini
```

These map to the same `.agent-core/bin/security-review.mjs` engine. If an AI client cannot execute local commands, it must tell the user to use the terminal command rather than pretending the review ran.

## Core review model

1. Detect the current branch, base ref, merge-base, committed changes, staged changes, unstaged changes, and untracked files.
2. Map the changed code/configuration to security attack surfaces.
3. Run applicable security scanners when they are installed.
4. Launch a **separate read-only AI security reviewer** through a supported headless provider adapter.
5. Review the actual diff plus related surrounding code, middleware, authorization, validation, data access, configuration, infrastructure, and dependencies needed to prove or disprove a security issue.
6. Return all findings in one review.
7. Persist each finding as `SEC-NNN` and re-review it on later runs.
8. Calculate the security rating and merge decision deterministically in the Web Kit engine, not from model opinion.

## Security surfaces

The attack-surface mapper must expand the review to every relevant area. Areas include, but are not limited to:

- authentication, credentials, MFA, account recovery and enumeration;
- authorization, IDOR/BOLA, BFLA, ownership, privilege escalation and multi-tenancy;
- sessions, JWT, refresh tokens, OAuth/OIDC and cookie security;
- API input validation, mass assignment and excessive data exposure;
- SQL/NoSQL/database access and transaction integrity;
- SQL/NoSQL/OS/template/header and other injection paths;
- stored/reflected/DOM XSS, unsafe HTML and browser trust boundaries;
- CSRF, CORS, origin handling, clickjacking and CSP;
- SSRF, callbacks, webhooks, proxying, redirects and TLS verification;
- file uploads, MIME validation, traversal, archive extraction and storage exposure;
- secrets, credentials, environment configuration and private keys;
- cryptography, randomness, signing, verification, nonce/IV and key management;
- dependency vulnerabilities, CVE/GHSA/OSV advisories, supply chain, typosquatting and lifecycle scripts;
- containers, Docker, Kubernetes, IaC, cloud IAM and exposed services;
- CI/CD, GitHub Actions, untrusted PR execution, token permissions and artifact integrity;
- sensitive logging, PII/privacy and verbose error exposure;
- brute force, rate limits, resource exhaustion, request-size abuse and DoS;
- WebSockets, realtime channels, room isolation and flooding;
- business-logic abuse, payments, balances, bookings, inventory, race conditions, replay and idempotency;
- deserialization, parser abuse, XXE, prototype pollution and template evaluation;
- cache poisoning, cross-user cache leakage and tenant-key isolation;
- framework/language-specific risks discovered from the affected source.

If the reviewer discovers a new attack surface while tracing affected code, it must expand the review even when the initial mapper did not select that area.

## Scanner orchestration

Web Kit remains Node-only and does **not** require these external tools. When present, the engine uses them as additional evidence:

- Semgrep — source/SAST patterns;
- OSV-Scanner — dependency advisories and known vulnerabilities;
- Gitleaks — secret detection;
- Trivy — dependency, secret, container and IaC/misconfiguration evidence;
- npm/pnpm ecosystem audit commands when matching lockfiles exist.

A missing or failed scanner is a **coverage limitation**, never evidence that the branch is secure.

The reviewer must verify high-impact scanner results in actual source/configuration when possible and deduplicate overlapping scanner/model reports into one logical finding.

## Standards mapping

Use standards as taxonomy and evidence, not as the scope limit:

- OWASP Web Top 10;
- OWASP API Security Top 10;
- CWE, including CWE Top 25 where relevant;
- CVE/GHSA/OSV and ecosystem advisory identifiers only when a real advisory supports the match;
- framework, language, cloud, container and supply-chain security practices;
- business-logic and abuse-case analysis.

Never invent CVE, GHSA or OSV identifiers.

## Finding contract

Each active finding must include:

- stable fingerprint;
- persistent `SEC-NNN` ID assigned by the engine;
- severity: `CRITICAL | HIGH | MEDIUM | LOW | INFO`;
- confidence: `HIGH | MEDIUM | LOW`;
- lifecycle status;
- affected file and line when known;
- category;
- OWASP/CWE/advisory mapping when supported;
- concrete evidence without exposing secret values;
- realistic attack/abuse scenario;
- impact;
- actionable remediation;
- required validation or regression test.

Do not report generic best-practice suggestions as vulnerabilities without an evidence-backed risk path.

## Persistent re-review lifecycle

Findings must never silently disappear.

Statuses:

- `OPEN` — finding discovered on the first review;
- `STILL_OPEN` — same fingerprint is still present on re-review;
- `NEW` — newly discovered finding on a later review;
- `REGRESSION` — a previously resolved fingerprint has reappeared;
- `RESOLVED` — the previous finding is no longer reproducible in current evidence.

Review state is stored per branch under:

```text
.agent-core/security-reviews/<branch>/
├── latest.json
├── latest.md
├── history/
│   ├── review-001.json
│   ├── review-001.md
│   └── ...
└── runtime/
    ├── review-context-001.json
    └── scanner evidence
```

## Rating out of 5

The engine owns the score; the model must not self-score.

- `5.0` — no active blocking finding found in reviewed evidence;
- `4.x` — low/info recommendations only;
- `3.x` — medium-risk issue(s);
- `2.x` — high-risk issue(s);
- `0–1.x` — critical/high-impact security failure(s).

The score may use decimals. Score and merge decision are separate: one confirmed blocking issue can produce `REQUEST_CHANGES` even if most of the branch is otherwise strong.

A 5/5 score means **no blocking issue was found in the reviewed scope and available evidence**. It is never a guarantee of vulnerability-free software.

## Merge decision

`REQUEST_CHANGES` when an active `CRITICAL`, `HIGH`, or `MEDIUM` finding has non-low confidence.

`APPROVE` when no such active blocking finding remains. Low/info findings may remain as non-blocking recommendations.

## Independence and modification authority

The Security PR Reviewer is read-only and must not fix its own findings.

Expected loop:

```text
implementation
  -> security-review
  -> REQUEST_CHANGES
  -> implementation agent fixes SEC-* findings
  -> security-review again
  -> independent re-review
  -> APPROVE
```

Current source, current diff, tests, runtime evidence and scanner outputs outrank stale review summaries.
