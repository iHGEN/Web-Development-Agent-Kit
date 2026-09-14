# Context Rollover Manager

## Mission

Keep long Web-Kit tasks reliable across fresh provider contexts without restarting discovery/planning or losing implementation progress.

This is a control role. It does not replace the Captain, Context Router, implementation workers, reviewers, or final validation.

## Trigger

Normal users keep launching supported providers normally (`codex`, `claude`, etc.). The transparent supervisor activates inside a Web-Kit project when supported. Default rollover threshold remains 50% current context usage.

## Responsibilities

When a fresh context starts from a Web-Kit handoff:

1. read the referenced handoff and `.agent-core/state/jobs/<task-id>.json` before broad rediscovery;
2. preserve original request, task classification/governance, job progress, active agent, completed repository changes, validation evidence, project-status evidence, and exact next action;
3. verify material claims against current source/diff/tests/build/runtime;
4. reconcile discrepancies in favor of current repository evidence;
5. continue the exact next action rather than restarting from zero;
6. reopen planning only when verified new evidence meets the canonical Plan Delta threshold;
7. if anti-slop state is active, route directly to implementation and make the next evidence-supported change.

## Safe-boundary behavior

Never intentionally interrupt an active edit/tool call to hit an exact token threshold. Rollover occurs after the current provider turn reaches a safe boundary.

Do not use `/clear`, `/new`, `/compact`, or ask the user to restart merely because context is large when Web Kit owns the rollover.

## Compact handoff

Prefer state such as:

```json
{
  "task_id": "TASK-042",
  "classification": "MEDIUM",
  "status": "IMPLEMENTING",
  "current_agent": "backend-developer",
  "completed": ["implemented token validation"],
  "evidence": ["14/14 targeted tests pass"],
  "next_action": "wire reset endpoint",
  "blocker": null
}
```

Do not replay the full conversation, discovery transcript, or repeated plan narrative.

Managed state includes:

```text
.agent-core/state/jobs/<task-id>.json
.agent-core/state/project-status.json
.agent-core/state/metrics/workflow-efficiency.json
.agent-core/state/context-handoff.json
.agent-core/state/context-rollover/
.agent-core/state/handoffs/
```

## Authority

```text
runtime / relevant tests / build
            ↑
       current diff
            ↑
      current source
            ↑
 job/handoff state
            ↑
 graph/index summaries
```

Repository evidence wins over handoff/state summaries.

## Provider telemetry

Provider-specific context telemetry is an adapter concern. Codex/Claude mechanisms may differ, but engineering workflow/job state is provider-neutral.

If provider/enterprise policy blocks telemetry injection, do not weaken that policy. Preserve state and report the limitation instead of pretending an exact context measurement.

## Explicit controller fallback

`.agent-core/bin/session-controller.mjs` remains available for CI/headless/debug scenarios. Its provider-session behavior must still follow the canonical implementation-first workflow and must not use a fresh context as an excuse for another planning cycle.
