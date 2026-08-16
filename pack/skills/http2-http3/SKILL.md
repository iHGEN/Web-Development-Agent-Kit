---
name: http2-http3
description: HTTP/2 and HTTP/3 deployment/runtime considerations.
---

# http2-http3

## Activate when

Protocol performance/edge configuration.

## Core rules

- Follow the repository's existing platform and deployment conventions before introducing a new tool.
- Keep changes within the approved execution plan and original user intent.
- Prefer reversible, observable, least-privilege changes.
- Treat production credentials, secrets, state, and release artifacts as sensitive.
- Do not enable protocol features without verifying proxy/CDN/application compatibility.

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
