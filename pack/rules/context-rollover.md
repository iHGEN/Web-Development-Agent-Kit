# Native Session Rollover and Task Handoff

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

The explicit `.agent-core/bin/session-controller.mjs` remains available for CI/headless/debug continuation workflows. It is not a fallback for new standalone review tasks.

## Two triggers, one outer supervisor

| Trigger | Fresh session input | Completion behavior |
| --- | --- | --- |
| Current context reaches 50% (or the configured threshold) | Compact continuation handoff for the same task | Verify current evidence and continue the recorded next action |
| Standalone review queues `task-handoff.mjs request-review` | Task-only handoff with original request, source selection and a unique new review task | Review once, deliver the report, then the supervisor exits |

A new review request does not wait for the context threshold. It ends the current turn, then the same supervisor replaces the idle native TUI using the existing launch settings, permissions and authentication. The new review never inherits builder history, invokes builder summary capture, resumes the old session or returns to the old task after its report.

Follow `.agent-core/rules/changes-review.md` for request and report receipt commands. Require an active compatible native supervisor. If that mechanism is unavailable, report **Review not started**; do not delegate a subagent, review in the same session, use the explicit Session Controller or ask for `/clear` or `/new` as a substitute. Best-effort tracking failures are gaps. Preserve existing jobs/scope/queues and the global implementation `context-handoff.json`.

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

## Implementation-first threshold rollover contract

This continuation contract applies only to the context-threshold trigger. It preserves the same task and must not restart the workflow. A new review task follows its own handoff and report-only completion contract above.

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

## Fresh continuation-session rule

For a threshold rollover, the fresh provider must:

1. read the current handoff/job state before broad rediscovery;
2. verify material claims against current source/diff/tests/build/runtime;
3. preserve already completed work;
4. resume the **exact recorded next action**;
5. avoid restarting discovery or rewriting a plan simply because context is fresh;
6. only reopen planning when verified evidence meets the canonical Plan Delta threshold.

If the continued job reports an anti-slop violation, its fresh context must route directly to `IMPLEMENTING` and make the next evidence-supported repository change. Never apply this rule or the previous job's state to a new standalone review task.

Current repository evidence always overrides handoff/state summaries.

## Compact continuation handoff shape

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

The transparent supervisor uses the native `agent-turn-complete` notification to confirm the turn boundary and session identity. The same bridge also supplies context telemetry for threshold rollover without rewriting normal provider configuration.

### Claude Code

The transparent supervisor uses temporary settings with a status-line bridge for context telemetry. For a new review task and report completion, only the native `Notification` event with `notification_type: "idle_prompt"` confirms the boundary/session identity. Status-line callbacks and `Stop` are not sufficient. Claude normally emits `idle_prompt` after waiting for input for about 60 seconds ([official hook reference](https://code.claude.com/docs/en/hooks#notification)). Existing hook/status-line behavior is preserved and temporary settings are removed afterward.

Provider-specific telemetry is an adapter concern. The canonical engineering workflow and work-progress state remain provider-neutral. A review report becomes complete only after its valid `task-handoff.mjs report-ready` receipt and native completion boundary; queuing either a task request or receipt alone does not prove launch or delivery.

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
