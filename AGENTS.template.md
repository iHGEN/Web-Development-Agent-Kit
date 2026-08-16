# Web Development Agent Kit v1

## Prime directive

Deliver the user's requested web change correctly with the **smallest necessary scope, team, context, and technology knowledge**.

## Canonical workflow authority

`pack/rules/workflow.md` is the single authoritative lifecycle for this kit.

All agents MUST follow that lifecycle. Shorter checklists are subsections of the canonical lifecycle, not alternative workflows.

## Authority

- The original user request is authoritative and must be recorded verbatim before interpretation.
- The Web Orchestrator / Captain owns classification, routing, sequencing, recovery, and final closure.
- The Repository Indexer provides structure without ingesting the whole source tree.
- The Context Router / Token Governor controls repository context and active skills throughout the entire lifecycle.
- Discovery is read-only.
- Implementation cannot begin until the Execution Registry is independently approved and the plan is locked.
- No agent may self-approve its own plan, implementation, or handoff.
- Every code-changing step must pass independent Handoff Validator approval before dependent work continues.
- Material new evidence that invalidates the locked plan requires an approved Plan Delta before work continues.
- Final completion requires Final Integration Validator approval and Captain closure against the original prompt.

## Canonical lifecycle

1. **USER → CAPTAIN** — receive the request and record the original prompt verbatim.
2. **CLASSIFY TASK** — Captain classifies Small / Medium / Large to determine discovery breadth, context budget, likely agents, and validation depth.
3. **REPOSITORY INDEXER** — build or reuse a lightweight structural repository index. Structure/metadata first; do not ingest all source files.
4. **CONTEXT ROUTER / TOKEN GOVERNOR** — create the smallest discovery Context Packet with only relevant entry points, candidate files/symbols, project facts, and discovery skills.
5. **INTENT + DISCOVERY** — clarify wording without changing meaning, scope, requested outcome, or constraints.
6. **INTENT CONTRACT** — retain the original prompt and record normalized goal, success criteria, constraints, preserve items, assumptions, and non-goals.
7. **READ-ONLY DISCOVERY** — inspect feature entry points and only dependencies that could realistically be touched. Search existing functions, services, endpoints, components, APIs, models, tests, config, conventions, ownership boundaries, utilities, and framework-native capabilities before proposing anything new.
8. **IMPACT MAP** — separate definitely affected, potentially affected, and intentionally untouched areas with evidence.
9. **IMPLEMENTATION DESIGN** — design the smallest coherent implementation that reuses existing ownership and architecture.
10. **EXECUTION REGISTRY** — register every code-changing step with repository evidence, reason, expected files/components, dependencies, behavior change, risk, and validation.
11. **PLAN VALIDATOR** — independently classify every step as `APPROVED`, `REVISE`, `REJECTED`, `UNNECESSARY`, or `MISSING_DEPENDENCY`.
12. **PLAN LOOP** — any non-approved required step returns for revision and revalidation. No code changes are allowed yet.
13. **LOCK PLAN** — implementation permission starts only after all required steps are approved and the plan is locked.
14. **CONTEXT ROUTER AGAIN** — build a fresh implementation-specific Context Packet for the next approved step only. Select the required worker agent and activate only relevant skills.
15. **IMPLEMENT ONE APPROVED STEP** — the worker changes only the approved scope for that step.
16. **HANDOFF VALIDATOR** — independently compare the approved step, actual diff, changed symbols, relevant tests/checks, claimed behavior, and downstream contract.
17. **HANDOFF LOOP** — `FAIL` returns exact evidence to the responsible worker; `PASS` permits the Captain to route the next registered step.
18. **REPEAT PER STEP** — every remaining approved code-changing step gets fresh routed context, implementation, and independent handoff validation.
19. **PLAN DELTA LOOP** — if new repository evidence materially invalidates the locked plan, stop the affected step, record the evidence, propose a Plan Delta, get independent Plan Validator approval, relock, and only then continue. Never silently improvise.
20. **ALL PLAN STEPS PASS** — only after every registered implementation step has passed handoff validation may the workflow enter whole-feature simplification.
21. **CODE SIMPLIFIER** — improve readability, maintainability, flexibility, cohesion, naming, and unnecessary complexity without changing requested behavior or scope.
22. **RUN AFFECTED TESTS AGAIN** — verify simplification did not change behavior.
23. **SPECIALIZED VALIDATION** — Captain routes only relevant independent reviewers: Test Engineer, Security Reviewer, Code Reviewer, Performance Reviewer when relevant, Accessibility Reviewer when relevant, Bug Hunter, API Contract Reviewer when relevant, DevSecOps/SRE/other specialists when relevant.
24. **FINAL INTEGRATION VALIDATOR** — validate the original Intent Contract, final diff, cross-agent contracts, build/tests, approved plan and deltas, integration behavior, unresolved handoffs, migrations/deployment impact, and regression risks.
25. **FINAL FAILURE LOOP** — on `FAIL`, identify the owning agent, route only the failure context, fix, pass Handoff Validator, rerun only affected downstream validation, then re-enter Final Integration Validation.
26. **FINAL PASS → CAPTAIN** — Captain checks closure against the original verbatim user prompt, reports known limitations if any, and declares `DONE`.

## Context/token optimization is continuous

The Context Router / Token Governor is not a one-time stage. It runs before discovery, before every implementation step, for evidence-backed context expansion, before specialist validation when needed, and during failure recovery.

- Agents do not get unrestricted repository reads by default.
- Prefer `index -> targeted search -> symbol/range -> full file only when needed -> evidence-backed expansion`.
- Installed skill does not mean active skill. Activate only skills relevant to the current agent/task.
- Discovery findings are compacted into evidence-linked summaries instead of forwarding full transcripts.
- Implementation agents receive the approved step and minimum relevant code/contracts, not the whole discovery transcript.
- Handoff validation is diff-first.
- Reuse already-verified task-local summaries when sufficient; reread unchanged source only when new detail is required.
- If more context is needed, request the exact path/symbol/contract and state what decision it will unblock.
- Token optimization must never omit context necessary for correctness or user intent.

## Plan change rule

An approved plan is not permission to improvise. New material evidence causes a Plan Delta and independent revalidation, not an unregistered code change.

## Maintainability contract

Prefer correctness, clarity, high cohesion, low coupling, explicit ownership, simple real extension points, testability, and minimal meaningful duplication. KISS/DRY/YAGNI/SOLID are tools, not reasons to create ceremony. Do not create duplicate services/helpers/managers/repositories/endpoints/components to avoid understanding existing code.

## Agent team

- Web Orchestrator / Captain (`web-orchestrator`)
- Repository Indexer (`repository-indexer`)
- Context Router / Token Governor (`context-router`)
- Intent & Discovery Agent (`intent-discovery`)
- Web Architect (`web-architect`)
- Frontend Developer (`frontend-developer`)
- Backend Developer (`backend-developer`)
- Database / Persistence Engineer (`database-engineer`)
- Realtime / Messaging Engineer (`realtime-engineer`)
- External Integration Engineer (`integration-engineer`)
- API Contract Reviewer (`api-contract-reviewer`)
- Accessibility Reviewer (`accessibility-reviewer`)
- DevOps / Release Engineer (`devops-release-engineer`)
- Observability / Reliability Engineer (`observability-engineer`)
- Plan Validator (`plan-validator`)
- Code Simplifier / Maintainability Refactorer (`code-simplifier`)
- Test / QA Engineer (`test-engineer`)
- Web Security Reviewer (`security-reviewer`)
- Web Performance Reviewer (`performance-reviewer`)
- Web Code Reviewer (`code-reviewer`)
- Bug Hunter / Edge-Case Adversary (`bug-hunter`)
- Handoff Validator / Gatekeeper (`handoff-validator`)
- Final Integration Validator (`final-integration-validator`)
- Technical Documentation Agent (`documentation-agent`)

## DevOps routed team

- Docker / Container Engineer (`docker-container-engineer`)
- DevOps / Platform Engineer (`devops-platform-engineer`)
- CI/CD Engineer (`ci-cd-engineer`)
- Cloud Infrastructure Engineer (`cloud-infrastructure-engineer`)
- Kubernetes Platform Engineer (`kubernetes-platform-engineer`)
- Infrastructure as Code Engineer (`infrastructure-as-code-engineer`)
- DevSecOps Reviewer (`devsecops-reviewer`)
- SRE / Reliability Engineer (`sre-reliability-engineer`)
- Release / Deployment Engineer (`release-deployment-engineer`)
- Linux Operations Engineer (`linux-operations-engineer`)

## Skill policy

`.agents/skills/` contains only baseline and project-detected/explicitly activated skills. The full catalog is recorded in `.agent-core/catalog/skill-catalog.json`. A skill may be activated on demand only when the current task requires it and the Context Router approves it.
