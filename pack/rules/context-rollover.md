# Automatic Context Rollover Rule

This supporting rule governs **provider-session lifetime** around `.agent-core/rules/workflow.md`. It never changes engineering scope, plan approval, ownership, validation, or source authority.

## Default UX

`npx @ihgen/web-kit` installs/updates the project workflow and, once per user account, installs the lightweight transparent supervisor under:

```text
~/.web-kit/
├── context-supervisor.mjs
├── provider-bridge.mjs
├── supervisor-setup.mjs
├── config.json
└── bin/
    ├── codex
    └── claude
```

On Windows the bin directory also contains `codex.cmd` and `claude.cmd`.

After the install shell is restarted once, normal development remains:

```bash
codex
```

or:

```bash
claude
```

The user does **not** need to type a Web-Kit session command for normal context rollover.

Default threshold:

```text
50% current context used
```

## Transparent activation

The shim is deliberately cheap and conditional.

```text
normal codex / claude command
        ↓
~/.web-kit/bin shim
        ↓
search upward from current directory for .agent-kit.json
        │
        ├─ no Web Kit project
        │     → execute the real provider unchanged
        │
        └─ Web Kit project
              → start transparent Context Supervisor
              → preserve the provider's native interactive TUI
```

Provider administrative/noninteractive commands such as help/version/login/update/doctor are passed through rather than placed under interactive rollover control.

The real provider executable is resolved from `PATH` while excluding `~/.web-kit/bin`, preventing shim recursion.

## Native provider strategy

The transparent supervisor does **not** replace Codex or Claude with a custom chat UI and does not emulate `/clear` or `/new` keystrokes.

### Codex

The supervisor launches the normal interactive Codex CLI and injects a temporary `notify` override for that process only.

At every Codex `agent-turn-complete` notification, the bridge receives the thread/session ID and reads that session's current token-count/context-window state from Codex's local session record. It uses current context occupancy, not cumulative lifetime token spend.

Existing user `notify` configuration is preserved when it can be resolved: Web Kit's bridge invokes it after recording rollover telemetry.

### Claude Code

The supervisor launches the normal interactive Claude CLI with a temporary command-line `--settings` overlay containing a Web-Kit `statusLine` bridge.

Claude's status-line input reports current `context_window.used_percentage` after assistant messages. The bridge records that value and, when possible, delegates to the user's existing effective status-line command so Web Kit does not intentionally replace their display.

The temporary settings file is removed when the supervised process exits.

## Safe-boundary rule

Never intentionally terminate an AI in the middle of an edit/tool call because a token counter crossed the threshold.

Rollover is requested only from provider lifecycle signals that occur at an assistant-turn boundary:

```text
provider completes assistant turn
        ↓
bridge measures current context
        ↓
context < threshold
        → do nothing

context >= threshold
        → write safe-boundary rollover request
        → supervisor ends the now-idle old TUI
        → prepare validated handoff
        → start fresh native TUI
```

This means `50%` is a trigger for the **next safe provider-turn boundary**, not an instruction to kill an active edit at exactly 50.000%.

## Handoff preparation

Before starting the fresh interactive session, Web Kit attempts one read-only/programmatic resume of the old provider session solely to produce a compact JSON state summary.

That handoff pass must not continue implementation or make application changes.

If structured handoff generation fails, Web Kit still creates a conservative handoff from provider notification data plus the actual repository snapshot rather than replaying the full transcript.

Each handoff includes, when available:

- original request;
- provider/session provenance;
- current workflow phase and role;
- completed/current/pending work;
- decisions and constraints;
- changed-file summary;
- validation completed/pending;
- exact next action;
- observed context percentage and telemetry source;
- current Git HEAD/branch/status;
- both staged and unstaged changed files/diff statistics;
- source-authority reminder.

Managed state:

```text
.agent-core/state/context-rollover/
├── supervisors/
├── telemetry/
├── requests/
└── handoffs/

.agent-core/state/context-handoff.json
```

Per-run filenames use a unique supervisor ID so separate terminals do not share rollover request/telemetry files.

## Fresh-session rule

The newly launched native provider session receives a short bootstrap prompt pointing to the exact handoff file.

The fresh AI must:

1. read that handoff before broad rediscovery;
2. treat it as routing/state evidence rather than behavioral truth;
3. verify material claims against current source, current diff, relevant tests/build, and runtime evidence;
4. reconcile discrepancies in favor of current repository evidence;
5. avoid repeating completed work;
6. resume the recorded next safe action under the existing Web-Kit workflow.

Do not load the whole prior transcript merely to recreate context.

## Authority

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

The rollover supervisor may replace provider context. It never replaces plan/handoff/final validators.

## Global and project configuration

User-level defaults live in:

```text
~/.web-kit/config.json
```

Default:

```json
{
  "enabled": true,
  "threshold_percent": 50
}
```

A project may override the threshold with:

```json
{
  "context_rollover": {
    "threshold_percent": 50
  }
}
```

Threshold values are bounded to `10..90` by the supervisor.

Set `WEB_KIT_DISABLE_CONTEXT_SUPERVISOR=1` during installation when the user explicitly does not want user-level shims. Core Web Kit remains functional.

## Provider configuration preservation

The transparent layer is additive and best-effort:

- do not overwrite project `AGENTS.md`, `CLAUDE.md`, provider settings, or user provider configuration files just to monitor context;
- Codex monitoring is injected as a process-local CLI config override;
- Claude monitoring is injected through a temporary `--settings` overlay;
- provider administrative commands pass through;
- outside a Web-Kit project the real provider receives the original arguments unchanged.

If an enterprise/managed provider policy prevents telemetry injection, Web Kit must not weaken that policy. The provider remains usable; automatic threshold rollover may be unavailable for that invocation and should be reported rather than bypassed.

## Explicit Session Controller fallback

Installed projects still contain:

```text
.agent-core/bin/session-controller.mjs
```

and the npm launcher may still expose `npx @ihgen/web-kit session ...` for CI, deterministic headless automation, debugging, or environments where transparent native supervision cannot be installed.

That explicit controller is **not the normal developer UX**.

Normal developer UX after one Web-Kit installation is:

```text
cd project
codex
```

or:

```text
cd project
claude
```
