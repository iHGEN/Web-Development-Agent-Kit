---
name: csrf
description: Cross-site request forgery defenses for cookie-authenticated state changes.
---

# csrf

## Activate when

Cookie/session state-changing requests.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Use framework anti-CSRF mechanisms where applicable.
- Use SameSite as defense-in-depth, not sole protection when threat model requires tokens/origin checks.
- Do not require CSRF tokens for bearer-token APIs that do not use ambient credentials.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
