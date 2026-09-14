# Canonical Web Engineering Workflow

This file is the **single authoritative lifecycle** for Web Kit. Supporting rules may add detail but must not contradict this workflow.

Repository navigation: `.agent-core/rules/repository-navigation.md`  
Implementation-first / anti-slop policy: `.agent-core/rules/implementation-first.md`  
Context rollover: `.agent-core/rules/context-rollover.md`  
Security review: `.agent-core/rules/security-review.md`

## Core operating principle

Web Kit exists to deliver working software, not workflow artifacts.

```text
evidence -> route the right agent -> implement -> verify -> track real progress -> continue
```

Planning, routing, handoffs, summaries, and validation metadata are support mechanisms. Once the next safe repository change is known, implementation begins.

## Runtime contract

Web Kit itself requires Node.js + npm only. Graphify remains optional and must never block standard routing. Current repository source, current diff, relevant tests/build/runtime evidence remain authoritative over indexes, graphs, plans, and handoffs.

## Phase 0 — Intake and job creation

**Owner:** Captain / Web Orchestrator

1. Preserve the original request.
2. Assign/reuse a task ID.
3. Classify `SMALL`, `MEDIUM`, or `LARGE`.
4. Escalate governance to formal/high-risk when the change materially touches security/trust boundaries, public contracts, schema/migrations, destructive operations, major dependencies, or release/deployment architecture.
5. Start evidence-based job tracking:

```bash
node .agent-core/bin/work-progress.mjs start \
  --task-id <task-id> \
  --classification <SMALL|MEDIUM|LARGE> \
  --title "<short task title>"
```

Use `--high-risk` when formal governance is required regardless of size.

Managed state:

```text
.agent-core/state/jobs/<task-id>.json
.agent-core/state/project-status.json
.agent-core/state/metrics/workflow-efficiency.json
```

Job progress and whole-project/application status are separate concepts.

## Phase 1 — Minimum repository navigation

**Owner:** Repository Indexer + Context Router as needed

Read the generated project profile first. Use the smallest evidence path that can answer the current question.

Direct source lookup:

```text
targeted current-source search -> exact file/symbol -> current source
```

Relationship/dependency/impact question with ready Graphify:

```text
Graph Refresh Gate -> narrow Graphify relationship query -> verify exact current source
```

Graphify is a navigation aid, never behavioral authority and never a blocker.

Stop discovery when the next safe implementation action is sufficiently supported. Do not continue repository exploration merely to increase certainty.

## Phase 2 — Classification-specific execution

### SMALL

Default lifecycle:

```text
targeted discovery -> implement -> local checks -> review diff -> final validation -> done
```

Rules:
- no formal plan;
- no Plan Validator by default;
- do not create an Impact Map/Execution Registry merely for ceremony;
- route directly to the responsible implementer once ownership/target is known;
- one coherent small change may be completed in one implementation unit.

A SMALL task that discovers material architectural/security/schema risk must be escalated.

### MEDIUM

Default lifecycle:

```text
targeted discovery -> 3-6 execution bullets -> implement coherent chunks -> test/review -> final validation -> done
```

Rules:
- one short planning pass only;
- maximum six execution bullets;
- begin implementation immediately after the short plan;
- independent Plan Validator is optional and used only when verified risk justifies it;
- do not split DTO/service/route/test or similar tightly related work into separately approved mini-projects unless independent risk requires it.

### LARGE / HIGH-RISK

Default lifecycle:

```text
discovery -> impact/design -> formal plan -> independent Plan Validator -> implementation routing -> handoff/specialist gates -> final validation
```

Formal planning remains appropriate here, but even LARGE tasks should plan only to the level required to safely implement. Planning is not rewarded for detail beyond executable necessity.

## Phase 3 — Agent routing

**Owner:** Captain + Context Router

Route by required expertise, not ceremony.

Examples:

```text
backend bug: Captain -> Bug Hunter -> Backend Developer -> relevant tests/review
UI feature: Captain -> Frontend Developer -> relevant tests/accessibility only when needed
schema change: Captain -> Database Engineer -> Backend/Integration as required -> validation
```

Installed agents are available capabilities, not mandatory stops.

Each worker receives the smallest Context Packet containing:
- relevant original intent/acceptance criteria;
- exact current task/chunk;
- relevant files/symbols/contracts;
- verified repository evidence;
- relevant Graphify evidence only when actually useful/fresh;
- required local validation;
- exact downstream contract when another worker depends on it.

Do not forward the full discovery transcript or every installed skill.

## Phase 4 — Implementation-first execution

**Owner:** routed implementation agent

The worker:
- makes the next evidence-supported repository change;
- keeps changes within user scope and existing ownership boundaries;
- prefers existing owners/framework capabilities over parallel abstractions;
- runs relevant local checks/tests;
- records actual changed files/symbols and validation evidence;
- continues through a coherent implementation chunk instead of stopping after every tiny file-level action.

When uncertain between another planning pass and a small reversible implementation plus a check, prefer the implementation plus check.

Record meaningful cycles:

```bash
node .agent-core/bin/work-progress.mjs cycle \
  --task-id <task-id> \
  --kind implementation \
  --evidence "<concrete diff/test/runtime evidence>"
```

Update observable job state as work changes:

```bash
node .agent-core/bin/work-progress.mjs update \
  --task-id <task-id> \
  --status IMPLEMENTING \
  --agent <role> \
  --implementation-total <n> \
  --implementation-completed <n> \
  --files-changed <n> \
  --next "<exact next action>" \
  --evidence "<evidence>"
```

## Phase 5 — Anti-slop guard

After initial discovery, two consecutive cycles may not contain only planning, routing, summaries, handoffs, or prose without concrete implementation/verification evidence.

Useful evidence includes:
- repository diff/change;
- test added/changed;
- build/static/test result;
- migration/config/infrastructure change;
- runtime evidence;
- independent review result;
- genuine user/permission/external blocker.

Record meta-only cycles honestly:

```bash
node .agent-core/bin/work-progress.mjs cycle --task-id <task-id> --kind prose
```

For plan-free work, or work whose required plan is already approved, two consecutive post-discovery meta-only cycles force the job back to `IMPLEMENTING`. If a required short/formal plan is not yet approved, the guard stops further plan expansion and requires the smallest allowed plan/approval to complete before implementation begins.

Target diagnostic ratio for normal work:

```text
implementation + verification: 80-90%
planning + routing + summaries: 10-20%
```

Required safety work is never skipped merely to improve the ratio.

## Phase 6 — Plan validation (only when required)

**Owner:** Independent Plan Validator

Formal plan validation is mandatory for LARGE/high-risk work and optional for MEDIUM work only when verified risk warrants it.

Validate material implementation chunks, not every file edit.

The validator checks necessity, ownership, duplication, sequence, contract/schema/security effects, validation sufficiency, and scope creep.

Do not expand an already executable plan into more ceremony. A validator must never implement or self-approve authored work.

## Phase 7 — Plan Delta threshold

Do not reopen planning for ordinary implementation details.

A Plan Delta is justified only when verified new evidence materially changes:
- architecture/ownership;
- public API/cross-component contract;
- database/schema/migration strategy;
- security/trust boundary;
- major dependency/platform choice;
- destructive/deployment behavior;
- requested product scope.

Helper reuse, variable naming, normal local refactoring, ordinary test adjustments, or discovering a better existing utility do not justify a Plan Delta.

## Phase 8 — Graph Refresh Gate

When a ready Graphify graph exists and a completed code-changing chunk materially changes repository relationships, refresh once after the chunk before downstream work relies on Graphify:

```bash
node .agent-core/rules/graphify-refresh.mjs --project . --task-id <task-id>
```

Do not refresh after every individual file write. Failure/unavailability falls back to standard navigation and must not block implementation.

## Phase 9 — Testing and reviews

Move the job through evidence-backed states such as:

```text
IMPLEMENTING -> TESTING -> REVIEWING -> FIXING (only when needed) -> VALIDATING
```

Update test/build evidence with `work-progress.mjs update`.

Only invoke specialist reviewers relevant to the changed surface. Code Simplifier, performance, accessibility, API-contract, DevSecOps, SRE, etc. are targeted capabilities, not mandatory universal stages.

Validation should inspect the actual diff/results; it should not recreate the original task analysis.

## Phase 10 — Security Review

`run security-review` remains an independent, read-only review of implemented code.

Run it after implementation/tests when:
- the change affects authentication/authorization, sessions/tokens, API trust boundaries, database/data isolation, uploads/filesystem, payments, secrets, dependencies, CI/CD, containers/cloud/IaC, outbound network/webhooks, or another meaningful attack surface; or
- a release/final security gate requires a full review.

Flow:

```text
implemented code -> tests -> security-review -> findings?
  yes -> route findings to responsible developer -> fix/test -> independent re-review
  no  -> continue final validation
```

The Security Reviewer does not fix its own findings. `--scan-only` remains `INCONCLUSIVE` and cannot grant approval.

Release-level work requires a full approving Security Review before version/tag/publish actions.

## Phase 11 — Job progress and project/application status

Progress percentages are evidence-weighted, not prose-weighted.

Default weights:

```text
SMALL:  discovery 5 | implementation 70 | testing 15 | review 5 | validation 5
MEDIUM: discovery 10 | planning 5 | implementation 60 | testing 15 | review 5 | validation 5
LARGE:  discovery 10 | planning 15 | implementation 45 | testing 15 | review 10 | validation 5
```

A detailed plan cannot make an unimplemented task appear mostly complete.

Project/application status is maintained separately and requires evidence:

```bash
node .agent-core/bin/work-progress.mjs project-update \
  --area backend \
  --progress 65 \
  --status ACTIVE \
  --evidence "TASK-042: cancellation endpoint implemented; 14/14 tests passing"
```

Do not invent application-completion percentages from intuition.

## Phase 12 — Context rollover

Context rollover changes provider-session lifetime only. It does not reset job/workflow state.

At a safe boundary:

```text
finish coherent work/check -> persist compact progress -> handoff exact next action -> fresh context -> verify current repo -> continue exact next action
```

A fresh context must not restart discovery or recreate an approved/short plan unless current repository evidence materially invalidates it.

Handoffs should stay compact: task ID, classification/status, completed work, current diff/test evidence, active agent, next action, blockers.

Current source/diff/tests/runtime override handoff summaries.

### Explicit Session Controller interpretation

The older explicit `.agent-core/bin/session-controller.mjs` may describe one "safe workflow unit" per controller cycle. Interpret that unit using this canonical classification, not as a universal planning gate:

- `SMALL`: once the implementation target is known, the next safe unit is a coherent implementation change plus its required local check; an "approved implementation step" does **not** create a plan requirement for SMALL work.
- `MEDIUM`: at most one short 3–6 bullet planning unit is allowed before implementation units begin.
- `LARGE/high-risk`: formal plan/approval units remain valid where required.
- A fresh controller cycle must read current job state and exact next action. It must not repeat discovery/planning merely because the provider process/session is fresh.
- If the anti-slop guard is active, honor its forced next phase and do not choose another prose-only unit.

The explicit controller's one-unit boundary limits session batching; it does not override this implementation-first lifecycle.

## Phase 13 — Final validation and completion

A job may be `DONE` only when:
- requested behavior is implemented;
- relevant tests/build/checks pass or limitations are explicitly accepted by the user;
- required specialist/security reviews pass;
- final integrated state satisfies the original request;
- final validation is recorded as `PASS`.

Then:

```bash
node .agent-core/bin/work-progress.mjs update \
  --task-id <task-id> \
  --final-validation PASS \
  --status DONE \
  --evidence "<final validation evidence>"
```

Update relevant project/application areas from concrete completed evidence.

## Output economy

Agent updates are terse. Prefer edits, tests, and tool evidence over narration.

Normal status update:

```text
Changed: <what changed>
Validation: <pass/fail evidence>
Next: <exact next action>
```

Do not repeatedly restate the request, narrate routine searches, summarize the same decision in several artifacts, or create implementation documentation before the implementation exists.
