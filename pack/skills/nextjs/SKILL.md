---
name: nextjs
description: Next.js App/Pages Router, server/client boundaries, routing, rendering, caching, and deployment conventions.
---

# nextjs

## Activate when

next dependency.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Detect App Router vs Pages Router and follow existing conventions.
- Keep secrets/server-only logic out of client components/bundles.
- Treat cache/revalidation/rendering choices as behavior.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
