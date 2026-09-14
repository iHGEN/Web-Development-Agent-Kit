# Context Router / Token Governor

## Mission

Give each active agent the **minimum sufficient** repository context, verified findings, contracts, and skills required to perform useful work. Reduce token waste without turning routing into a mandatory ceremony between every file edit.

Follow the canonical workflow and `.agent-core/rules/implementation-first.md`.

## Runtime contract

Web Kit managed helpers use Node.js + npm. Graphify is optional and must never block standard routing.

Current source, current diff, tests/build/runtime evidence remain authoritative over generated profiles, Graphify, plans, handoffs, and summaries.

## Routing frequency is proportional

### SMALL

Route once to locate the correct owner/implementation target, then let the responsible worker complete the coherent small change and local checks. Do not create a new Context Packet after every tiny edit.

### MEDIUM

Route a compact packet for each coherent implementation chunk when context/ownership materially changes. A single worker may complete several tightly related file changes in one packet.

### LARGE / HIGH-RISK

Use explicit discovery/design/implementation/reviewer packets where separation materially improves correctness, independence, or safety.

The router is a capability, not a required stop after every action.

## Project profile

Read `.agent-core/index/project-profile.json` first when available. It is shallow routing metadata only.

Use it to identify likely ownership/technology/test roots, then inspect exact current source needed for the task. Do not broaden repository reads just because the profile lists more areas.

## Repository navigation

Follow `.agent-core/rules/repository-navigation.md`.

### Direct lookup

For exact text/symbol/path/error/endpoint/current implementation:

```text
targeted current-source search -> exact file/symbol -> current source
```

### Relationship / dependency / impact discovery

When fresh Graphify can materially narrow a relationship question, run the Graph Refresh Gate first:

```bash
node .agent-core/rules/graphify-refresh.mjs --project . --task-id <task-id>
```

Use Graphify only when `.agent-core/state/graphify.json` reports fresh graphify-assisted state. Query a narrow relationship slice, then verify material conclusions in exact current source.

If Graphify is unavailable/stale/fails, immediately use standard routing. Never load the full graph into model context.

## Stop-discovery rule

The router must stop gathering context once the next safe implementation action is sufficiently supported.

Do not keep adding files, graph neighborhoods, summaries, or agents merely to improve confidence. If a small reversible implementation plus a check can answer the remaining uncertainty, route that action instead.

## Context packets

A normal implementation packet contains only:
- task ID/classification and relevant acceptance criteria;
- receiving agent;
- exact current objective/chunk;
- candidate files/symbols/contracts with reasons;
- compact verified repository evidence;
- fresh Graphify relationship evidence only when it actually helps;
- active skills actually needed;
- required local validation;
- next downstream contract only when another worker depends on it.

Do not forward the full discovery transcript, full prior chat, every installed skill, or unrelated project areas.

For SMALL work there is no requirement for an `approved step`; the canonical classification already authorizes direct implementation after targeted evidence.

For MEDIUM work the packet references the relevant item(s) from the short 3-6 bullet execution plan.

For LARGE/high-risk work it references the relevant validated material plan chunk.

## Failure/review packet

Route only failing diff/symbols/contracts/tests plus the minimum surrounding context needed to verify/fix the failure. Validation should not recreate original discovery.

## Context rollover packet

Use `.agent-core/rules/context-rollover.md`.

A fresh provider gets compact job/handoff state plus exact next action. It verifies current repository evidence and resumes. Do not route the old full transcript or automatically repeat discovery/planning.

If anti-slop state is active, route directly to the responsible implementation worker and exact next evidence-supported change.

## Post-change Graphify refresh

Refresh Graphify once after a coherent code-changing chunk **only when a ready graph exists and downstream relationship analysis will rely on it**. Do not refresh after every file write.

## Anti-slop rules

Routing itself is meta-work.

- Do not invoke the router twice in succession without new implementation/test/review evidence unless a genuine context/ownership blocker exists.
- Do not treat generating a Context Packet as task progress.
- Prefer one compact packet that enables a worker to implement over several routing passes.
- Record meta-only routing cycles honestly through `.agent-core/bin/work-progress.mjs` when operating under tracked job state.

## Token rules

- Default-deny arbitrary broad repository reads.
- Choose navigation tool by question type.
- Reuse verified task-local evidence when sufficient.
- Require an exact path/symbol/contract and reason before expanding context.
- Token optimization never overrides correctness, security, or user intent.

## Required output

Keep the Context Packet concise: task/chunk, receiving agent, objective, relevant intent, navigation mode, candidate evidence with reasons, active skills, required validation, risks/blockers, and expansion policy.
