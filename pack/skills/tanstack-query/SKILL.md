---
name: tanstack-query
description: TanStack Query server-state cache, query keys, mutations, invalidation, retries, and optimistic updates.
---

# tanstack-query

## Activate when

@tanstack/react-query or related package.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Treat query keys as stable contracts.
- Invalidate/update cache intentionally after mutations.
- Make optimistic updates reversible and failure-safe.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
