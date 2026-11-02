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

`--pr-bound` is a completion contract, not an additional planning/review phase. New jobs on detected Git feature branches enable it by default; use `--local-only` or `--review-only` only for an explicitly local or read-only task. These opt-outs cannot be combined with `--pr-bound`. Elsewhere, pass `--pr-bound` when a PR is intended; detached HEAD requires an explicit intent flag. Use the task's actual classification. An ongoing job can be upgraded with `work-progress.mjs update --task-id TASK-042 --pr-bound`, but the earlier pre-change snapshot must still exist; do not silently backfill one after editing.

Register a short acceptance checklist and the required checks before implementation, for every PR-bound size. SMALL needs testable criteria, not a formal specification or another planning stage:

```bash
node .agent-core/bin/work-progress.mjs requirement-add \
  --task-id TASK-042 --id REQ-001 \
  --description "Owner can cancel a booking" \
  --acceptance "The owner can cancel; another user is denied; repeating cancellation is safe"
node .agent-core/bin/work-progress.mjs check-require --task-id TASK-042 --script test
```

Choose actual checks that exercise the changed behavior and its affected boundaries. All declared checks must pass; an unrelated passing test cannot replace a missing required check. For a non-npm check, register an executable and separate arguments:

```bash
node .agent-core/bin/work-progress.mjs check-require \
  --task-id TASK-042 --id regression --command node --arg tests/regression.mjs
```

Before the first write, on a dedicated feature branch, create the task's scope snapshot. Use the actual PR base; do not assume that `main` is always the target:

```bash
node .agent-core/rules/scope-guard.mjs start \
  --task-id TASK-042 --base main \
  --intent "Implement REQ-001 without changing booking notifications" \
  --allow src/feature.js --allow tests/feature.test.js
```

The guard captures pre-existing staged, unstaged and untracked changes without modifying them. Exact file paths are required: no blanket `src/**`, whole-repository patterns or broad directory exemptions. Generated untracked state lives in `.agent-core/state/scope/` and is not a deliverable; staged or committed changes to state files are not silently exempt.

For a kit installed in a nested application, keep `--project` consistent across task, scope and review commands. All allowed/source paths are relative to the Git repository root, such as `apps/web/src/feature.js` and `packages/shared/contract.js`. Task state and check execution stay in the selected application; the scope fence and review diff span the entire repository. Canonical directory resolution handles filesystem aliases without requiring the user to move task state to the Git root.

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

## 2. One strict independent Code Review, reused for PR readiness

Use the workflow's **existing Code Reviewer and quality-review evidence**. After implementation, required checks and applicable specialist validation, the Captain runs the dedicated review command. It launches a fresh read-only provider process and does not resume the builder's conversation. The configured model is preserved; a different role name alone is not proof that a separate review executed.

Review the full eventual PR change set: merge base to feature HEAD, staged/unstaged work, relevant untracked files, and scope extensions. Use the scope result and inspect hunks even inside allowed files. Read the original intent and acceptance criteria, then examine actual source and affected callers independently of the builder's explanation.

Reuse a current report instead of scheduling another full review. If code, tests, documentation, requirements, declared checks or relevant verification evidence change, re-review the affected behavior and downstream risks, then record a report for the current snapshot.

The reviewer's task is to find credible counterexamples: wrong inputs, unauthorized actions, empty/boundary data, failures, retries, concurrency, incompatible callers and incorrect state transitions as applicable. Verify that tests would expose those failures. Explain non-applicable cases. Do not demand a minimum number of findings, invent bugs, or turn personal style preferences into blockers.

The review must examine applicable areas:

1. **Security (25%)** — auth/authz, secrets, validation, injection, data exposure, dependencies and trust boundaries.
2. **Architecture (20%)** — ownership, contracts, compatibility, layering, schema and existing conventions.
3. **Correctness (20%)** — acceptance criteria, errors, edge cases, concurrency, regressions and state transitions.
4. **Testing (15%)** — actual coverage of changed behavior, negative/failure cases, integration seams and commands run.
5. **Performance (10%)** — affected hot paths, I/O, queries, memory, resource lifetime and unnecessary work.
6. **Maintainability (10%)** — clarity, duplication, typed contracts, observability, UX/accessibility when relevant.

When a quality score is requested, score applicable categories **0–5**, mark genuinely irrelevant categories `N/A`, and normalize weights. Scores are explanatory; they do not replace the structured report or override a blocker.

Execute every declared check through the existing evidence runner and link acceptance criteria to the relevant results:

```bash
node .agent-core/bin/work-progress.mjs check-run --task-id TASK-042 --script test
node .agent-core/bin/work-progress.mjs requirement-verify \
  --task-id TASK-042 --id REQ-001 --result PASS --check-script test \
  --evidence "Owner, cross-user and repeated-cancellation cases passed"
# For the registered non-npm command:
node .agent-core/bin/work-progress.mjs check-run --task-id TASK-042 --check regression
```

Use `--check-script regression` to link an acceptance criterion to that named external check. Manual acceptance evidence must state what was observed and where the evidence can be inspected; it does not replace an unexecuted required check. Dot remains responsible for CI/CD; these commands provide local verification records and do not dispatch GitHub Actions.

On Windows, external checks resolve recognized standard npm Node `.cmd` shims to their actual Node entry point and preserve literal arguments without shell interpolation. Unsupported/custom `.cmd` or `.bat` scripts require an explicitly registered interpreter or entry point and block before execution with setup instructions. npm package-script checks retain their existing execution route.

For each actionable finding, report `P0` critical / `P1` high / `P2` medium / `P3` low, exact path and line/symbol, triggering conditions, impact, evidence/reproduction, and smallest safe fix. Investigate suspected issues before reporting them as confirmed. Record verification honestly and distinguish source reasoning from executed checks. Never fabricate a pass or weaken/delete checks to obtain approval.

Run **this same review**, for all PR-bound sizes:

```bash
node .agent-core/bin/code-review.mjs --task-id TASK-042 --provider codex
# Public CLI equivalent, using the installed runtime without an update:
npx @ihgen/web-kit code-review --task-id TASK-042 --provider codex
```

`--provider auto` is the default and selects Codex. Per-run restrictions disable automatic approvals, lifecycle hooks, legacy notifications, apps, plugins and configured MCP tools. Before inference, preflights must verify effective configuration and managed requirements. Configured `.rules` files, remote execution environments and unsupported managed permission-profile modes block the review; the runner does not remove or replace those policies. Windows additionally requires explicit existing `CODEX_HOME` and a verified supported sandbox. Configuration inspection starts no model session, though provider-owned state/cache may be maintained. `--provider claude` is blocked because managed lifecycle hooks cannot be disabled or inspected safely before inference. `--provider gemini` remains blocked because its read-only headless mode cannot preserve configured user policies. Neither blocked provider is launched. Missing providers, timeouts, malformed reports, incomplete essential coverage or changed source during review block verification. The runner records the actual invocation and returned report, then imports it through `work-progress.mjs quality-review --report <generated-path>`. A free-text `--reviewer code-reviewer --result PASS` cannot approve PR-bound work.

The report records examined files, requirement cases, affected boundaries, supported findings and verification gaps. The completion gate checks structural completeness, recorded execution, required check results and snapshot freshness. These checks make the evidence inspectable; they do not prove the model's conclusions correct or make local records tamper-proof. The full Git fingerprint still protects docs and staged content as well as source files.

The review also binds the registered spec's path, current contents and approval digest, plus material plan state. Read the complete specification even when it is ignored by Git or absent from the diff, and include its repository-relative path in `files_reviewed`. A changed/revoked spec or plan approval supersedes the current review attempt while preserving prior findings. After reapproval, start a fresh review; an old report cannot finish the new task state.

## 3. Fix, re-test, re-review

The independent reviewer is **read-only**. Route verified, in-scope findings to the original responsible implementation worker. Fix P0/P1/P2 findings, regressions, and missing required coverage; treat P3 as optional unless it violates an acceptance criterion. Each fix must stay within the scope fence and pass targeted checks plus affected broader checks, security review and final integration validation when the change warrants them.

Re-run `scope-guard.mjs check`, rerun affected required checks, update acceptance evidence and invoke the independent reviewer on the resulting changes. The reviewer must explicitly address prior findings; omission is not resolution. Keep unchanged, already verified work valid. Limit one invocation to three review/fix passes, then report unresolved issues instead of looping indefinitely. A current unchanged report can be reused.

The result is one of:

- `READY TO OPEN PR`: no unresolved blocking findings, registered requirements satisfied, all required checks passed, scope check passed, structured independent review current.
- `NOT READY`: known defect, failing applicable check, unapproved scope, or incomplete requirement.
- `VERIFICATION BLOCKED`: essential source, base, permission, tool or test evidence unavailable.

Only `READY TO OPEN PR` permits opening or marking a PR ready, and only when the user/workflow authorizes creation. Do not push, create, merge or close a PR during a **review-only** request. Once a PR exists, its external review and the project's authorized CI/CD owner remain separate gates; never manually dispatch GitHub Actions merely to satisfy this local review. When the user assigns CI/CD to Dot, Dot remains the CI/CD executor, not the Code Reviewer.

## Required concise review report

```text
Verdict: READY TO OPEN PR | NOT READY | VERIFICATION BLOCKED
Branch -> base | Reviewed snapshot and run ID
Scope: PASS/FAIL/BLOCKED | exact changed files | extensions/non-goals
Fixed: severity + finding + fix + validation
Remaining: severity + evidence + owner/next action, or none
Coverage: requirements, normal/failure/integration cases, affected boundaries
Checks: PASS/FAIL/NOT RUN/BLOCKED + actual command/result
Gaps: missing essential evidence, or none
Scores: optional requested rubric; never override the gate
Handoff: current diff/dirty worktree, limitations, suggested PR summary
```

This process reduces avoidable PR feedback; it cannot guarantee that another reviewer will find no issues. The file-scope guard cannot detect an unrelated hunk *inside* an allowed file, so independent diff review remains mandatory.
