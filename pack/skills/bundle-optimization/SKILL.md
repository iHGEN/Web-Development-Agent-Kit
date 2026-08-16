---
name: bundle-optimization
description: Frontend bundle analysis, code splitting, dependency cost, tree shaking, and lazy loading.
---

# bundle-optimization

## Activate when

Large JS bundle/startup.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Use bundle analyzer evidence.
- Remove/replace large dependency only if user impact justifies it.
- Split at meaningful route/feature boundaries without waterfall regressions.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
