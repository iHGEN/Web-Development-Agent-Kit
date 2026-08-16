---
name: retry-resilience
description: Timeouts, retries, backoff, jitter, circuit/bulkhead patterns, and partial failure.
---

# retry-resilience

## Activate when

External/network/transient failure handling.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Retry only transient/idempotent-safe operations.
- Always pair retries with timeouts and bounds.
- Use jitter/backoff to avoid synchronized retry storms.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
