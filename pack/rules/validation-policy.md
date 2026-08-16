# Validation Policy

## Plan Validator

Read-only by default.
May reject or request revision.
May identify a missing required step.
May not invent unrelated product scope.

## Handoff Validator

Independent from the worker.
Read-only by default.
Validates actual repository state, not agent claims.

## Step validation

For each step verify:
- actual diff matches registered scope;
- expected behavior exists;
- unrelated files were not changed without justification;
- validation listed in the registry was actually run when possible.

## Hard handoff gates

Use a hard gate when crossing ownership boundaries such as:
- database -> backend;
- backend/API -> frontend;
- auth/security -> consuming feature;
- shared package -> app;
- implementation -> release.

Hard gates should include contract verification, relevant tests, and build/static checks when available.

## Soft handoff gates

For small internal changes, validate:
- requested change exists;
- relevant file/component is correct;
- basic compile/lint/test signal is healthy;
- downstream work can proceed.
