# Standalone Changes Review

This rule supports **Review-only intake** in `.agent-core/rules/workflow.md`. It applies to standalone requests such as **"review these changes"**, **"review my changes"**, or **"review only"**. Inspect the requested changes, return useful findings and coverage gaps, then stop. Interpret the whole request: an explicit request to fix findings, execute checks, or assess PR readiness also authorizes the corresponding normal workflow.

## Select the evidence

Honor the user's supplied diff, files, PR, commit range or comparison base first. Otherwise review the current staged, unstaged and relevant untracked changes, and say that this is the selection. Do not silently include every committed change on the branch or substitute a task's allowed paths for the user's review selection. Read affected callers and contracts as needed to assess the selected changes.

Use the host's existing authorized source-reading and diff capabilities. Task IDs, registered requirements, scope snapshots, project profiles and recorded checks are useful context when available; none is a prerequisite for analysis. Do not create review tasks, reconcile scope, capture a replacement pre-change baseline or repair setup before reading the code. This route takes precedence over project-profile loading, Graphify bootstrap, task creation and implementation/completion loops for the standalone request.

If the requested base or some files are unavailable, inspect the available material and identify the missing comparison or coverage precisely. Do not silently claim a different selection was reviewed. If no source or diff is accessible, report **NO SOURCE** and what is needed to inspect it; do not report "no findings." If the selected working tree has no changes, report **NO CHANGES** without implying that branch commits were reviewed.

## Execute the analysis

Use the host assistant's actual native delegation capability for a fresh Code Reviewer context when available. Give it the original user intent, selected diff and current source, relevant callers, prior findings and existing check evidence. Use a clean context without the builder's conversation or conclusion where the host supports it. Request read-only tools when the host provides that capability. A role-name change is not proof of an independent session.

If fresh delegation is unavailable, continue with **same-session analysis** and disclose that execution mode. Do not invent a separate reviewer, ask the user to restart merely for review, or replace the visible conversation with `/clear`, `/new` or the rollover controller.

This route does not launch an external provider CLI, invoke `.agent-core/bin/code-review.mjs`, or establish an additional OS sandbox. It uses the host's existing permissions and policies. Read-only instructions are a behavior contract, not a claim of newly verified OS isolation. Never bypass a denied capability, remove `.rules` files or weaken user policies to obtain more access.

Do not execute project code, tests, builds, hooks, migrations or installation commands during a standalone review. Avoid read/diff commands that invoke configured project helpers. Use available source-reading alternatives or supplied evidence when safe inspection is unavailable. Missing test execution, failed scope checks and unavailable strict-runner sandbox support are coverage or readiness limitations; they do not prevent analysis of accessible code.

Challenge the implementation against the original intent and actual source. Trace realistic normal, failure, permission, boundary, retry and concurrency cases where applicable. Inspect relevant security, correctness, integration, testing, performance and maintainability concerns. Support each P0–P3 finding with its location, trigger, impact, evidence and smallest proposed remedy. Distinguish demonstrated defects from hypotheses; do not invent findings, a finding quota, test results or a guarantee that no bugs remain. On re-review, address earlier findings explicitly.

## Report and stop

State the actual execution mode, selected changes, examined files or behaviors, findings and coverage gaps. Distinguish source reasoning from recorded or executed checks. If source changes during analysis, identify affected conclusions as stale rather than certifying the new state. Missing evidence may make the report **PARTIAL** while useful findings are still returned.

```text
Changes review: COMPLETED | PARTIAL | NO CHANGES | NO SOURCE
Execution: fresh host reviewer | same-session analysis
Selection: <files/diff/range and comparison actually examined>
Findings: <severity, location, trigger, impact, evidence, proposed remedy>
Coverage: <examined behavior and relevant callers>
Checks: <existing evidence inspected; checks not executed during this review>
Gaps: <unavailable evidence or unexamined behavior, or none identified>
PR readiness: not assessed
```

Return the report and stop. Do not edit source, fix findings, change task/scope/queue records, import `quality-review --report`, grant a passing quality-review result, declare `READY TO OPEN PR` or mark a task `DONE`. Do not commit, push, change PRs, publish or dispatch CI/CD during this request. A later fix request resumes the normal scoped implementation workflow.

The strict PR-readiness review remains `.agent-core/bin/code-review.mjs` under `pre-pr-review.md`, with its existing task, scope, check, provider and sandbox requirements. Standalone analysis never supplies or replaces that approval evidence. A numerical review score, if requested, does not change this distinction.
