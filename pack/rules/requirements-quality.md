# Evidence-Gated Requirements, Quality and Efficiency

Follow .agent-core/rules/workflow.md and .agent-core/rules/efficiency-policy.md first. This rule does not create an extra always-on agent.

## Three independent dimensions (in priority order)
1. **Requirements fidelity** — what was requested, what is in scope, and which numbered acceptance criteria have been verified.
2. **Engineering quality** — executed checks with real exit codes, code review provenance, current-source evidence, and unresolved blockers.
3. **Execution efficiency** — observed tool/token/time metrics and task-local no-progress signals, never an excuse to skip quality gates.

## Planning depth
- SMALL low risk: no formal spec or independent plan validation. Direct implementation and focused verification; optional lightweight requirement tracking.
- MEDIUM: brief plan only (3–6 bullets), unless material risk demands more.
- LARGE/high risk: Spec Writer -> independent Spec Validator -> Architect / Plan Validator -> locked/approved plan -> implementation.

## Formal spec contract
- Store a project-local spec with REQ-### identifiers and testable acceptance criteria.
- Use spec-set, requirement-add, and spec-validate on work-progress.mjs before plan-validate and implementation.
- New formal jobs require independent spec approval. Pre-existing jobs remain readable without retroactively inventing approval.
- Changed spec bytes or requirement definitions invalidate spec/plan approval and prior acceptance and review evidence. Revalidate only affected material scope.
- Job state uses revisioned per-job locks; a long npm check reloads the current job after execution instead of overwriting progress recorded by other processes.
- Freshness checks include Git-tracked and non-ignored untracked application/config inputs (MDX, GraphQL, proto, SVG and Dockerfile) with bounded standalone-directory fallback.

## Engineering quality
- Implement and run relevant project checks through check-run --script <actual-npm-script> where scripts exist.
- This helper executes an existing package.json script using npm; it records observed exit code, duration, and current-source fingerprint. It is not a replacement for full E2E/manual testing.
- Use requirement-verify --result PASS --check-script test --evidence ... to attach executable verification or --manual with concrete evidence for non-automatable acceptance.
- Formal work requires a separate quality-review --reviewer code-reviewer --result PASS --evidence ....
- Failed or stale checks, unverified acceptance criteria, stale independent review, and material spec drift block formal DONE. Never mark a skipped test PASS.
- Existing update --review PASS, --build PASS and summary test counters do not substitute for executed formal-quality evidence.

## Reports
- node .agent-core/bin/work-progress.mjs report --task-id TASK-042 — all three dimensions.
- node .agent-core/bin/work-progress.mjs audit --task-id TASK-042 — efficiency policy indicators and measured telemetry (null where unavailable).
- node .agent-core/bin/work-progress.mjs benchmark --task-id TASK-042 --against TASK-041 — only quality-verified completed tasks of the same classification with reported elapsed time.

A percentage is a policy indicator, not a claim that implementation correctness can be reduced to one number. Comparisons are observational and meaningful only for comparable workloads. Completed jobs retain their verification verdict and source digest as of completion; later code changes appear as separate current-source freshness warnings without rewriting historical benchmark eligibility.

## Limits
The quality guard fingerprints bounded source files. If it cannot verify current source, fail closed rather than approving stale evidence. Runtime reviewer identity is recorded provenance, not cryptographic proof of independent human review; CI/branch protection can enforce stronger external review gates. Do not force telemetry collection from providers that do not expose it.
