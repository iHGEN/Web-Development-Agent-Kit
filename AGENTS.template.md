# Web Development Agent Kit v1

## Prime directive

Deliver the user's requested web change correctly with the **smallest necessary scope, team, context, and technology knowledge**.

## Authority

- The original user request is authoritative.
- The Web Orchestrator / Captain owns routing and sequencing.
- Discovery is read-only.
- Implementation cannot begin until the Execution Registry is approved by the Plan Validator.
- No agent may self-approve its plan or handoff.
- Material handoffs must pass the Handoff Validator.
- Final completion requires Final Integration Validator approval.

## Mandatory pre-implementation loop

1. Record the user prompt verbatim.
2. Enhance clarity only; never change meaning or scope.
3. Build/reuse the lightweight repository index.
4. Route a minimal Context Packet.
5. Inspect feature entry points and only dependencies that could actually be touched.
6. Search for existing functions/services/endpoints/components/tests/framework capabilities before designing anything new.
7. Produce an impact map.
8. Design the smallest coherent implementation.
9. Register every code-changing step with evidence, reason, files/components, dependencies, risk, and validation.
10. Plan Validator independently approves/revises/rejects every step.
11. Only then implement.

## Context/token optimization

- Agents do not get unrestricted repository reads by default.
- Prefer `index -> targeted search -> symbol/range -> full file only when needed -> evidence-backed expansion`.
- Installed skills are lazy-loaded; activate only those relevant to the current task/component.
- Pass compact evidence-linked findings between agents, not entire prior transcripts.
- Validate changes diff-first.
- If more context is needed, request the exact path/symbol/contract and state what decision it will unblock.

## Plan change rule

If implementation discovers evidence that materially invalidates an approved step, stop that step and submit a plan delta. Never silently improvise outside the approved plan.

## Maintainability contract

Prefer correctness, clarity, high cohesion, low coupling, explicit ownership, simple extension points, testability, and minimal meaningful duplication. KISS/DRY/YAGNI/SOLID are tools, not reasons to create ceremony. Do not create duplicate services/helpers/managers/repositories/endpoints/components to avoid understanding existing code.

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

## Skill policy

`.agents/skills/` contains only the baseline and project-detected/explicitly activated skills. The full catalog is recorded in `.agent-core/catalog/skill-catalog.json`. A skill may be activated on demand if the task requires it and the Context Router approves it.


## DevOps routed team

- docker-container-engineer
- devops-platform-engineer
- ci-cd-engineer
- cloud-infrastructure-engineer
- kubernetes-platform-engineer
- infrastructure-as-code-engineer
- devsecops-reviewer
- sre-reliability-engineer
- release-deployment-engineer
- linux-operations-engineer
