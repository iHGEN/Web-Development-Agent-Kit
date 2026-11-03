# Standalone Changes Review

This rule supports **Review-only intake** in `.agent-core/rules/workflow.md`. Standalone requests such as **"review these changes"**, **"review my changes"**, or **"review only"** start a **new review task in a fresh native Codex/Claude session**. The same outer supervisor that handles 50% context rollover replaces the current session, runs one review, and exits after report delivery. It does not delegate a subagent or resume the builder afterward. Interpret the whole request: explicit fixes, check execution or PR-readiness assessment follow their corresponding authorized workflow.

## Select the evidence

Honor the user's supplied diff, files, PR, commit range or comparison base first. Otherwise select the current staged, unstaged and relevant untracked changes and say so. Do not silently include every committed branch change or substitute an implementation task's allowed paths for the requested selection.

Preserve the original request and source selection in the task handoff. Do not attach the builder's conversation, implementation summary or global context handoff. The fresh session reads the selected source and relevant callers/contracts needed to assess it. Requirements, prior findings and recorded checks supplied with the requested review selection may be inspected; they are evidence, not prerequisites. Do not load an old implementation job, scope, queue or prior reviewer conclusions to reconstruct builder context. Do not reconcile scope, capture a replacement pre-change baseline, repair setup or bootstrap Graphify.

Empty or incomplete selections still enter the fresh review. An unavailable base or file becomes a precise coverage gap; do not silently review another comparison. No accessible source produces **NO SOURCE** and a description of what is missing. No selected working-tree changes produces **NO CHANGES**, without implying branch commits were reviewed.

## Request a new task and end the current turn

Use the installed helper from the project root with the original request and selected source description:

```bash
node .agent-core/bin/task-handoff.mjs request-review \
  --request '<original user request>' \
  --selection '<requested files/diff/range, or current staged, unstaged and relevant untracked changes>'
```

For text that is easier to pass as JSON, use `--request-file <path>` containing `original_request` and `selection` instead of the two text flags. Preserve user text exactly and use safe argument quoting.

The helper saves a task-only handoff, chooses a unique new task ID, and best-effort registers a SMALL `--review-only` report-delivery task. `SMALL` describes delivery bookkeeping, not the risk of the reviewed code. It never reuses an implementation task, existing scope ID or earlier review directory, or forces registration. Tracking failure is a coverage gap and does not prevent the fresh review.

A compatible active native supervisor is required. The request is bound to that supervisor and its current provider launch. An accepted request means **handoff queued**, not that review has run. After successful queuing, end the current assistant turn. Do not continue analysis, launch a subagent, spawn another supervisor, run the strict `code-review.mjs` runner or reset the provider manually.

At the actual native boundary, the outer `context-supervisor.mjs` ends the idle old TUI and starts the same provider fresh with only the task handoff. Codex uses `agent-turn-complete`; Claude uses `Notification` with `idle_prompt` (normally after about 60 seconds waiting for input; see [Claude hook documentation](https://code.claude.com/docs/en/hooks#notification)). Claude status-line updates and `Stop` are not trusted as this task's completion boundary. This path never resumes the builder to capture a summary and does not wait for 50% context usage.

The fresh launch retains the existing provider launch settings, model, permissions, authentication and user policies. It adds no OS sandbox and never weakens policy. If supervision is unavailable, incompatible, denied or fails to launch, report **Review not started** with the concrete limitation. Do not substitute delegated or same-session review, `session-controller.mjs`, `/clear` or `/new`, and do not complete the task. Never invent a native session ID.

## Execute the analysis

The fresh session reads its referenced task-only handoff first and performs that review once. It must not re-enter intake, register another task, spawn a replacement reviewer or apply the old implementation task's resume/anti-slop rules.

Use existing authorized read/diff capabilities. Do not execute project code, tests, builds, hooks, migrations or installation commands. Avoid read/diff commands that invoke configured project helpers. Use source-reading alternatives or supplied evidence when safe inspection is unavailable. Missing requirements, tests, scope records and comparison evidence are coverage gaps; they do not block analysis of accessible code. Read-only behavior does not imply a newly verified OS boundary.

Challenge the implementation against the original intent and current source. Trace realistic normal, failure, permission, boundary, retry and concurrency cases where relevant. Inspect security, correctness, integration, testing, performance and maintainability concerns. Support each P0–P3 finding with its location, trigger, impact, evidence and smallest proposed remedy. Distinguish demonstrated defects from hypotheses; do not invent findings, test results, a finding quota or a guarantee that no bugs remain. Address previous findings explicitly on re-review.

## Deliver the report and stop

The sole review output write is the new path designated by the handoff: `.agent-core/state/reviews/<new-review-task-id>/report.md`. Include findings, examined source and gaps. Distinguish source reasoning from recorded checks. If source changes during review, mark affected conclusions stale. Missing evidence may make a useful report **PARTIAL**.

```text
Changes review: COMPLETED | PARTIAL | NO CHANGES | NO SOURCE
Task: <new-review-task-id; disclose tracking failure if any>
Execution: fresh native supervisor session
Session: <actual native provider ID when available; otherwise pending boundary confirmation>
Selection: <files/diff/range and comparison actually examined>
Findings: <severity, location, trigger, impact, evidence, proposed remedy>
Coverage: <examined behavior and relevant callers>
Checks: <recorded evidence inspected; no project checks executed during this review>
Gaps: <missing evidence or unexamined behavior, or none identified>
PR readiness: not assessed
```

After writing the report, stage its receipt:

```bash
node .agent-core/bin/task-handoff.mjs report-ready
```

Then present the report to the user and end the turn. Do not change the report after staging its receipt. `report-ready` alone is not delivery confirmation. The supervisor requires a valid receipt and the fresh provider's actual native completion boundary, records the native session identity, and completes **only the new review task** with `DONE` and final-validation `PASS` before exiting. It never returns to the builder. Do not manually mark the task done; report any receipt/storage failure honestly without claiming successful completion.

If that genuine fresh-session boundary arrives with a missing or invalid report receipt, the supervisor stops the review and records the new task as failed instead of waiting indefinitely or claiming delivery. An old session callback cannot trigger this failure. A failure to verify task ownership remains an explicit limitation; do not use another task's records to repair it.

`DONE`/`PASS` mean **report delivery completed**, including reports with findings or `PARTIAL`, `NO CHANGES` or `NO SOURCE`. Leave `review.status` and `quality.code_review` pending; do not import approval through `quality-review`. Managed writes are limited to the new review task/handoff/report/receipt and normal aggregate bookkeeping. Preserve source, existing jobs, scope manifests, review queues and the global implementation `context-handoff.json`.

Do not fix findings, declare `READY TO OPEN PR`, commit, push, change PRs, publish or dispatch CI/CD. A later fix request enters normal scoped implementation. Strict PR readiness remains `.agent-core/bin/code-review.mjs` under `pre-pr-review.md`, with its existing task, scope, check, provider and sandbox requirements. This report never supplies that approval evidence.
