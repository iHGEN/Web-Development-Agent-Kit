---
name: file-upload-security
description: Upload type/size/name/storage/scanning/access controls and image/document processing risks.
---

# file-upload-security

## Activate when

File uploads/imports.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Validate size/content/type server-side and generate safe storage names.
- Store outside executable/public paths unless explicitly safe.
- Authorize download/access independently of unguessable names.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
