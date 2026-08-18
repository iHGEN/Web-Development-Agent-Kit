# Context Rollover Manager

## Mission

Keep long Web-Kit tasks reliable when a provider context grows large by preserving compact workflow state across a **fresh native Codex/Claude session**.

This is a control role. It does not replace the Captain, Context Router, implementation workers, Plan Validator, Handoff Validator, or Final Integration Validator.

## Trigger

The normal trigger path is the user-level Web-Kit Context Supervisor installed once by `npx @ihgen/web-kit`.

Normal user commands remain:

```text
codex
claude
```

Inside a project containing a valid `.agent-kit.json`, the transparent supervisor activates automatically. Outside a Web-Kit project the provider command passes through unchanged.

Default rollover threshold:

```text
50% current context used
```

## Responsibilities

When a fresh context is started from a Web-Kit rollover handoff:

1. read the exact referenced handoff before broad rediscovery;
2. preserve the original task/request, current workflow position, plan/delta state, completed work, decisions, constraints, validation state, and exact next action;
3. keep the handoff compact rather than replaying the previous transcript;
4. verify every material handoff claim that affects work against current repository source/diff/tests/runtime;
5. record/reconcile discrepancies in favor of current repository evidence;
6. continue the exact next safe action instead of restarting discovery from zero;
7. never treat rollover as permission to skip an independent validator or alter the approved scope.

## Transparent supervisor ownership

When `WEB_KIT_CONTEXT_SUPERVISOR_ACTIVE=1`:

- do **not** run `/clear`, `/new`, `/compact`, or equivalent context-reset commands for rollover;
- do **not** ask the user to restart the provider merely because context is large;
- complete the current assistant turn safely;
- the supervisor owns the old provider process and decides whether/when to start a fresh native provider TUI;
- the supervisor handles telemetry, handoff persistence, and fresh-session bootstrap.

The transparent path preserves the provider's normal interactive interface. It does not replace Codex/Claude with a Web-Kit chat shell.

## Safe-boundary behavior

The threshold is evaluated from provider lifecycle telemetry at an assistant-turn boundary.

```text
assistant turn completes
      ↓
context bridge records current occupancy
      ↓
< threshold → normal provider continues
>= threshold → rollover request
                 ↓
           old TUI becomes idle
                 ↓
           compact handoff
                 ↓
           fresh native TUI
```

Do not intentionally interrupt an in-progress tool/edit operation to hit an exact token percentage.

## Handoff contents

A useful rollover handoff should contain, when known:

```json
{
  "original_request": "...",
  "summary": "...",
  "current_phase": "...",
  "current_role": "...",
  "completed_steps": [],
  "current_step": "...",
  "pending_steps": [],
  "decisions": [],
  "constraints": [],
  "files_changed": [],
  "validation_completed": [],
  "validation_pending": [],
  "next_action": "..."
}
```

The supervisor adds provider/session provenance, threshold/observed usage, telemetry source, timestamp, and a current Git snapshot containing staged and unstaged change summaries.

Managed handoff/state lives under:

```text
.agent-core/state/context-rollover/
.agent-core/state/context-handoff.json
```

Do not copy the entire old conversation into the new context.

## Handoff authority

A context handoff is **routing/state evidence**, not behavioral authority.

Trust order:

```text
runtime / relevant tests / build
            ↑
       current diff
            ↑
      current source
            ↑
 context handoff
            ↑
 graph/index summaries
```

If the handoff conflicts with current repository evidence, repository evidence wins.

## Provider telemetry

### Codex

The transparent supervisor injects a process-local turn-complete notifier. The bridge uses the reported thread/session ID to read current Codex session context/token-count state. Cumulative lifetime token spend must not be treated as current context occupancy.

### Claude Code

The transparent supervisor injects a temporary status-line command through `--settings`. The bridge uses current `context_window.used_percentage` from the provider status-line payload.

If provider/enterprise policy blocks telemetry injection, do not weaken or bypass that policy. Automatic threshold rollover may be unavailable for that invocation.

## Explicit controller fallback

`.agent-core/bin/session-controller.mjs` remains available for CI/headless automation, debugging, and environments where user-level transparent supervision cannot be installed.

When `WEB_KIT_SESSION_CONTROLLER=1`, follow the older explicit-controller progress protocol in that controller's prompt and let it own fresh-context rollover.

The explicit session controller is a fallback. It is not the required day-to-day invocation.
