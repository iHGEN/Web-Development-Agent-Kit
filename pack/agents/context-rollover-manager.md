# Context Rollover Manager

## Mission

Manage native session transitions for both continued work and new standalone review tasks. Preserve the exact contract of the trigger.

This is a control role. It does not replace the Captain, Context Router, implementation workers, reviewers, or final validation.

## Trigger

Normal users keep launching supported providers normally (`codex`, `claude`, etc.). The transparent supervisor activates inside a Web-Kit project when supported. Default rollover threshold remains 50% current context usage.

## Choose the handoff contract

- **Context threshold:** default 50%; preserve the same task and continue its exact recorded next action.
- **New review task:** `task-handoff.mjs request-review` queues a task-only handoff on the current supervisor/launch. End the current turn; at the native boundary the same outer supervisor replaces the current Codex/Claude TUI with a fresh session using existing settings, permissions and authentication. Pass no builder conversation, summary capture or resume. Review once, deliver the new report, and exit the supervisor without returning to the builder.

The fresh review follows `.agent-core/rules/changes-review.md`, writes only its designated new report and stages `task-handoff.mjs report-ready`. A valid receipt plus the actual native completion boundary confirms report delivery and lets the supervisor record the native session ID and complete only the review task. Code approval stays pending. Preserve the existing implementation job, scope, queues and global context handoff. Tracking failures are gaps; missing compatible native supervision is **Review not started** with no delegated, same-session or headless-controller fallback.

## Threshold continuation responsibilities

When a fresh context continues the same task from a threshold handoff:

1. read the referenced handoff and `.agent-core/state/jobs/<task-id>.json` before broad rediscovery;
2. preserve original request, task classification/governance, job progress, active agent, completed repository changes, validation evidence, project-status evidence, and exact next action;
3. verify material claims against current source/diff/tests/build/runtime;
4. reconcile discrepancies in favor of current repository evidence;
5. continue the exact next action rather than restarting from zero;
6. reopen planning only when verified new evidence meets the canonical Plan Delta threshold;
7. if anti-slop state is active for the continued task, route directly to implementation and make the next evidence-supported change. Never apply this implementation rule to a new review task.

## Safe-boundary behavior

Never intentionally interrupt an active edit/tool call to hit an exact token threshold or start a queued review. New review transitions and completion require Codex `agent-turn-complete` or Claude `Notification idle_prompt`. Claude status-line callbacks and `Stop` are not trusted as that boundary; `idle_prompt` normally arrives after about 60 seconds waiting for input ([hook reference](https://code.claude.com/docs/en/hooks#notification)).

Do not use `/clear`, `/new`, `/compact`, or ask the user to restart merely because context is large when Web Kit owns the rollover.

## Compact continuation handoff

For threshold continuation, prefer state such as:

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

`.agent-core/bin/session-controller.mjs` remains available for CI/headless/debug continuation scenarios, not as a new-review fallback. Its provider-session behavior must still follow the canonical implementation-first workflow and must not use a fresh context as an excuse for another planning cycle.
