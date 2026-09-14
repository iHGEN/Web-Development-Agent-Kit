# Implementation-First Work Policy

This rule is provider-neutral and applies to Codex, Claude, Gemini, and any other provider using Web Kit. It exists to prevent planning, routing, summaries, and handoffs from replacing implementation.

## Core rule

Planning is a means to implementation, not a deliverable.

Once current repository evidence supports the next safe change, **make that change**. Do not continue expanding analysis, planning, context, summaries, or alternatives unless doing so is necessary to prevent a material implementation mistake.

When choosing between:

1. another planning pass; and
2. a small reversible implementation plus a relevant check;

prefer the implementation plus check.

## Task-classification behavior

### SMALL

Default flow:

```text
targeted discovery -> implement -> test/check -> review diff -> validate -> done
```

Rules:
- no formal implementation plan;
- no Plan Validator by default;
- no Execution Registry ceremony for tiny sub-actions;
- route directly to the responsible implementer once the target is known;
- security-sensitive SMALL work may still require Security Review after implementation.

### MEDIUM

Default flow:

```text
targeted discovery -> 3-6 execution bullets -> implement -> test -> relevant review -> validate -> done
```

Rules:
- one short planning pass;
- maximum six execution bullets unless the task is reclassified LARGE;
- begin implementation immediately after the short plan;
- independent Plan Validator is optional and only justified by material risk;
- do not split one coherent implementation into separately approved file-level mini-projects.

### LARGE / HIGH-RISK

Use formal discovery, architecture/impact analysis, a validated plan, implementation routing, specialist gates, and final integration validation.

High-risk includes material changes to security boundaries, public contracts, data/schema/migrations, major dependencies, deployment/release architecture, or destructive operations.

## Agent routing

Agent routing remains mandatory where useful, but route by **required expertise**, not ceremony.

Good:

```text
Captain -> Bug Hunter -> Backend Developer -> relevant tests/review
```

Avoid routing through planner/architect/validator roles when the task does not need those capabilities.

Installed agents are available capabilities, not mandatory lifecycle stops.

## Anti-slop guard

After initial discovery, two consecutive cycles may not contain only planning, routing, summaries, handoffs, or other prose-only meta-work.

A normal productive cycle should produce at least one concrete evidence class:
- repository diff / implementation change;
- test added or changed;
- build/static-check/test result;
- migration/configuration/infrastructure change;
- runtime evidence;
- independently verified review result;
- genuine blocker that requires user/permission/external dependency.

Two consecutive post-discovery meta-only cycles are a workflow violation. Route the next cycle to `IMPLEMENTING` and perform the next evidence-supported change.

## Work ratio

For normal implementation work target:

```text
implementation + verification: 80-90%
planning + routing + summaries: 10-20%
```

This is a diagnostic target, not an excuse to skip required safety work.

Use `.agent-core/bin/work-progress.mjs` to record cycle categories and evidence. `prose-only` progress is not implementation progress.

## Progress authority

Task progress and application/project status are separate.

- **Job progress** = state of the current user task.
- **Project status** = evidence-backed state of the whole application/project.

Planning must contribute little to task completion percentage. Implementation, tests, review evidence, and final validation carry most of the progress weight.

Managed state:

```text
.agent-core/state/jobs/<task-id>.json
.agent-core/state/project-status.json
.agent-core/state/metrics/workflow-efficiency.json
```

Do not claim project completion percentages from intuition. Project-status updates require concrete evidence.

## Plan Delta threshold

Do not reopen planning for ordinary implementation details.

A Plan Delta is justified only when new verified evidence materially changes one or more of:
- architecture/ownership boundary;
- public API or cross-component contract;
- database/schema/migration strategy;
- security/trust boundary;
- major dependency or platform choice;
- destructive or deployment behavior;
- requested product scope.

Variable names, helper reuse, minor file movement, local test adjustments, or ordinary implementation discoveries do not justify a Plan Delta.

## Output economy

Keep coordination terse.

Do not:
- restate the user request repeatedly;
- narrate routine repository searches;
- summarize the same decision in multiple artifacts;
- create documentation about implementation before implementation exists;
- produce a new plan when the next implementation action is already known.

Status updates should normally contain only:
- what changed;
- what passed/failed;
- the exact next action;
- a real blocker when present.

## Security Review

`run security-review` remains an independent, read-only review of **implemented code**.

Security Review must not become a planning gate before normal implementation. Run it after implementation/tests when:
- the changed attack surface is security-sensitive; or
- a full release/final security gate requires it.

Security findings are routed to the appropriate implementation agent, fixed, tested, and independently re-reviewed until resolved.

`--scan-only` remains informational/inconclusive and must never grant approval.
