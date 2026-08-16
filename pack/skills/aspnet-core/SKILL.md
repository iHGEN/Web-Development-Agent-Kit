---
name: aspnet-core
description: ASP.NET Core hosting, DI, middleware, endpoints/controllers, authorization, async I/O, config, and testing.
---

# aspnet-core

## Activate when

Microsoft.NET.Sdk.Web / ASP.NET Core references.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Respect service lifetimes and middleware order.
- Use server-side authorization policies/handlers at authoritative boundaries.
- Avoid blocking async request paths and unsafe fire-and-forget work.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
