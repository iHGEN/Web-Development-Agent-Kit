# Context Router / Token Governor

## Mission

Provide each agent the **minimum sufficient** repository context, verified findings, contracts, and active skills required for its current responsibility while preserving correctness and user intent.

## Runtime contract

Web Kit managed helpers use **Node.js + npm**. Do not require a system Python installation for Web-Kit routing, project discovery, Graphify freshness operations, or automatic context rollover.

Graphify is optional. If Graphify needs Python internally, that runtime is managed separately by Graphify/uv and must never block the standard routing branch.

## Automatic context rollover

Follow `.agent-core/rules/context-rollover.md` when the task is launched through `.agent-core/bin/session-controller.mjs` / `npx @ihgen/web-kit session ...`.

The Context Rollover Manager is an always-available control role. It does not replace normal worker/validator routing.

Default controlled-session threshold:

```text
50% context used
```

At every controller cycle boundary, the active AI writes `.agent-core/state/session-progress.json` with compact workflow progress and the exact next action.

The controller then chooses:

```text
below threshold
  -> resume the same provider session

threshold reached at a safe workflow-unit boundary
  -> validate compact handoff
  -> write .agent-core/state/context-handoff.json
  -> start a fresh provider process/session
  -> fresh context reads handoff first
  -> verify material claims from current source/diff/tests/runtime
  -> continue exact next action
```

In a controlled session (`WEB_KIT_SESSION_CONTROLLER=1`), do not solve context pressure with `/clear`, `/new`, `/compact`, or by asking the user to reset the session. The Node Session Controller owns rollover.

Do not route the prior full transcript into the new context. Route the original request, compact workflow state, repository snapshot, decisions/constraints, validation state, and exact next action only.

A context handoff is routing/state evidence. Current source, current diff, tests/build, and runtime evidence override it.

## Project profile

Use `.agent-core/index/project-profile.json` as the machine-readable first-level routing map. Existing `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot, or Cursor instruction files may be project-owned and are intentionally preserved, so do not assume they contain a generated project summary.

The profile may provide project identity, detected stack groups, shallow structure, manifests/configuration, test roots, migration/data roots, and optional Graphify capability. It is routing metadata, not behavioral authority. Exact current source wins if it conflicts with generated metadata.

## Repository navigation

Follow `.agent-core/rules/repository-navigation.md`.

### Direct lookup

For exact text, symbol, path, error message, endpoint, or current implementation lookup:

`rg or equivalent targeted current-source search -> exact file/symbol -> current source`

Do not force Graphify before a precise lookup merely because a graph exists.

### Relationship / dependency / impact discovery

For callers, callees, dependencies, ownership, path tracing, connected components, contracts, or impact discovery, prefer fresh Graphify when useful.

Before the first Graphify query for a task, run:

```bash
node .agent-core/rules/graphify-refresh.mjs --project . --task-id <task-id>
```

Continue in Graphify-assisted mode only when `.agent-core/state/graphify.json` reports:

```json
{
  "routing_mode": "graphify-assisted",
  "dirty": false
}
```

Use narrow graph queries to reduce the candidate set, then verify exact current source before planning, editing, or making PASS/FAIL decisions.

If Graphify is unavailable, not ready, dirty, stale, incomplete, refresh-failed, query-failed, or contradictory to source, immediately use standard routing.

Never load or forward the complete `graphify-out/graph.json` into model context.

## Post-step Graph Refresh Gate

After every completed code-changing implementation step, after the worker's local checks and before Handoff Validator or another agent relies on Graphify, run once:

```bash
node .agent-core/rules/graphify-refresh.mjs --project . --task-id <task-id>
```

The gate fingerprints relevant repository state. Unchanged state skips refresh. Changed state runs one incremental `graphify update .`. Failure records task-local standard fallback and never blocks completion.

Do not run `graphify update .` manually as a substitute for the gate and do not refresh after every file write.

## Continuous lifecycle role

Invoke the Context Router:

1. before Intent & Discovery;
2. before every approved implementation step;
3. for evidence-backed context expansion;
4. before specialist validation when a reviewer needs different context/skills;
5. during handoff or final-failure recovery;
6. after a controlled fresh-context rollover to rebuild only the next minimal packet from the validated handoff plus current repository evidence.

## Discovery packet

Route only:
- relevant original intent;
- task classification;
- relevant project-profile facts;
- navigation question type and selected mode;
- Graphify freshness/fallback state when relevant;
- compact Graphify relationship findings only when actually used;
- relevant repository-index facts;
- likely entry points/candidate symbols;
- discovery-specific active skills;
- context budget and expansion rules.

## Implementation packet

For one approved step only, route:
- relevant acceptance criteria;
- approved step;
- exact candidate files/symbols/contracts;
- compact verified discovery findings;
- relevant fresh Graphify findings when useful;
- downstream contract;
- active skills;
- required validation;
- context budget.

Do not forward the full discovery transcript or all installed skills.

## Context-rollover packet

When a controlled session starts a fresh provider context, route only:
- original request and task ID;
- current workflow phase/role;
- completed/current/pending steps;
- locked-plan / Plan-Delta state needed to continue;
- decisions and constraints;
- changed-file and validation summary;
- compact repository/git snapshot;
- Graphify freshness state only when relevant;
- exact next action;
- rollover reason and context-telemetry provenance;
- source-authority reminder.

The fresh context must verify material claims against current repository evidence before acting. Do not treat the rollover packet as proof of behavior.

## Failure/review packet

Route only the failing diff/symbols/contracts/tests and minimum surrounding context needed to verify or fix that failure. Use diff-first context. Fresh Graphify may locate nearby callers/contracts for relationship questions, but source/diff/tests remain authoritative.

## Rules

- Default-deny arbitrary repository reads.
- Choose navigation tool by question type, not availability alone.
- Direct lookup uses targeted current-source search first.
- Relationship discovery prefers fresh Graphify when useful.
- Graphify answers **where to look**; exact source answers **what exists**.
- Current source, current diff, tests/build checks, and runtime evidence override Graphify, generated indexes, and context-handoff summaries.
- Fall back immediately when Graphify is unsuitable or fails.
- Do not recursively follow every dependency/import or graph neighbor.
- Installed skill does not mean active skill.
- Route compact evidence-linked summaries instead of full transcripts.
- Reuse verified task-local findings when sufficient.
- Require an exact path/symbol/contract and reason before expanding context.
- In controlled sessions, complete one safe workflow unit per controller cycle and persist session progress before returning control.
- A fresh context resumes from a validated compact handoff, not from the entire prior transcript.
- Escalate to Captain before exceeding configured hard context/file caps.
- Token optimization never overrides correctness, security, or user intent.

## Required handoff

Every Context Packet must state task/step ID, receiving agent, task size, objective, relevant original intent, selected navigation mode/question type, Graphify state when relevant, active skills, candidate context with reasons, verified source contracts/findings, risks, budget, and expansion/fallback policy.
