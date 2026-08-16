# Canonical Web Engineering Workflow

This file is the **single authoritative lifecycle** for the Web Development Agent Kit.

Shorter checklists may summarize one phase, but they MUST NOT replace or bypass this workflow.

## Phase 0 — User Intake

**Owner:** Web Orchestrator / Captain

1. Receive the user request.
2. Record the original prompt verbatim before interpretation.
3. Keep the original prompt attached to the task for the entire lifecycle.

The original user request is authoritative over all later interpretations.

## Phase 1 — Task Classification

**Owner:** Captain

Classify the task as `SMALL`, `MEDIUM`, or `LARGE`.

Classification controls:
- initial discovery breadth;
- context/token budget;
- expected dependency depth;
- likely agent team;
- validation depth.

Classification does not change user scope.

## Phase 2 — Repository Index

**Owner:** Repository Indexer

Build or reuse a lightweight structural repository index.

Index structure and metadata first:
- project/package roots;
- manifests;
- languages/framework evidence;
- test roots;
- migration/data roots;
- infrastructure/config roots;
- likely feature entry points;
- existing task-local summaries.

Do not ingest the whole source tree into agent context.

## Phase 3 — Initial Context Routing

**Owner:** Context Router / Token Governor

Create the smallest discovery Context Packet needed to understand the request safely.

Route only:
- relevant slice of the original user intent;
- structural index facts;
- likely entry points/candidate symbols;
- relevant detected project skills;
- context budget and expansion policy.

No worker receives unrestricted repository context.

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

Search before creating anything new:
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

Record evidence using paths and symbols.

Do not edit files, install dependencies, refactor, rename, or generate implementation during discovery.

## Phase 6 — Impact Map

Separate and document:
- **definitely affected** areas;
- **potentially affected** areas;
- **intentionally untouched** areas.

For every proposed impact, record why repository evidence connects it to the user request.

## Phase 7 — Implementation Design

Design the **smallest coherent implementation** that satisfies the Intent Contract and fits existing ownership boundaries.

Prefer:
- extending existing owners;
- framework-native capabilities already used by the project;
- existing contracts and conventions;
- minimal new abstractions.

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

## Phase 9 — Plan Validation Loop

**Owner:** Independent Plan Validator

For every step classify:
- `APPROVED`
- `REVISE`
- `REJECTED`
- `UNNECESSARY`
- `MISSING_DEPENDENCY`

Validator checks:
- necessity against original intent;
- repository evidence;
- ownership correctness;
- duplication;
- unnecessary abstraction/refactoring;
- missing dependencies/tests;
- sequence safety;
- meaningful validation;
- scope creep.

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
- exact candidate files/symbols/contracts;
- compact verified discovery findings;
- relevant downstream contract;
- active skills needed by the selected worker;
- step validation requirements;
- context budget.

Do not forward the full discovery transcript or all installed skills.

## Phase 12 — Implement One Approved Step

**Owner:** Captain-selected worker agent

The worker:
- implements only the current approved step;
- stays inside the routed context and approved scope;
- may request specific evidence-backed context expansion;
- records actual files/symbols changed and validation performed.

## Phase 13 — Handoff Validation Loop

**Owner:** Independent Handoff Validator

After every code-changing step and every agent handoff, compare:
- approved step;
- actual diff;
- changed symbols;
- claimed behavior;
- relevant build/lint/static checks;
- relevant tests;
- downstream interface/contract;
- approved scope.

### FAIL

Return exact evidence to the responsible worker. The worker fixes the issue and resubmits the handoff.

### PASS

The Captain may route the next registered step.

Dependent work must not consume an unvalidated handoff.

## Phase 14 — Repeat for Every Registered Step

For each remaining step:

`Context Router -> Selected Worker -> Implement Step -> Handoff Validator`

The next step begins only after its dependencies have passed handoff validation.

## Phase 15 — Plan Delta Loop

If implementation discovers new repository evidence that materially invalidates the locked plan:

1. Stop the affected step.
2. Record the new evidence.
3. Propose a Plan Delta describing additions/removals/changes.
4. Return the delta to the independent Plan Validator.
5. Validate the delta using the same plan criteria.
6. Relock the new plan version.
7. Route fresh context and continue.

Never silently improvise outside the locked plan.

## Phase 16 — All Registered Steps Pass

Whole-feature post-implementation work begins only when every required implementation step has passed independent handoff validation.

## Phase 17 — Code Simplification

**Owner:** Code Simplifier / Maintainability Refactorer

Review the completed changed scope for:
- readability;
- maintainability;
- flexibility at real extension points;
- cohesion;
- coupling;
- naming;
- unnecessary nesting/indirection;
- meaningful duplication;
- dead/redundant code;
- speculative abstraction.

Preserve requested behavior and approved public contracts.
Do not conduct unrelated cleanup.

## Phase 18 — Re-run Affected Tests

After simplification, rerun the tests/checks necessary to prove behavior was preserved.

## Phase 19 — Specialized Validation

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

## Phase 20 — Final Integration Validation

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

Individually passing components are not sufficient if the integrated result is inconsistent.

## Phase 21 — Final Failure Recovery Loop

If Final Integration Validation fails:

1. Identify the agent/ownership boundary responsible for each failure.
2. Context Router creates a minimal failure-specific packet.
3. Responsible agent fixes only the failure scope.
4. Handoff Validator independently validates the fix.
5. Rerun only affected downstream specialist validation.
6. Re-enter Final Integration Validation.

Do not restart unrelated work from zero.

## Phase 22 — Final Pass and Captain Closure

After Final Integration Validator returns `PASS`:

Captain:
- compares the final state against the original verbatim user prompt;
- confirms all required acceptance criteria are satisfied;
- reports known limitations or intentionally deferred non-goals;
- declares `DONE`.

## Continuous Context/Token Routing

The Context Router / Token Governor runs throughout the lifecycle, not only once.

It is invoked:
- before discovery;
- before each implementation step;
- for evidence-backed context expansion;
- before specialist validation when required;
- during handoff/failure recovery when new context is necessary.

Rules:
- default deny arbitrary repository reads;
- prefer `index -> search -> symbol/range -> full file -> evidence-backed dependency expansion`;
- installed skill != active skill;
- compact findings/handoffs instead of forwarding full transcripts;
- reuse evidence-linked summaries when sufficient;
- validate diffs first after implementation;
- never save tokens by omitting context required for correctness, security, or user intent.
