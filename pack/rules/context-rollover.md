# Automatic Context Rollover Rule

This is a supporting rule for `.agent-core/rules/workflow.md`. It governs **provider-session lifetime**, not engineering scope or code ownership.

## Goal

Long tasks should not wait until an AI context window is nearly exhausted. When Web Kit is launched through its Session Controller, context rollover happens automatically at a configurable threshold while preserving the exact task/workflow state.

Default:

```text
rollover threshold = 50% context used
```

## Controlled-session command

Installed projects expose:

```bash
node .agent-core/bin/session-controller.mjs \
  --provider codex \
  --threshold 50 \
  --prompt "<task>"
```

or:

```bash
node .agent-core/bin/session-controller.mjs \
  --provider claude \
  --threshold 50 \
  --prompt "<task>"
```

The npm launcher invokes the same controller through:

```bash
npx @ihgen/web-kit session codex --prompt "<task>"
npx @ihgen/web-kit session claude --prompt "<task>"
```

## Provider strategy

The controller owns the provider process through supported structured/headless CLI modes.

### Codex

Use Codex non-interactive `exec` mode. Below threshold, resume the current Codex thread. At rollover, start a new `codex exec` thread with the validated Web-Kit handoff.

Default controlled automation permissions are intentionally bounded:

```text
sandbox  = workspace-write
approval = never
```

This allows the controller to continue code-changing workflow units without stopping for interactive approval while keeping Codex inside its workspace-write sandbox by default.

Overrides:

```bash
--codex-sandbox read-only|workspace-write|danger-full-access
--codex-approval untrusted|on-request|never
```

Web Kit MUST NOT silently select `danger-full-access`.

### Claude

Use Claude Code programmatic/stream-JSON mode. Below threshold, resume the current Claude session. At rollover, start a fresh `claude -p` session with the validated Web-Kit handoff.

Default controlled automation permission mode:

```text
permission-mode = auto
```

Override when the user's Claude configuration requires another supported mode:

```bash
--claude-permission-mode default|acceptEdits|plan|auto|dontAsk|bypassPermissions
```

Web Kit MUST NOT silently select `bypassPermissions`. If `auto` is disabled or rejected by the user's Claude configuration, stop with a clear provider error and let the user explicitly choose/configure an appropriate mode.

### Permission principle

The Session Controller is automatic, but automatic does not mean unrestricted.

```text
Codex default  -> workspace-write + no interactive approval pauses
Claude default -> auto permission mode

never silently -> Codex danger-full-access
never silently -> Claude bypassPermissions
```

The automatic controller does **not** emulate terminal keystrokes for `/clear` or `/new`. Starting a fresh provider process/session is more reliable and cross-platform.

## Safe-boundary rule

Do not terminate an AI in the middle of an edit/tool call merely because usage crosses the threshold during an active unit.

Each provider cycle is instructed to complete exactly one safe Web-Kit workflow unit and freshly persist `session-progress.json`. The controller evaluates context only after that unit returns.

```text
provider cycle
  -> complete one safe workflow unit
  -> freshly write session-progress.json
  -> provider returns
  -> controller reads context telemetry
  -> below threshold: resume same provider session
  -> threshold reached: validate/write handoff, start fresh provider session
```

Stale `session-progress.json` from a previous controller cycle is rejected. If the provider fails to rewrite it, the controller records a recovery state instead of trusting stale progress.

## Required state

Controller runtime:

```text
.agent-core/state/session-controller.json
```

Per-cycle workflow state:

```text
.agent-core/state/session-progress.json
```

Latest context handoff:

```text
.agent-core/state/context-handoff.json
```

Archived handoffs:

```text
.agent-core/state/handoffs/<task-id>-<cycle>.json
```

## Handoff validation

Before a fresh session is launched, the controller validates that the handoff contains:

- task ID;
- provider/session provenance;
- rollover reason;
- original user request;
- current progress state;
- compact repository/git snapshot;
- both staged and unstaged change summaries when Git is available;
- exact next action;
- timestamp;
- authority reminder.

The first cycle in the fresh session must verify material handoff claims against current repository source/diff/tests/runtime.

## Context telemetry

Prefer provider-reported live context information.

For Codex, use current/last token usage with the reported model context window. Do not confuse cumulative session token spend with current context occupancy.

For Claude, use current request input/context usage with the provider-reported model context window. Cache-read/cache-create input counts are part of current context input accounting when the provider reports them.

Record the telemetry source in controller state and the handoff.

If exact telemetry is unavailable for the configured number of consecutive cycles, Web Kit may roll over conservatively with:

```text
rollover_reason = telemetry-unavailable-safety
```

Never label a conservative fallback as an exact 50% measurement.

## New-session resume rule

When `.agent-core/state/context-handoff.json` has `status: pending` for the active controlled task:

1. read it before broad repository discovery;
2. read the project profile/routing policy;
3. inspect current source/diff and relevant validation evidence;
4. reconcile any mismatch;
5. execute only the recorded next safe workflow unit;
6. let the controller mark the handoff consumed after the fresh provider cycle starts successfully.

Do not load the previous full transcript merely to recreate context.

## Completion

When `session-progress.json` reports `done`, the controller stops without creating another context.

`done` is valid only after the original request has passed the canonical workflow's required final validation.

When status is `blocked`, the controller stops and preserves state because the task genuinely requires user input/permission.

## Uncontrolled interactive sessions

If the user launches Codex/Claude directly rather than through Web Kit's Session Controller, Web Kit cannot reliably own or replace that already-running terminal process.

In that case, the Context Rollover Manager may prepare a handoff and advise the provider's normal fresh-session command, but this is a fallback. Fully automatic rollover requires the Session Controller to own the provider process from the beginning.
