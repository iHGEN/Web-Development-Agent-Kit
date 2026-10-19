# Agent Efficiency Policy

This is a **supporting rule** for the canonical lifecycle in `.agent-core/rules/workflow.md`. It applies to every task handled by Web Kit, including fixes, features, reviews, Git maintenance, debugging, and deployment. It does not introduce a new agent, approval gate, or session supervisor.

## Non-negotiable priorities

1. Satisfy the user's request correctly and preserve their work.
2. Respect security, data integrity, required independent validation, and the existing SMALL / MEDIUM / LARGE governance.
3. Within those constraints, minimize unnecessary latency, tokens, tool calls, duplicated discovery, and code changes.

Efficiency is not an excuse to skip required tests, reviews, approvals, or permissions. Never force a provider's reasoning setting: use a lower effort level for routine work **only if supported/configured**. No fixed completion-time deadline applies to all tasks.

## Rule 1 — Classify once; execute proportionally

The Captain classifies the task at intake. Reclassify only if verified new evidence materially changes risk or scope.

| Classification | Planning | Agents / checks |
| --- | --- | --- |
| SMALL | No formal plan; go straight to implementation once localized | Prefer one worker and targeted checks; independent reviews only where required by risk |
| MEDIUM | One short 3–6 bullet executable plan | One owner per coherent chunk; tests of affected surface |
| LARGE / HIGH-RISK | Existing formal plan and independent approvals | Appropriate specialists, contract/integration validation, required release/security gates |

Task size is not a time or token quota. Existing context-policy candidate-file limits remain in force, with justified expansion when needed.

## Rule 2 — Minimum sufficient evidence

- Reuse the current project profile, task-local verified findings, changed-file lists, and compact handoffs.
- For exact symbol/path/error lookup, use a targeted search and inspect the smallest useful source range.
- For dependency/impact questions, use ready/fresh Graphify only when it materially helps; otherwise use targeted source inspection.
- Never read every import, load an entire graph, refresh Graphify after every file edit, or rerun the same search without changed inputs or a specific new question.
- Once the next safe change is known, stop discovery and implement it.

## Rule 3 — Tool and agent economy

- Prefer one direct local tool/action over a chain of MCP calls or multiple agents when both produce the same trustworthy result.
- Do not activate installed capabilities merely because they exist.
- Avoid rewriting unchanged files, duplicate builds/tests, full-suite reruns after a localized failure, and parallel agents repeating the same discovery.
- Preserve the existing independence requirement when a validator/reviewer is mandatory.
- Capture tool output narrowly; keep completed-step handoffs compact.

## Rule 4 — Detect repeated no-progress actions

A repeated *no-progress attempt* means the **same logical action** is attempted again without a material change in Git state, source/diff, a relevant test result, or other evidence that advances the task. A new failing result that narrows the cause is new evidence; a repeated identical failure is not.

- After **two consecutive tagged no-progress attempts on the same action**, stop repeating that approach. Change one meaningful variable/strategy or report the precise blocker to the Captain/user.
- Do not confuse repeated Git rebase commands on **different commits/conflicts with advancing Git state** for a stall.
- Do not bypass plan approval or abandon required verification to escape a loop.
- If a command or tool is transiently unavailable, use a bounded retry with a changed condition; avoid unlimited retries.
- Evidence is required to mark an attempt as productive; do not call a task complete from optimistic narration.

The existing anti-slop guard continues to detect repeated planning/routing/prose-only cycles. The optional action-level guard in `.agent-core/bin/work-progress.mjs` complements it:

```bash
node .agent-core/bin/work-progress.mjs cycle --task-id TASK-042 --kind implementation --action-key git.rebase:conflict-src --outcome no-progress
node .agent-core/bin/work-progress.mjs cycle --task-id TASK-042 --kind implementation --action-key git.rebase:conflict-src --outcome no-progress
# A repeated-action alert is now recorded; change strategy or report a blocker.
node .agent-core/bin/work-progress.mjs cycle --task-id TASK-042 --kind implementation --action-key git.rebase:conflict-src --outcome progress --evidence "Conflict resolved and Git rebase state advanced"
```

`--action-key` identifies the *logical operation*, not a complete shell command or secret. `--outcome` is `progress` or `no-progress`. These flags are optional for backwards compatibility; no runtime claims to automatically intercept all provider tool calls.

## Rule 5 — Match validation to risk

- Review the actual diff first, then run the smallest relevant test/check that can establish the requested behavior.
- Expand to related suites/integration/security checks when failure evidence, shared contracts, risk, or release criteria require them.
- Do not repeatedly rerun an unchanged failing command. Fix the cause or capture the blocker.
- Independent plan, security, handoff, and integration gates remain in force wherever the canonical workflow requires them.

## Rule 6 — Stop upon verified completion

Finish when acceptance criteria, relevant checks, and required gates are satisfied. No unrelated refactor, extra documentation, speculative polish, follow-up agent, or repeated recap unless explicitly requested.

Final message: **result, meaningful changed files, verification, real blockers**. No lengthy activity log.

## Focused Git operation mode

For rebase, merge-conflict resolution, cherry-pick, and similar repository maintenance:

1. Inspect `git status`, active operation and any pre-existing user changes. Preserve them.
2. Inspect **only** currently unresolved conflicts / affected hunks and their necessary surrounding semantics.
3. Resolve preserving intended behavior, stage only resolved paths, and continue the active Git operation.
4. Repeat only when Git reveals new conflicts/commits. Confirm progress by Git state (e.g. conflict set, rebase position, HEAD), not by repeated narration.
5. Run proportionate verification and report final branch/Git status.

Do **not** reset, abort, skip commits, discard user changes, force-push, or rewrite remote history without explicit authorization. Git mode is a focused execution path, **not** an exemption from formal gates when the operation entails significant security/schema/integration risk.

## Metrics and accountability

Web Kit keeps existing job progress and `workflow-efficiency.json` separately from project completion. When reliable telemetry is available, a cycle may optionally report:

- `--elapsed-ms`: measured elapsed milliseconds for the cycle;
- `--tool-calls`: observed tool calls;
- `--input-tokens` / `--output-tokens`: provider-reported token counts.

Never fabricate values or pretend the policy alone changes provider configuration. New counters track tagged no-progress cycles and repeated-action alerts. Compare comparable tasks before/after by completion correctness, elapsed time, tokens, tool calls, and rework — not token count alone.

## Integration

- The **Captain** owns classification, minimal routing, loop recovery, and stopping.
- The **Context Router** owns smallest useful context; it must not become a new mandatory step for every edit.
- Existing **workers and validators** implement and verify per the canonical lifecycle.
- The existing **progress tracker** records optional action/telemetry evidence. Context rollover remains a separate outer-session mechanism.

Rules in existing project-owned `AGENTS.md`, `CLAUDE.md`, and other AI instruction files are preserved during installation/update. The managed Web Kit roles block may point to this policy but must never overwrite user content.
