# Web Kit Security PR Review

## Purpose

`security-review` is an independent, read-only PR-style security review of the current branch against its base branch. Its scope is **all security issues relevant to the changed attack surface**, not a fixed OWASP checklist.

The engine must never claim that every vulnerability has been found. A full-review 5/5 means no blocking issue was found in the reviewed scope and available evidence; it is not a guarantee of vulnerability-free software.

## Universal triggers

Terminal:

```bash
npx @ihgen/web-kit security-review
```

Inside any AI provider that can follow project instructions and execute local tools:

```text
run security-review
```

Optional provider-neutral forms include:

```text
run security-review deep
run security-review base develop
run security-review provider gemini
```

These all route to `.agent-core/bin/security-review.mjs`. If an AI client cannot execute local commands, it must say so and direct the user to the terminal command rather than pretending a review ran.

## Review model

1. Detect the current branch, exact base ref, merge-base, committed changes, staged changes, unstaged changes, and relevant untracked files.
2. Map changed code/configuration to security attack surfaces.
3. Collect evidence from applicable external scanners when available.
4. Launch a separate read-only AI security reviewer through a supported headless provider adapter for a full review.
5. Review the actual diff plus related middleware, authorization, validation, data access, configuration, infrastructure, dependencies, callers/callees, and business logic needed to prove or disprove a security issue.
6. Return all findings in one review.
7. Persist findings as stable `SEC-NNN` records and re-review them on later runs.
8. Calculate the security rating and decision deterministically in Web Kit, not from model opinion.

## Security surfaces

The mapper and reviewer expand to every relevant area, including:

- authentication, credentials, MFA, recovery, enumeration, and brute-force resistance;
- authorization, IDOR/BOLA, BFLA, ownership, privilege escalation, and multi-tenancy;
- sessions, JWT, refresh tokens, OAuth/OIDC, cookies, and token lifecycle;
- API validation, mass assignment, excessive exposure, and unsafe methods;
- SQL/NoSQL/database access, transaction integrity, and tenant isolation;
- SQL/NoSQL/OS/template/header and other injection paths;
- stored/reflected/DOM XSS, unsafe HTML, redirects, CSP, clickjacking, and browser trust boundaries;
- CSRF, CORS, origin validation, and credentialed browser requests;
- SSRF, callbacks, webhooks, proxies, redirects, DNS rebinding, and TLS verification;
- uploads, MIME handling, path traversal, archive extraction, and storage exposure;
- secrets, credentials, environment configuration, private keys, and sensitive logging;
- cryptography, randomness, signing, verification, nonce/IV handling, and key management;
- dependency CVE/GHSA/OSV advisories, supply chain, typosquatting, and lifecycle scripts;
- containers, Docker, Kubernetes, IaC, cloud IAM, and exposed services;
- CI/CD, GitHub Actions, untrusted PR execution, token permissions, and artifact integrity;
- privacy, PII, verbose errors, and audit logging;
- rate limiting, abuse, resource exhaustion, request-size abuse, and DoS;
- WebSockets/realtime authentication, authorization, isolation, replay, and flooding;
- business-logic abuse, payments, balances, bookings, inventory, races, replay, and idempotency;
- deserialization, XXE, parser abuse, prototype pollution, and dynamic evaluation;
- cache poisoning, cross-user leakage, and tenant-key isolation;
- framework- and language-specific risks discovered while tracing affected code.

If tracing the changed code reveals another attack surface, the reviewer must expand to it even when the initial mapper did not select it.

## Scanner orchestration

Web Kit remains Node-only and does not require external scanners. When installed, the review engine can use:

- Semgrep for SAST/source patterns;
- OSV-Scanner for dependency advisories;
- Gitleaks for secrets;
- Trivy for dependency, secret, container, and IaC/misconfiguration evidence;
- npm/pnpm ecosystem audit commands when matching lockfiles exist.

Missing or failed scanners are coverage limitations, never evidence of safety.

### Generated-state isolation

`.agent-core/security-reviews/**` is generated evidence/state, not product source. Before external scanners run, Web Kit temporarily moves the entire generated security-review state outside the project scanner root and restores it afterward. Scanner artifacts are first written outside the repository and copied back only after scanning finishes.

This prevents previous findings, prompts, scanner JSON, and review reports from generating self-referential scanner noise on a re-review.

## Full review vs scan-only

A normal review includes independent AI source reasoning and is eligible for a `/5` rating and merge decision.

`--scan-only` intentionally skips that source-level reasoning. Therefore scan-only:

- always returns `decision: INCONCLUSIVE`;
- always returns `approval_eligible: false`;
- is **not assigned a `/5` rating** (`rating: null`, `rating_status: NOT_SCORED_SCAN_ONLY`);
- surfaces scanner finding counts and scanner status;
- never converts an empty `SEC-*` list into `APPROVE`;
- requires a full `security-review` before Web Kit can issue an approval decision.

A scanner hit in scan-only mode is evidence requiring correlation, not a synthetic `SEC-*` finding with invented severity.

## Standards mapping

Use standards as taxonomy and evidence, not as the scope limit:

- OWASP Web Top 10;
- OWASP API Security Top 10;
- CWE, including CWE Top 25 where relevant;
- CVE/GHSA/OSV and ecosystem advisory identifiers only when real evidence supports the match;
- framework, language, cloud, container, and supply-chain security practices;
- business-logic and abuse-case analysis.

Never invent CVE, GHSA, OSV, CWE, or exploit evidence.

## Finding contract

Each active full-review finding must include:

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

Generic best-practice suggestions must not be reported as vulnerabilities without an evidence-backed risk path.

## Persistent re-review lifecycle

Findings never silently disappear.

- `OPEN` — found on the first review;
- `STILL_OPEN` — same fingerprint remains on re-review;
- `NEW` — first discovered on a later review;
- `REGRESSION` — a resolved fingerprint reappears;
- `RESOLVED` — a previous finding is no longer reproducible.

## Collision-safe branch storage

Review history is isolated by the **exact branch name**, not only a sanitized slug. The directory key is:

```text
<sanitized-branch>--<short-sha256-of-exact-branch-name>
```

For example, valid branches `feature/auth` and `feature-auth` may sanitize to the same readable prefix, but their hash suffixes differ, so they cannot share review numbers, `SEC-*` IDs, resolution state, or scanner history.

State is stored under:

```text
.agent-core/security-reviews/<collision-safe-branch-key>/
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

Pre-release legacy slug-only state may be migrated only when its `latest.json` records the exact same branch name; ambiguous/colliding state must never be imported into another branch.

## Rating out of 5

Only full reviews are scored.

- `5.0` — no active blocking finding found in reviewed evidence;
- `4.x` — low/info recommendations only;
- `3.x` — medium-risk issue(s);
- `2.x` — high-risk issue(s);
- `0–1.x` — critical/high-impact security failure(s).

The score may use decimals. Score and merge decision are separate: one confirmed blocking issue can produce `REQUEST_CHANGES` even when most of the branch is otherwise strong.

## Merge decision

For a full review:

- `REQUEST_CHANGES` when an active `CRITICAL`, `HIGH`, or `MEDIUM` finding has non-low confidence;
- `APPROVE` when no such active blocking finding remains.

For scan-only:

- `INCONCLUSIVE` always; scan-only is not merge approval.

## Independence

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
