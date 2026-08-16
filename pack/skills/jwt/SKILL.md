---
name: jwt
description: JWT validation, claims, signing keys, expiry, audience/issuer, and misuse prevention.
---

# jwt

## Activate when

JWT-based auth.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Validate signature, algorithm, issuer, audience, and time claims.
- Keep claims minimal and do not treat a token as revocable unless architecture supports it.
- Protect key rotation and clock-skew behavior.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
