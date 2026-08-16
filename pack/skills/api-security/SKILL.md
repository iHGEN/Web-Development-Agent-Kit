---
name: api-security
description: API-specific object/function authorization, resource consumption, inventory, SSRF, and unsafe upstream consumption.
---

# api-security

## Activate when

Public/private APIs, integrations, API review.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Check object-level and function-level authorization.
- Bound expensive resource usage.
- Treat upstream API responses/configuration as untrusted.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
