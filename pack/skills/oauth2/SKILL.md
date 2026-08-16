---
name: oauth2
description: OAuth 2.0 authorization flows, clients, scopes, PKCE, redirects, and token handling.
---

# oauth2

## Activate when

OAuth client/resource server integration.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Use the correct grant/flow for client type.
- Use PKCE/state and exact redirect validation where applicable.
- Keep provider tokens server-side when client exposure is unnecessary.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
