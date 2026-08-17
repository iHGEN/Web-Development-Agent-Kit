# Web Development Agent Kit v1

## Prime directive

Deliver the user's requested web change correctly with the **smallest necessary scope, team, context, and technology knowledge**.

## Generated project context

On installation, the Web Kit prepends a generated **Project Agent Context** above this canonical template.

The Captain and routing agents MUST read that generated project context first. It contains the project name, detected technology groups, shallow repository structure, important manifests/configuration, test roots, migration/data roots, and repository-navigation capability such as Graphify readiness.

Rules:

- Treat the generated project context as a lightweight routing map, not as permission to read the whole repository.
- Use it to choose likely agents, skills, repository-navigation mode, and feature entry points before targeted discovery.
- Choose repository-navigation tools by question type: direct text/symbol/path lookup uses targeted current-source search first; relationship/dependency/impact discovery prefers fresh Graphify when useful.
- If Graphify is reported ready, it still must pass the managed freshness gate before graph queries are trusted for navigation.
- Graphify narrows where to read; it never replaces exact source/diff/test verification.
- If Graphify refresh/query is unavailable, fails, times out, appears stale/incomplete, or conflicts with current source, immediately use the standard routing loop for that task.
- Verify exact ownership and behavior from repository evidence before implementation.
- Prefer project-specific conventions discovered from the code over generic framework assumptions.
- The machine-readable profile is stored at `.agent-core/index/project-profile.json`.
- Graphify freshness state is stored at `.agent-core/state/graphify.json`.
- The detailed navigation decision rule is `.agent-core/rules/repository-navigation.md`.
- If the project structure, stack, or repository-navigation capability changes materially, regenerate/update the Web Kit project profile.

## Canonical workflow authority

`.agent-core/rules/workflow.md` is the **installed single authoritative lifecycle** for this kit.

In the Web-Kit source repository, its source-pack counterpart is `pack/rules/workflow.md`. Installed projects MUST follow `.agent-core/rules/workflow.md`.

All agents MUST follow that lifecycle. Shorter checklists are subsections of the canonical lifecycle, not alternative workflows.

## Authority

- The original user request is authoritative and must be recorded verbatim before interpretation.
- The Web Orchestrator / Captain owns classification, routing, sequencing, recovery, and final closure.
- The Repository Indexer provides structure without ingesting the whole source tree and may use Graphify as an optional navigation accelerator when the generated project profile reports it ready.
- The Context Router / Token Governor chooses direct targeted source search or fresh Graphify by question type, enforces Graphify freshness, and controls repository context and active skills throughout the lifecycle.
- Current repository source, current diffs, tests/build checks, and runtime evidence remain authoritative over Graphify/index summaries.
- Discovery is read-only.
- Implementation cannot begin until the Execution Registry is independently approved and the plan is locked.
- No agent may self-approve its own plan, implementation, or handoff.
- Every completed code-changing step must pass the Graph Refresh Gate when Graphify is ready, then independent Handoff Validator approval before dependent work continues.
- Material new evidence that invalidates the locked plan requires an approved Plan Delta before work continues.
- Final completion requires Final Integration Validator approval and Captain closure against the original prompt.

## Repository navigation decision

Use this mental model:

```text
Graphify = Where should I look?
rg / targeted search + source = What actually exists?
diff = What changed?
tests / build / runtime = Does the relevant behavior actually work?
```

For exact text/symbol/path lookup, use targeted current-source search first (`rg` when available, otherwise an equivalent targeted source-search tool).

For caller/callee, dependency, ownership, path-tracing, or impact questions, prefer Graphify when it is ready and fresh, then inspect exact source before relying on the result.

Do not broadly search the repository before Graphify when a relationship question can be narrowed by a fresh graph. Do not force Graphify before a precise direct lookup.

## Graph Refresh Gate

When `graphify-out/graph.json` exists, Graphify-assisted routing is allowed only after freshness is confirmed.

Before the first Graphify query of a task, and once after every completed code-changing agent step, run:

```bash
python .agent-core/rules/graphify-refresh.py --project . --task-id <task-id>
```

The gate fingerprints relevant repository state and stores its decision in:

```text
.agent-core/state/graphify.json
```

Behavior:

```text
no graph
  -> standard routing

same repository fingerprint as last successful refresh
  -> no Graphify update
  -> graphify-assisted remains fresh

repository changed
  -> one `graphify update .`

refresh success
  -> graphify-assisted fresh

refresh unavailable / failed / timed out
  -> standard routing for the task
  -> workflow continues
```

Do **not** run Graphify after every file write. Run the gate once after the worker has completed the approved step and its step-local checks, before Handoff Validator or another agent relies on Graphify.

The same rule applies to code changes made by Code Simplifier, security fixes, handoff fixes, and final-failure recovery.

## Canonical lifecycle

1. **USER → CAPTAIN** — receive the request and record the original prompt verbatim.
2. **CLASSIFY TASK** — classify Small / Medium / Large, establish a task ID, context budget, likely agents, and validation depth.
3. **REPOSITORY NAVIGATION + INDEX** — read project profile, build/reuse the lightweight structural index, and classify the navigation question as direct lookup or relationship discovery.
4. **NAVIGATION TOOL DECISION** — direct lookup uses targeted current-source search; relationship discovery prefers Graphify only when ready and useful.
5. **GRAPHIFY FRESHNESS BEFORE FIRST USE** — if Graphify will be queried, run the Graph Refresh Gate first. If it falls back, continue with standard routing.
6. **CONTEXT ROUTER / TOKEN GOVERNOR** — create the smallest discovery Context Packet with relevant entry points, candidate symbols, project facts, navigation question type, selected capability, freshness state, and discovery skills.
7. **INTENT + DISCOVERY** — clarify wording without changing meaning, scope, requested outcome, or constraints.
8. **INTENT CONTRACT** — retain original prompt and record normalized goal, success criteria, constraints, preserve items, assumptions, and non-goals.
9. **READ-ONLY DISCOVERY** — use targeted current-source search for precise lookup; for relationship/dependency/impact questions use fresh narrow Graphify first when it reduces exploration, then verify exact source. Inspect only realistic feature dependencies and existing functions/services/endpoints/components/APIs/models/tests/config/conventions/framework-native capabilities before proposing anything new.
10. **IMPACT MAP** — separate definitely affected, potentially affected, and intentionally untouched areas with source-verified evidence.
11. **IMPLEMENTATION DESIGN** — design the smallest coherent implementation that reuses existing ownership and architecture.
12. **EXECUTION REGISTRY** — register every code-changing step with source/contract evidence, reason, expected files/components, dependencies, behavior change, risk, and validation.
13. **PLAN VALIDATOR** — independently classify every step as `APPROVED`, `REVISE`, `REJECTED`, `UNNECESSARY`, or `MISSING_DEPENDENCY`.
14. **PLAN LOOP** — any non-approved required step returns for revision and revalidation. No code changes are allowed yet.
15. **LOCK PLAN** — implementation permission starts only after all required steps are approved and the plan is locked.
16. **CONTEXT ROUTER AGAIN** — build a fresh implementation-specific Context Packet for one approved step only; ensure Graphify freshness before any new relationship graph query.
17. **IMPLEMENT ONE APPROVED STEP** — selected worker changes only the approved scope and runs step-local checks.
18. **GRAPH REFRESH GATE** — once the step is complete, run the managed gate. If changed, it performs one incremental `graphify update .`; if unchanged it skips; on failure it falls back to standard routing without blocking.
19. **HANDOFF VALIDATOR** — independently compare approved step, actual diff, changed symbols, relevant tests/checks, claimed behavior, and downstream contract. Fresh Graphify may help locate callers/contracts; PASS/FAIL remains source/diff/test grounded.
20. **HANDOFF LOOP** — `FAIL` returns exact evidence to the worker; after any fix, rerun local checks → Graph Refresh Gate → Handoff Validator. `PASS` permits the next registered step.
21. **REPEAT PER STEP** — every remaining step follows `Context Router -> Worker -> Graph Refresh Gate -> Handoff Validator`.
22. **PLAN DELTA LOOP** — new material evidence invalidating the locked plan causes stop → evidence → Plan Delta → independent validation → relock → fresh routing. Never silently improvise.
23. **ALL PLAN STEPS PASS** — whole-feature work begins only after every implementation step passed handoff validation.
24. **CODE SIMPLIFIER** — improve maintainability without changing requested behavior. If it edits code, run the Graph Refresh Gate once afterwards.
25. **RUN AFFECTED TESTS AGAIN** — verify simplification/fixes preserved behavior.
26. **SPECIALIZED VALIDATION** — route only relevant independent reviewers: Test, Security, Code Review, Performance when material, Accessibility when relevant, Bug Hunter, API Contract when relevant, DevSecOps/SRE/other specialists as evidence requires. Fresh Graphify may assist relationship tracing only.
27. **FINAL INTEGRATION VALIDATOR** — validate original intent, final diff, contracts, build/tests, approved plan/deltas, integration behavior, deployment/migration impacts, unresolved handoffs, and regression risks.
28. **FINAL FAILURE LOOP** — owning agent fixes only failure scope → Graph Refresh Gate if code changed → Handoff Validator → affected downstream validation → Final Integration again.
29. **FINAL PASS → CAPTAIN** — compare final state against original verbatim prompt, report limitations/non-goals, and declare `DONE`.

## Context/token optimization is continuous

The Context Router / Token Governor runs before discovery, before every implementation step, for evidence-backed expansion, before specialist validation when needed, and during failure recovery.

### Direct lookup

For exact text/symbol/path questions:

`targeted current-source search (rg when available) -> exact file/symbol -> current source`

### Standard relationship fallback

`project profile -> repository index -> targeted search -> symbol/range -> full file only when needed -> evidence-backed expansion`

### Graphify-assisted relationship discovery

Use only when the generated project profile reports Graphify ready **and** `.agent-core/state/graphify.json` reports a fresh graph:

`project profile -> Graph Refresh Gate -> narrow Graphify query/path/neighbors -> small candidate symbol set -> exact source symbol/range -> targeted search for gaps -> full file only when needed -> evidence-backed expansion`

### Continuous rules

- Agents do not get unrestricted repository reads by default.
- Choose navigation tool by question type, not tool availability alone.
- Use targeted current-source search first for exact text/symbol/path lookup.
- Prefer fresh Graphify for relationship/dependency/ownership/impact discovery when it reduces exploration.
- Do not broadly search before Graphify for relationship questions when a fresh graph can narrow first.
- Do not force Graphify before a precise lookup.
- Never load or forward the complete `graphify-out/graph.json` into model context.
- Graphify readiness does not imply freshness; enforce the gate.
- Refresh once per completed changed repository state, not per file write.
- Graphify is navigation evidence, not behavioral authority.
- If Graphify refresh/query fails or is unsuitable, use standard routing without blocking the task.
- Installed skill does not mean active skill. Activate only skills relevant to the current agent/task.
- Discovery findings are compacted into evidence-linked summaries instead of forwarding full transcripts.
- Implementation agents receive the approved step and minimum relevant code/contracts, not the whole discovery transcript.
- Handoff validation is diff-first.
- Reuse already-verified task-local summaries when sufficient; reread unchanged source only when new detail is required.
- If more context is needed, request the exact path/symbol/contract and state what decision it will unblock.
- Token optimization must never omit context necessary for correctness, security, or user intent.

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
