---
name: ai-api-integration
description: LLM/AI API boundary, prompt/data privacy, retries, streaming, schema validation, cost, and fallback.
---

# ai-api-integration

## Activate when

AI model/API feature.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Treat model output as untrusted data.
- Bound input/output/cost/timeouts and handle partial streams.
- Do not expose provider secrets or send sensitive data without an explicit product requirement.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
