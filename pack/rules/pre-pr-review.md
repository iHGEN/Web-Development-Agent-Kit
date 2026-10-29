# Existing Code Review, PR Readiness and Scope Fence

This rule supports the single lifecycle in `.agent-core/rules/workflow.md`. It applies to **every code-changing task** in a Git feature branch for scope protection, and adds a mandatory readiness gate to work intended for a pull request. It does not create a second workflow or require formal planning for SMALL tasks.

Treat new feature-branch work as intended for a future PR by default unless the user explicitly says it is local-only or review-only. Do **not** introduce a second Code Reviewer step: strengthen and reuse the workflow's existing independent review.

## 1. Lock a narrow change surface before editing

The Captain states the original intent, acceptance criteria, affected owners, exact expected files and explicit non-goals. For formal work, use the locked Execution Registry and approved Plan Deltas; for SMALL/MEDIUM work, use a short scope note. A dependency may be inspected without permission to edit it.

For PR-bound work, mark the **existing job** at creation time, before editing:

```bash
node .agent-core/bin/work-progress.mjs start \
  --task-id TASK-042 --classification SMALL --pr-bound \
  --title "Implement REQ-001"
```

`--pr-bound` is an explicit completion contract, not an additional planning/review phase. Use the task's actual classification. Local-only/read-only jobs do not need this flag. An ongoing job can be upgraded with `work-progress.mjs update --task-id TASK-042 --pr-bound`, but the earlier pre-change snapshot must still exist; do not silently backfill one after editing.

Before the first write, on a dedicated feature branch, create the task's scope snapshot. Use the actual PR base; do not assume that `main` is always the target:

```bash
node .agent-core/rules/scope-guard.mjs start \
  --task-id TASK-042 --base main \
  --intent "Implement REQ-001 without changing booking notifications" \
  --allow src/feature.js --allow tests/feature.test.js
```

The guard captures pre-existing staged, unstaged and untracked changes without modifying them. Exact file paths are required: no blanket `src/**`, whole-repository patterns or broad directory exemptions. Generated untracked state lives in `.agent-core/state/scope/` and is not a deliverable; staged or committed changes to state files are not silently exempt.

- Never amend, stage, discard or overwrite pre-existing user changes merely to finish a task. If work overlaps an already-dirty file, stop and request direction.
- Do not edit unrelated files for aesthetic cleanup, naming consistency, warnings discovered elsewhere, dependency upgrades, broad formatting, or opportunistic refactors.
- An unchanged file may be read to understand a real dependency. Reading it does not authorize changing it.
- If new evidence proves another **necessary** file is required, extend the fence *before* editing it, recording the acceptance criterion and source evidence:

```bash
node .agent-core/rules/scope-guard.mjs extend \
  --task-id TASK-042 --allow src/shared/contract.js \
  --reason "Required by REQ-001's existing consumer" \
  --evidence "src/feature.js:import and affected integration test"
```

The Captain must verify the extension against the original request. Material changes to architecture, public contracts, schema, security, dependencies, destructive behavior or product scope still require the normal validated Plan Delta. Scope extensions are **not** permission to introduce unrelated work; the reviewer audits every extension.

After each coherent implementation/fix chunk and before any handoff, commit, push or PR creation:

```bash
node .agent-core/rules/scope-guard.mjs check --task-id TASK-042
```

`FAIL` or `BLOCKED` stops publication and dependent work. Investigate reported paths/hunks against the original scope, repair only provably task-created mistakes with targeted edits, or ask the user. Never silently reinitialize the guard, widen the allowlist retroactively, use destructive Git reset/checkout, or conceal a failing report. Routine Git maintenance follows the existing focused Git policy and must independently protect unrelated changes.

For jobs marked `--pr-bound`, the existing work-progress runtime rejects a passing `quality-review` without a passing scope check and blocks `DONE` if the scope is absent, failed or stale. Jobs with a scope snapshot also cannot reach `DONE` with a failed scope check, even if local-only. The guard is not a Git hook; agents still run it before commit/push as required above.

If Git, the declared base, the task scope, or the pre-change snapshot is unavailable, do not claim the scope gate passed. Clearly report `VERIFICATION BLOCKED` before proposing a PR.

## 2. One professional independent Code Review, reused for PR readiness

Use the workflow's **existing Code Reviewer and quality-review evidence**. The Captain routes that reviewer independently of the implementer once the implementation, relevant local checks, affected integration validation and specialist/security checks are sufficiently complete. Review the full eventual PR change set: merge base to feature HEAD, staged/unstaged work, relevant untracked files, and any scope extensions. Use the scope-guard result and inspect diff hunks even inside allowed files; an allowed path can still contain an unrelated change.

Do **not** schedule another full pre-PR review when the existing independent Code Review already covered the same final diff and requirements. Reuse its current evidence. If implementation, tests, documentation, staged files or committed branch changes change afterward, re-review only affected areas and downstream risks, then record a fresh approval bound to the new full diff.

The review must examine applicable areas:

1. **Security (25%)** — auth/authz, secrets, validation, injection, data exposure, dependencies and trust boundaries.
2. **Architecture (20%)** — ownership, contracts, compatibility, layering, schema and existing conventions.
3. **Correctness (20%)** — acceptance criteria, errors, edge cases, concurrency, regressions and state transitions.
4. **Testing (15%)** — actual coverage of changed behavior, negative/failure cases, integration seams and commands run.
5. **Performance (10%)** — affected hot paths, I/O, queries, memory, resource lifetime and unnecessary work.
6. **Maintainability (10%)** — clarity, duplication, typed contracts, observability, UX/accessibility when relevant.

Score each applicable category **0–5**, mark genuinely irrelevant categories `N/A`, and normalize weights over evaluated categories. The overall score never overrides a blocker. Review actual source and relevant callers, not only the developer's summary. Avoid speculative stylistic findings.

For PR-bound jobs, execute a current npm test script when one exists; if there is no test script, execute an available build/lint/typecheck script. The completion gate requires actual `check-run` evidence, not a claimed pass. For non-npm projects, record real verification commands and limitations in the review report.

For each actionable finding, report `P0` critical / `P1` high / `P2` medium / `P3` low, exact path and line/symbol, impact, evidence/reproduction, and smallest safe fix. Separate verified defects from hypotheses. Record validation as `PASS`, `FAIL`, `NOT RUN`, or `BLOCKED`, with real commands and outcomes. Never fabricate a pass or silently weaken/delete checks.

Record **this same review** using the existing quality evidence command, for all PR-bound sizes (including SMALL):

```bash
node .agent-core/bin/work-progress.mjs quality-review \
  --task-id TASK-042 --reviewer code-reviewer --result PASS \
  --evidence "Full diff, acceptance cases, scope and test results independently verified"
```

Only record `PASS` if the real review supports it. The runtime stores a fingerprint of the complete Git change set and checks that it is still current at `DONE`; this also catches doc changes that a source-only fingerprint could miss. A claimed review or a `--review PASS` summary is not a substitute.

## 3. Fix, re-test, re-review

The independent reviewer is **read-only**. Route verified, in-scope findings to the original responsible implementation worker. Fix P0/P1, material P2, regressions, and missing required coverage; treat P3 as optional unless it violates an acceptance criterion. Each fix must stay within the scope fence and pass targeted checks plus affected broader checks, security review and final integration validation when the change warrants them.

Re-run `scope-guard.mjs check`, inspect the affected new diff and downstream dependencies, and update the independent review evidence after fixes. Keep unchanged, already verified findings valid. Limit one invocation to three review/fix passes, then report unresolved issues instead of looping indefinitely. An unchanged final diff **does not** require another review.

The result is one of:

- `READY TO OPEN PR`: no unresolved P0/P1/material P2, requirements satisfied, relevant checks passed, scope check passed, independent re-review current.
- `NOT READY`: known defect, failing applicable check, unapproved scope, or incomplete requirement.
- `VERIFICATION BLOCKED`: essential source, base, permission, tool or test evidence unavailable.

Only `READY TO OPEN PR` permits opening or marking a PR ready, and only when the user/workflow authorizes creation. Do not push, create, merge or close a PR during a **review-only** request. Once a PR exists, its external review and the project's authorized CI/CD owner remain separate gates; never manually dispatch GitHub Actions merely to satisfy this local review. When the user assigns CI/CD to Dot, Dot remains the CI/CD executor, not the Code Reviewer.

## Required concise review report

```text
Verdict: READY TO OPEN PR | NOT READY | VERIFICATION BLOCKED
Branch -> base | Overall X.X/5
Scope: PASS/FAIL/BLOCKED | exact changed files | extensions/non-goals
Fixed: severity + finding + fix + validation
Remaining: severity + evidence + owner/next action, or none
Checks: PASS/FAIL/NOT RUN/BLOCKED + actual command/result
Scores: Security | Architecture | Correctness | Testing | Performance | Maintainability
Handoff: current diff/dirty worktree, limitations, suggested PR summary
```

This process reduces avoidable PR feedback; it cannot guarantee that another reviewer will find no issues. The file-scope guard cannot detect an unrelated hunk *inside* an allowed file, so independent diff review remains mandatory.
