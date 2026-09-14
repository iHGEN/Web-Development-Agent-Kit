# Automatic Context Rollover Rule

This rule governs provider-session lifetime around `.agent-core/rules/workflow.md`. It never changes user scope, repository authority, task classification, routing ownership, or validation requirements.

## Default UX

After Web Kit setup, users continue to launch providers normally:

```bash
codex
```

or:

```bash
claude
```

The transparent supervisor activates only inside a Web-Kit project. Outside one, it passes the real provider through unchanged. Provider administrative/noninteractive commands are also passed through.

Default rollover threshold:

```text
50% current context used
```

The explicit `.agent-core/bin/session-controller.mjs` remains available for CI/headless/debug workflows but is not the normal developer UX.

## Safe-boundary rule

Never terminate a provider in the middle of an edit/tool call merely because context crossed the threshold.

```text
assistant turn completes
      ↓
measure context
      ↓
< threshold -> keep session
>= threshold -> persist compact state at this safe boundary -> fresh session
```

## Implementation-first rollover contract

A rollover is **not** a new task and must not restart the workflow.

Before rollover, preserve:
- original request / task ID;
- SMALL/MEDIUM/LARGE classification and high-risk governance state;
- current job status/progress;
- active routed agent;
- actual completed repository changes;
- test/build/review evidence;
- project/application status evidence already recorded;
- exact next implementation/verification action;
- genuine blockers only.

Primary state:

```text
.agent-core/state/jobs/<task-id>.json
.agent-core/state/project-status.json
.agent-core/state/metrics/workflow-efficiency.json
.agent-core/state/session-progress.json
.agent-core/state/context-handoff.json
.agent-core/state/handoffs/
```

The handoff is deliberately compact. Do not copy the full transcript, full discovery history, or repeated plan prose.

## Fresh-session rule

The fresh provider must:

1. read the current handoff/job state before broad rediscovery;
2. verify material claims against current source/diff/tests/build/runtime;
3. preserve already completed work;
4. resume the **exact recorded next action**;
5. avoid restarting discovery or rewriting a plan simply because context is fresh;
6. only reopen planning when verified evidence meets the canonical Plan Delta threshold.

If the job state reports an anti-slop violation, the fresh context must route directly to `IMPLEMENTING` and make the next evidence-supported repository change.

Current repository evidence always overrides handoff/state summaries.

## Compact handoff shape

A useful rollover handoff should contain approximately:

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

Do not create a narrative history when the state above is sufficient.

## Provider strategy

### Codex

The transparent supervisor uses a process-local notification bridge to observe safe turn boundaries/context telemetry without rewriting the user's normal provider configuration.

### Claude Code

The transparent supervisor uses a temporary settings/status-line bridge to observe safe turn boundaries/context telemetry and removes temporary settings afterward.

Provider-specific telemetry is an adapter concern. The canonical engineering workflow and work-progress state remain provider-neutral.

## Authority

Trust order:

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

## Configuration preservation

The transparent layer is additive and best-effort:
- do not overwrite project-owned `AGENTS.md`, `CLAUDE.md`, provider settings, or user provider configuration merely to monitor context;
- do not weaken enterprise/managed provider policy to obtain telemetry;
- if telemetry is unavailable, preserve workflow state and report the limitation rather than pretending an exact context percentage is known.

Project/user threshold configuration remains supported, bounded by the supervisor. `WEB_KIT_DISABLE_CONTEXT_SUPERVISOR=1` may disable user-level shims without disabling the core Web Kit workflow.
