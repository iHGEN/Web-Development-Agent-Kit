---
name: rate-limiting
description: Rate limits, quotas, abuse prevention, distributed enforcement, and user feedback.
---

# rate-limiting

## Activate when

Auth, expensive/public APIs, abuse-sensitive actions.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Choose keys/buckets from threat and product semantics.
- Avoid trusting spoofable identifiers alone.
- Make distributed limit state and retry feedback explicit.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
