# Mandatory Web Engineering Workflow

## Phase 0 — Intake

Captain records the original user request verbatim.

## Phase 0.5 — Route Initial Context

Repository Indexer supplies structural metadata.
Context Router classifies task size and creates the smallest initial Context Packet.
No worker gets unrestricted repository context.

## Phase 1 — Intent Enhancement

Clarify ambiguous wording only when the repository can resolve it safely.
Produce:
- original prompt;
- normalized goal;
- explicit success criteria;
- preserve list;
- non-goals;
- unresolved assumptions.

Do not broaden scope.

## Phase 2 — Read-only Discovery

Start from feature entry points and trace only relevant dependencies.

Search before create:
- existing routes/endpoints;
- existing services;
- existing repositories/data-access;
- existing UI components;
- existing validation;
- existing authentication/authorization;
- existing tests;
- framework-native behavior;
- existing configuration/infrastructure.

Produce evidence with file paths and symbols.

## Phase 3 — Impact Analysis

Map components that may need modification and why.
Separate:
- definitely affected;
- potentially affected;
- explicitly unaffected.

## Phase 4 — Implementation Design

Choose the smallest coherent design that follows existing project ownership.

## Phase 5 — Execution Registry

Register every code-changing step before code changes.

## Phase 6 — Plan Validation

Plan Validator independently verifies necessity and scope.

## Phase 7 — Implementation

Execute only approved steps.
Validate each step before moving to dependent steps.

## Phase 8 — Simplification

Refactor for clarity and maintainability without changing requested behavior.

## Phase 9 — Independent Reviews

Run relevant gates:
- tests;
- code review;
- security;
- performance where material;
- bug hunting.

## Phase 10 — Final Handoff

Final Validator confirms:
- original intent is satisfied;
- approved plan was followed or validly revised;
- no unresolved failed handoff exists;
- build/tests expected for the change pass;
- known limitations are reported.

Captain provides final status.
