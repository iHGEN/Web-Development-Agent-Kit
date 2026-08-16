---
name: csharp
description: C# nullability, async, lifetime/disposal, language conventions, and maintainable backend design.
---

# csharp

## Activate when

.cs/.csproj or .NET project.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Respect nullable reference settings and analyzers.
- Use async all the way for I/O and propagate cancellation where established.
- Dispose owned resources correctly and avoid unnecessary interfaces/inheritance.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
