# Standalone Changes Review

This rule supports **Review-only intake** in `.agent-core/rules/workflow.md`. It applies to standalone requests such as **"review these changes"**, **"review my changes"**, or **"review only"**. Register a separate review-delivery task, launch a genuinely fresh reviewer, return findings and coverage gaps, then stop. Interpret the whole request: an explicit request to fix findings, execute checks, or assess PR readiness also authorizes the corresponding normal workflow.

## Select the evidence

Honor the user's supplied diff, files, PR, commit range or comparison base first. Otherwise review the current staged, unstaged and relevant untracked changes, and say that this is the selection. Do not silently include every committed change on the branch or substitute a task's allowed paths for the user's review selection. Read affected callers and contracts as needed to assess the selected changes.

Use the host's existing authorized source-reading and diff capabilities. Existing task IDs, requirements, scope snapshots, project profiles and recorded checks are optional context. Do not reconcile scope, capture a replacement pre-change baseline or repair setup. This route takes precedence over project-profile loading, Graphify bootstrap and the implementation/completion loop; its separate review-delivery task does not inherit those prerequisites.

Pass the available selection to the fresh reviewer even when it may be empty or incomplete; these cases do not skip the fresh launch. If the requested base or some files are unavailable, the reviewer inspects available material and identifies the missing comparison or coverage precisely. Do not silently claim a different selection was reviewed. If no source or diff is accessible, its report states **NO SOURCE** and what is needed, not "no findings." If the selected working tree has no changes, it states **NO CHANGES** without implying that branch commits were reviewed.

## Register and launch a fresh reviewer

The **coordinator** owns bookkeeping; the **reviewer** only reads and returns a report. For every new request, the coordinator chooses a unique new task ID with no existing job, scope manifest or review report/directory. Never reuse an implementation task or an earlier review task, use `--force`, or add `--high-risk` or `--pr-bound` to this report-delivery task. `SMALL` describes delivery bookkeeping, not the risk of the code being reviewed.

Register through the existing managed helper (replace placeholders with actual values):

```bash
node .agent-core/bin/work-progress.mjs start \
  --task-id <new-review-task-id> --classification SMALL --review-only \
  --title "Deliver independent changes review" \
  --next "Launch a fresh native reviewer for the selected changes"
```

Then use the host assistant's **actual native fresh-agent/session tool**, with no inherited builder conversation and no resume. Give it the original user intent, selected diff/current source, relevant callers, prior findings and existing check evidence. Request read-only tools when supported. The delegated reviewer must not repeat intake, register another task or spawn a replacement reviewer. Preserve the visible builder conversation. A renamed role, new task ID or copied transcript is not proof of a new session.

After the host confirms launch, record the real returned session/agent ID:

```bash
node .agent-core/bin/work-progress.mjs update \
  --task-id <new-review-task-id> --status REVIEWING --agent code-reviewer \
  --evidence "Fresh host reviewer: <actual-session-id>; no builder conversation or resume" \
  --next "Receive the independent source-review report"
```

If managed tracking is unavailable or fails, disclose the tracking gap and still launch the fresh reviewer. Do not repair tracking or reuse another task to make registration succeed. If the host cannot launch a fresh context, or the launch fails, report **Review not started** with the concrete limitation; do not claim findings, substitute same-session analysis or complete the task. The new task, if successfully registered, may be marked `BLOCKED` with the launch failure as evidence. Never invent a session ID.

The Node bookkeeping helper cannot itself create a host-native session. Do not use `session-controller.mjs`, `context-supervisor.mjs`, `/clear` or `/new` as a substitute: the controllers continue or replace implementation sessions and have different progress/permission contracts. This route requires an actual fresh host launch, runs one review, and stops.

## Execute the analysis

This route does not launch an external provider CLI, invoke `.agent-core/bin/code-review.mjs`, or establish an additional OS sandbox. It uses the host's existing permissions and policies. Read-only instructions are a behavior contract, not a claim of newly verified OS isolation. Never bypass a denied capability, remove `.rules` files or weaken user policies to obtain more access.

The reviewer must not execute project code, tests, builds, hooks, migrations or installation commands. The coordinator's managed tracking commands above and below are bookkeeping only. Avoid read/diff commands that invoke configured project helpers. Use available source-reading alternatives or supplied evidence when safe inspection is unavailable. Missing test execution, failed scope checks and unavailable strict-runner sandbox support are coverage or readiness limitations; they do not prevent analysis of accessible code.

Challenge the implementation against the original intent and actual source. Trace realistic normal, failure, permission, boundary, retry and concurrency cases where applicable. Inspect relevant security, correctness, integration, testing, performance and maintainability concerns. Support each P0–P3 finding with its location, trigger, impact, evidence and smallest proposed remedy. Distinguish demonstrated defects from hypotheses; do not invent findings, a finding quota, test results or a guarantee that no bugs remain. On re-review, address earlier findings explicitly.

## Report and stop

State the actual task and fresh-session identities, selected changes, examined files or behaviors, findings and coverage gaps. The coordinator adds the host-returned identity when it is not visible to the reviewer. Distinguish source reasoning from recorded or executed checks. If source changes during analysis, identify affected conclusions as stale rather than certifying the new state. Missing evidence may make the report **PARTIAL** while useful findings are still returned.

```text
Changes review: COMPLETED | PARTIAL | NO CHANGES | NO SOURCE
Task: <new-review-task-id, or tracking unavailable with reason>
Execution: fresh host reviewer
Session: <actual host-returned session/agent ID>
Selection: <files/diff/range and comparison actually examined>
Findings: <severity, location, trigger, impact, evidence, proposed remedy>
Coverage: <examined behavior and relevant callers>
Checks: <existing evidence inspected; checks not executed during this review>
Gaps: <unavailable evidence or unexamined behavior, or none identified>
PR readiness: not assessed
```

The reviewer returns this report and stops without writing source or state. The coordinator may save the returned report in a new `.agent-core/state/reviews/<new-review-task-id>/report.md`, present it to the user, and record delivery on **only the new review task**:

```bash
node .agent-core/bin/work-progress.mjs update \
  --task-id <new-review-task-id> --status DONE --final-validation PASS \
  --evidence "Independent report delivered: .agent-core/state/reviews/<new-review-task-id>/report.md; session <actual-session-id>; PR readiness not assessed" \
  --next "Stop; await a separate request to fix findings"
```

Run this completion update only after the actual report is delivered, using its real location or delivery evidence. `DONE` and this task's final-validation `PASS` mean **review-report delivery completed**, even if the report contains defects or states `PARTIAL`, `NO CHANGES` or `NO SOURCE`. They never approve the reviewed code. Leave `review.status` and `quality.code_review` pending; do not invoke `quality-review`. A launch failure never qualifies for completion. If tracking or report storage fails, still deliver the available report and disclose that gap.

The coordinator may write the new review task/report and the managed helper's normal aggregate bookkeeping. Preserve source, existing implementation/review jobs, scope manifests and review queues. Do not fix findings, import approval evidence, declare `READY TO OPEN PR`, commit, push, change PRs, publish or dispatch CI/CD. A later fix request resumes the normal scoped implementation workflow.

The strict PR-readiness review remains `.agent-core/bin/code-review.mjs` under `pre-pr-review.md`, with its existing task, scope, check, provider and sandbox requirements. Standalone analysis never supplies or replaces that approval evidence. A numerical review score, if requested, does not change this distinction.
