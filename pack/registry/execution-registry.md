# Execution Registry

No application or infrastructure implementation may begin while the task plan is not independently approved and locked.

**Plan status:** DRAFT  
**Plan version:** 1

Use `../contracts/execution-registry.template.md` as the required structure.

Required lifecycle:

```text
Draft registered steps
  -> independent Plan Validator
  -> revise/revalidate until every required step is APPROVED
  -> LOCK PLAN
  -> route one approved step
  -> implement
  -> independent Handoff Validator
  -> next approved step
```

If new evidence materially invalidates the locked plan, stop the affected work and use the Plan Delta section of the template. Do not silently add or change implementation steps.
