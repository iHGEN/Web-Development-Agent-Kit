# Context Rollover Manager

## Mission

Keep long Web-Kit tasks reliable when an AI provider session grows large by coordinating **fresh-context rollover without losing task state**.

This is a control role. It does not replace the Captain, Context Router, implementation workers, or independent validators.

## Trigger

When a task is running under `.agent-core/bin/session-controller.mjs`, the Session Controller monitors provider-reported context usage.

Default rollover threshold:

```text
50% context used
```

The threshold may be changed by the user/controller configuration, but the current configured threshold is authoritative for that controlled task.

## Responsibilities

At every controller-cycle boundary:

1. ensure `.agent-core/state/session-progress.json` accurately describes the current Web-Kit phase, routed role, completed work, validation, pending work, and exact next action;
2. keep the summary compact and evidence-backed;
3. distinguish `continue`, `done`, and `blocked` correctly;
4. never claim `done` before the original request has passed the workflow's required final validation;
5. when a fresh context starts from `.agent-core/state/context-handoff.json`, verify all material handoff claims against current repository source/diff/tests/runtime before relying on them;
6. resume the exact next action rather than rediscovering the whole repository;
7. preserve the original user request and locked-plan/Plan-Delta state across rollovers.

## Session Controller ownership

In a controlled session (`WEB_KIT_SESSION_CONTROLLER=1`):

- **do not** run `/clear`, `/new`, `/compact`, or equivalent context-reset commands yourself;
- **do not** ask the user to reset the session;
- finish the current single safe workflow unit and write `session-progress.json`;
- the Session Controller decides whether the next cycle resumes the current provider session or launches a fresh provider process.

The controller uses provider-native structured/headless execution. A fresh provider process is the automatic equivalent of starting a new conversation, without fragile terminal keystroke injection.

## Required session-progress state

Before the final response of every controlled cycle, write:

```text
.agent-core/state/session-progress.json
```

Required logical fields:

```json
{
  "schema_version": 1,
  "task_id": "...",
  "status": "continue | done | blocked",
  "phase": "...",
  "role": "...",
  "summary": "...",
  "completed_steps": [],
  "current_step": "...",
  "pending_steps": [],
  "files_changed": [],
  "validation_completed": [],
  "validation_pending": [],
  "decisions": [],
  "constraints": [],
  "next_action": "...",
  "updated_at": "..."
}
```

`next_action` is mandatory while `status=continue`.

## Handoff authority

A context handoff is **routing/state evidence**, not behavioral authority.

Trust order remains:

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

If the handoff conflicts with current repository evidence, repository evidence wins and the discrepancy must be recorded.

## Rollover safety

The controller performs rollover only after the current provider process returns at a safe workflow-unit boundary. It does not intentionally kill an AI in the middle of an edit/tool call just because the threshold was crossed during that unit.

If exact provider context telemetry is temporarily unavailable, the controller may perform a conservative safety rollover after its configured telemetry-fallback cycle count. This must be recorded as `telemetry-unavailable-safety`, not represented as an exact 50% measurement.

## Handoff

When this role is active, its compact handoff to the next fresh context consists of:

- original request;
- task ID;
- current workflow phase/role;
- completed/current/pending steps;
- decisions and constraints;
- changed-file and validation summary;
- compact git snapshot;
- exact next action;
- context threshold/observed usage and telemetry source;
- source-authority reminder.

Do not copy the entire old conversation into the new context.
