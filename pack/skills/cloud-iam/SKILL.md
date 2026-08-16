---
name: cloud-iam
description: Cloud identity, service identities, roles, policies, and least privilege.
---

# cloud-iam

## Activate when

Cloud IAM changes.

## Core rules

- Follow the repository's existing platform and deployment conventions before introducing a new tool.
- Keep changes within the approved execution plan and original user intent.
- Prefer reversible, observable, least-privilege changes.
- Treat production credentials, secrets, state, and release artifacts as sensitive.
- Grant permissions to workload identities, not broad human/shared credentials.

## Routing / token discipline

- Load this skill only for an agent/task that needs it.
- Route only the infrastructure/application contracts required for this task.
- Prefer manifests, exact config sections, diffs, logs, and relevant commands over reading unrelated source.
- If provider/tool behavior is version-sensitive, inspect the repository version and verify official documentation before changing APIs/configuration.

## Validation

Before handoff, record the concrete validation appropriate to the change, such as:
- syntax/config validation;
- build;
- image build;
- dry-run/plan;
- test/smoke check;
- health/readiness;
- deployment preview;
- rollback verification.

Never claim production safety without evidence.
