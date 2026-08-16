---
name: backward-compatibility
description: Compatibility strategy for APIs, schemas, events, config, and persisted data.
---

# backward-compatibility

## Activate when

Existing public/internal contracts are changed.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Identify consumers before breaking a contract.
- Prefer additive migrations/deprecation when continuity matters.
- Test old/new interaction during staged rollout where relevant.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
