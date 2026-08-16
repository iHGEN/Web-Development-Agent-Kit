---
name: s3
description: Amazon S3-compatible object storage, multipart uploads, presigned URLs, metadata, and lifecycle.
---

# s3

## Activate when

S3 SDK/config.

## Core rules

- Follow existing project conventions before introducing a new pattern.
- Keep changes scoped to the approved plan and user intent.
- Prefer simple, explicit, testable behavior over clever abstraction.
- Preserve compatibility unless the user explicitly requests a breaking change.
- Use presigned URLs with narrow scope/expiry when direct upload/download fits.
- Use multipart upload for large objects and clean abandoned parts.
- Keep bucket/object policy least-privilege.

## Routing / context discipline

- Load this skill only when the current agent/task needs it.
- Prefer repository/project-version conventions over generic examples.
- For version-sensitive APIs, verify against the project's installed version and official documentation before introducing new APIs.
- Do not broaden the approved implementation scope merely because this skill contains related best practices.

## Validation

Before handoff, verify the changed behavior with the project's existing build/lint/test tools appropriate to this skill and record concrete evidence.
