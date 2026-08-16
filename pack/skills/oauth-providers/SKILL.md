---
name: oauth-providers
description: Provider-specific social login connection, account linking, scopes, and provider failure behavior.
---

# oauth-providers

## Activate when

Google/Microsoft/GitHub/etc login.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Request minimum scopes.
- Handle account linking/collision explicitly.
- Treat provider identity as authentication input, not local authorization policy.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
