# Canonical Web Engineering Workflow

This file is the **single authoritative lifecycle** for the Web Development Agent Kit.

Shorter checklists may summarize one phase, but they MUST NOT replace or bypass this workflow.

The lifecycle has two repository-navigation modes:
- `standard` — lightweight project profile/index/search/symbol routing;
- `graphify-assisted` — a fresh Graphify project graph is used to narrow repository exploration before exact source verification.

Graphify is a navigation and relationship aid. Current repository source, current diffs, tests, and runtime evidence remain authoritative.

## Phase 0 — User Intake

**Owner:** Web Orchestrator / Captain

1. Receive the user request.
2. Record the original prompt verbatim before interpretation.
3. Keep the original prompt attached to the task for the entire lifecycle.

The original user request is authoritative over all later interpretations.

## Phase 1 — Task Classification

**Owner:** Captain

Classify the task as `SMALL`, `MEDIUM`, or `LARGE`.

Classification controls discovery breadth, context/token budget, expected dependency depth, likely agent team, and validation depth. It does not change user scope.

Assign a task ID that is reused by the Graph Refresh Gate and task-local fallback state.

## Phase 2 — Repository Navigation Mode, Freshness, and Index

**Owner:** Repository Indexer + Context Router

Read the generated project profile first, including `capabilities.graphify`.

Always build or reuse the lightweight structural repository index so the workflow has a cheap deterministic fallback.

### Standard branch

Use standard routing when:
- Graphify is not detected;
- Graphify configuration exists but `graphify-out/graph.json` is not ready;
- Graphify refresh/query capability is unavailable;
- the Graph Refresh Gate reports standard fallback for the current task;
- Graphify evidence is stale/incomplete for the needed decision or conflicts with current source.

Preferred progression:

`project profile -> repository index -> targeted search -> exact symbol/range -> full file only when needed -> evidence-backed dependency expansion`

### Graphify-assisted branch

When the generated profile reports a ready Graphify graph, **do not query it before confirming freshness**.

Before the first Graphify query for the task, run:

```bash
python .agent-core/rules/graphify-refresh.py --project . --task-id <task-id>
```

The gate writes:

```text
.agent-core/state/graphify.json
```

Use Graphify only when the state reports:
- `routing_mode: graphify-assisted`;
- `dirty: false`.

The gate fingerprints the relevant repository state. The first use of an untracked freshness state causes one incremental refresh. Later calls skip Graphify when the repository state is unchanged.

When fresh, use Graphify only to reduce repository exploration, for example to:
- locate feature owners and likely entry symbols;
- inspect direct callers/callees/neighbors;
- trace a relationship path between relevant concepts;
- identify a small affected relationship/community slice;
- map changed symbols to nearby contracts during validation.

Do not load the complete Graphify graph into model context.

Before planning, editing, or asserting behavior, verify the relevant exact source symbol/range. Graph relationships are routing evidence, not behavioral proof.

If refresh/query fails, times out, is unavailable, or cannot safely answer the routing question, record task-local fallback and continue with the standard branch. Do not repeatedly retry a failed Graphify capability in the same task unless explicitly requested.

Preferred progression:

`project profile -> Graph Refresh Gate -> narrow Graphify query/path/neighbors -> small candidate symbol set -> exact source symbol/range -> targeted search for gaps -> full file only when needed -> evidence-backed expansion`

## Phase 3 — Initial Context Routing

**Owner:** Context Router / Token Governor

Create the smallest discovery Context Packet needed to understand the request safely.

Route only:
- relevant slice of the original user intent;
- selected repository-navigation mode;
- Graphify freshness/fallback state when relevant;
- structural index facts still needed;
- compact Graphify findings when actually used;
- likely entry points/candidate symbols;
- relevant detected project skills;
- context budget and expansion/fallback policy.

No worker receives unrestricted repository context or the full Graphify graph.

## Phase 4 — Intent Clarification

**Owner:** Intent & Discovery Agent

Enhance clarity only.

Produce an **Intent Contract** containing:
- original prompt verbatim;
- normalized goal;
- success criteria;
- constraints;
- must-preserve behavior;
- assumptions;
- non-goals.

Never change meaning, scope, requested outcome, or constraints for implementation convenience.

## Phase 5 — Read-only Discovery

**Owner:** Intent & Discovery Agent, with Architect/specialists only when needed

Discovery is strictly read-only.

Start from the requested feature entry points and expand only to dependencies that could realistically be touched or are necessary to understand/validate the feature.

In `graphify-assisted` mode, use only fresh narrow graph relationships to choose what source to inspect first. In `standard` mode, or when graph evidence is insufficient, use targeted repository search.

Search/verify before creating anything new:
- existing functions and utilities;
- services;
- routes/endpoints;
- UI components;
- APIs/contracts;
- models/entities/schema;
- repositories/data access;
- validation;
- authentication/authorization;
- tests;
- configuration/infrastructure;
- conventions and ownership boundaries;
- framework-native capabilities.

Record evidence using current paths and symbols. Distinguish graph-derived routing evidence from source-verified behavioral evidence.

Do not edit files, install dependencies, refactor, rename, or generate implementation during discovery.

## Phase 6 — Impact Map

Separate and document:
- **definitely affected** areas;
- **potentially affected** areas;
- **intentionally untouched** areas.

For every proposed impact, record why repository evidence connects it to the user request.

Graphify may identify likely callers, dependents, paths, or neighboring contracts, but every material impact that drives implementation must be confirmed from current source/contracts/tests.

## Phase 7 — Implementation Design

Design the **smallest coherent implementation** that satisfies the Intent Contract and fits existing ownership boundaries.

Prefer extending existing owners, framework-native capabilities already used by the project, existing contracts/conventions, and minimal new abstractions.

Do not create parallel services/components/repositories solely to avoid understanding current code.

## Phase 8 — Execution Registry

Before any code change, register every code-changing step.

Each step MUST contain:
- step ID;
- objective/action;
- repository evidence;
- why the step is necessary;
- expected files/components/symbols;
- dependencies;
- behavior change;
- risk;
- validation required;
- intended downstream handoff when relevant.

Plan status remains `DRAFT` until independently validated.

Graphify-only conclusions are not sufficient repository evidence for a code-changing step; relevant source/contract evidence must be verified.

## Phase 9 — Plan Validation Loop

**Owner:** Independent Plan Validator

For every step classify:
- `APPROVED`
- `REVISE`
- `REJECTED`
- `UNNECESSARY`
- `MISSING_DEPENDENCY`

Validator checks necessity against original intent, repository evidence, ownership correctness, duplication, unnecessary abstraction/refactoring, missing dependencies/tests, sequence safety, meaningful validation, and scope creep.

Any required non-approved step returns to planning for revision and then re-enters Plan Validation.

**No application/infrastructure implementation is allowed while required steps are not approved.**

## Phase 10 — Lock Plan

When every required registered step is approved:
- set plan status to `APPROVED/LOCKED`;
- record plan version;
- implementation permission begins.

A locked plan defines what is allowed to change. It is not permission to improvise.

## Phase 11 — Per-step Context Routing

Before every approved implementation step, the Context Router creates a **fresh implementation Context Packet** for that step only.

Packet includes only:
- relevant original intent/acceptance criteria;
- approved step;
- selected repository-navigation mode;
- Graphify freshness state when relevant;
- exact candidate files/symbols/contracts;
- compact verified discovery findings;
- only relevant fresh Graphify relationship evidence when useful;
- relevant downstream contract;
- active skills needed by the selected worker;
- step validation requirements;
- context budget and fallback policy.

If Graphify is about to be queried and freshness is not already proven for the current repository fingerprint, run the Graph Refresh Gate first.

Do not forward the full discovery transcript or all installed skills.

## Phase 12 — Implement One Approved Step

**Owner:** Captain-selected worker agent

The worker:
- implements only the current approved step;
- stays inside the routed context and approved scope;
- may request specific evidence-backed context expansion;
- runs the step-local checks/tests required by the plan;
- records actual files/symbols changed and validation performed.

## Phase 13 — Graph Refresh Gate

This phase is **mandatory after every completed code-changing agent step** when a ready Graphify graph exists. It occurs **before Handoff Validator or another agent relies on Graphify**.

Run exactly once for the completed repository state:

```bash
python .agent-core/rules/graphify-refresh.py --project . --task-id <task-id>
```

The gate behavior is:

```text
no Graphify graph
  -> standard mode, continue

repository fingerprint unchanged since last successful refresh
  -> skip Graphify update
  -> graphify-assisted remains fresh

repository fingerprint changed
  -> run one `graphify update .`

refresh succeeds
  -> write fresh fingerprint/state
  -> graphify-assisted may continue

CLI missing / refresh fails / timeout
  -> write task-local fallback state
  -> standard mode
  -> continue workflow without blocking
```

The managed state file is `.agent-core/state/graphify.json`.

Do not refresh after every individual file write. Refresh once after the worker finishes the approved step and its local validation.

This rule also applies to later code-changing stages such as Code Simplifier changes, failure-recovery fixes, security fixes, and final-integration fixes.

## Phase 14 — Handoff Validation Loop

**Owner:** Independent Handoff Validator

After the Graph Refresh Gate, compare:
- approved step;
- actual diff;
- changed symbols;
- claimed behavior;
- relevant build/lint/static checks;
- relevant tests;
- downstream interface/contract;
- approved scope.

If Graphify-assisted mode remains fresh, the validator may query a small relationship slice around changed symbols to locate potentially affected callers/contracts, then verifies any material finding against current source/diff/tests.

### FAIL

Return exact evidence to the responsible worker. The worker fixes only the failure scope, reruns step-local validation, then re-enters **Phase 13 Graph Refresh Gate** before resubmitting the handoff.

### PASS

The Captain may route the next registered step.

Dependent work must not consume an unvalidated handoff.

## Phase 15 — Repeat for Every Registered Step

For each remaining step:

`Context Router -> Selected Worker -> Implement Step -> Graph Refresh Gate -> Handoff Validator`

The next step begins only after its dependencies have passed handoff validation.

## Phase 16 — Plan Delta Loop

If implementation discovers new repository evidence that materially invalidates the locked plan:

1. Stop the affected step.
2. Record the new evidence.
3. Propose a Plan Delta describing additions/removals/changes.
4. Return the delta to the independent Plan Validator.
5. Validate the delta using the same plan criteria.
6. Relock the new plan version.
7. Route fresh context and continue.

Never silently improvise outside the locked plan.

A Graphify relationship that suggests new impact is a discovery lead; verify it from current source/contracts before using it as Plan Delta evidence.

## Phase 17 — All Registered Steps Pass

Whole-feature post-implementation work begins only when every required implementation step has passed independent handoff validation.

## Phase 18 — Code Simplification

**Owner:** Code Simplifier / Maintainability Refactorer

Review the completed changed scope for readability, maintainability, flexibility at real extension points, cohesion, coupling, naming, unnecessary nesting/indirection, meaningful duplication, dead/redundant code, and speculative abstraction.

Preserve requested behavior and approved public contracts. Do not conduct unrelated cleanup.

If the simplifier changes code, run **Phase 13 Graph Refresh Gate** once after simplifier validation before downstream reviewers use Graphify.

## Phase 19 — Re-run Affected Tests

After simplification, rerun the tests/checks necessary to prove behavior was preserved.

## Phase 20 — Specialized Validation

**Owner:** Captain routes only relevant independent specialists.

Possible gates include:
- Test / QA Engineer;
- Security Reviewer;
- Code Reviewer;
- Performance Reviewer when material;
- Accessibility Reviewer when UI/accessibility is affected;
- Bug Hunter;
- API Contract Reviewer when interfaces/contracts changed;
- DevSecOps Reviewer for delivery/infrastructure/security-sensitive pipeline changes;
- SRE/Reliability/Observability specialists when operational behavior changed;
- other domain specialists only when repository/task evidence requires them.

Do not run every specialist for every trivial task.

When Graphify-assisted mode is fresh, specialist reviewers may use narrow graph queries to discover relevant callers, boundaries, reachable components, or contracts around the final diff. All findings that affect PASS/FAIL must still be verified against current source/diff/tests.

If a specialist causes a code fix, the owning worker must run the Graph Refresh Gate before the fix is handed back for validation.

## Phase 21 — Final Integration Validation

**Owner:** Final Integration Validator

Validate the feature as a whole against:
- original Intent Contract;
- original prompt verbatim;
- final repository diff;
- approved Execution Registry and all Plan Deltas;
- cross-agent/cross-layer contracts;
- relevant build/tests/checks;
- migration/deployment impacts;
- integration behavior;
- unresolved handoffs;
- regression risks;
- known limitations.

Graphify may assist in locating cross-layer relationships only when the freshness state is clean. Final integration verdicts must be grounded in current repository evidence and test/build results.

## Phase 22 — Final Failure Recovery Loop

If Final Integration Validation fails:

1. Identify the agent/ownership boundary responsible for each failure.
2. Context Router creates a minimal failure-specific packet.
3. Responsible agent fixes only the failure scope.
4. Run the Graph Refresh Gate if code changed.
5. Handoff Validator independently validates the fix.
6. Rerun only affected downstream specialist validation.
7. Re-enter Final Integration Validation.

Do not restart unrelated work from zero.

## Phase 23 — Final Pass and Captain Closure

After Final Integration Validator returns `PASS`:

Captain:
- compares the final state against the original verbatim user prompt;
- confirms all required acceptance criteria are satisfied;
- reports known limitations or intentionally deferred non-goals;
- declares `DONE`.

## Continuous Context/Token Routing

The Context Router / Token Governor runs throughout the lifecycle, not only once.

It is invoked before discovery, before each implementation step, for evidence-backed context expansion, before specialist validation when required, and during handoff/failure recovery when new context is necessary.

### Standard routing progression

`project profile -> repository index -> targeted search -> symbol/range -> full file only when needed -> evidence-backed dependency expansion`

### Graphify-assisted routing progression

Use only when the generated project profile reports a ready graph **and** `.agent-core/state/graphify.json` reports a fresh graph:

`project profile -> Graph Refresh Gate -> narrow Graphify query/path/neighbors -> small candidate symbol set -> exact source symbol/range -> targeted search for gaps -> full file only when needed -> evidence-backed expansion`

### Continuous rules

- default deny arbitrary repository reads;
- Graphify available does not mean Graphify authoritative;
- Graphify ready does not mean Graphify fresh — enforce the refresh state;
- refresh once per completed changed repository state, not per file write;
- never load the complete Graphify graph into model context;
- verify behavior from current source before planning/editing;
- Graphify refresh/query failure must fall back to standard routing, not block the task;
- installed skill != active skill;
- compact findings/handoffs instead of forwarding full transcripts;
- reuse evidence-linked summaries when sufficient;
- validate diffs first after implementation;
- never save tokens by omitting context required for correctness, security, or user intent.
