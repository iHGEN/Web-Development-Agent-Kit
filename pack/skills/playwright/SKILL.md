---
name: playwright
description: Playwright locators, isolation, auto-waiting, browser projects, traces, and E2E practices.
---

# playwright

## Activate when

@playwright/test/playwright.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Prefer role/label/test-id locators over fragile DOM structure.
- Use web-first assertions/auto-waiting instead of fixed sleeps.
- Keep tests isolated and use traces/screenshots for diagnosis.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
