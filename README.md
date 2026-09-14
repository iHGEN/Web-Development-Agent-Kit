# Web Development Agent Kit

A vendor-neutral multi-agent engineering kit for web projects with implementation-first routing, evidence-based job/project progress, transparent fresh-context rollover, proportional planning/validation, security/testing gates, question-aware Graphify-assisted navigation, and routed DevOps agents.

## Runtime requirement

Web Kit requires only:

```text
Node.js
npm
```

Web Kit itself does **not** require Python, pip, or pipx.

Graphify is optional. Graphify uses Python internally, but when you opt into Graphify, Web Kit can bootstrap `uv` and let `uv` manage Graphify's Python runtime. The user does not need to manually install Python for Web Kit.

If Graphify or uv cannot be installed, Web Kit continues normally in standard routed-context mode.

## Quick start

Install/update Web Kit in the project:

```bash
npx @ihgen/web-kit
```

The bare command is smart and idempotent:

```text
Web Kit missing                 -> install
Installed version < CLI version -> update
Installed version = CLI version -> doctor
Installed version > CLI version -> no downgrade; doctor
```

Explicit maintenance/status commands:

```bash
npx @ihgen/web-kit install
npx @ihgen/web-kit update
npx @ihgen/web-kit doctor
npx @ihgen/web-kit scan
npx @ihgen/web-kit graphify
npx @ihgen/web-kit status
npx @ihgen/web-kit status --task-id TASK-042
npx @ihgen/web-kit progress help
npx @ihgen/web-kit security-review
```

Inside a capable AI provider, the security review can also be invoked as:

```text
run security-review
run security-review deep
run security-review base main
```

## Implementation-first workflow

Web Kit routes by required expertise, not by ceremony. Planning exists to unlock implementation; it is not the default deliverable.

```text
Right Agent
    ↓
Minimum Sufficient Context
    ↓
Implement
    ↓
Verify
    ↓
Track Real Progress
    ↓
Continue
```

Classification changes the workflow:

```text
SMALL
  targeted discovery -> implement -> local check -> review -> validate -> done

MEDIUM
  targeted discovery -> 3-6 execution bullets -> implement -> test/review -> validate -> done

LARGE / HIGH-RISK
  discovery/design -> formal plan -> independent plan validation
  -> implementation -> specialist/final gates
```

After initial discovery, two consecutive planning/routing/prose-only cycles without concrete implementation/verification evidence trigger the anti-slop guard. Plan-required work keeps its required approval gate; plan-free/approved work is pushed back to implementation.

Normal implementation work targets roughly:

```text
implementation + verification: 80-90%
planning + routing + summaries: 10-20%
```

This is a diagnostic target; required safety work is never skipped just to improve the ratio.

## Job progress and project/application status

Web Kit tracks the current AI task separately from the whole application/project.

```text
Job Progress     = state of one user task
Project Status   = evidence-backed state of the application/project
```

Job state is stored under:

```text
.agent-core/state/jobs/<task-id>.json
.agent-core/state/metrics/workflow-efficiency.json
```

Whole-project/application status is stored under:

```text
.agent-core/state/project-status.json
```

Default progress weighting keeps planning from making an unimplemented task look mostly complete:

```text
SMALL:  discovery 5 | implementation 70 | testing 15 | review 5 | validation 5
MEDIUM: discovery 10 | planning 5 | implementation 60 | testing 15 | review 5 | validation 5
LARGE:  discovery 10 | planning 15 | implementation 45 | testing 15 | review 10 | validation 5
```

Show tracked jobs, project status, and workflow efficiency:

```bash
npx @ihgen/web-kit status
```

Show one task:

```bash
npx @ihgen/web-kit status --task-id TASK-042
```

Project/application percentages require evidence; Web Kit does not treat an AI's intuitive completion guess as project status.

## Transparent automatic context rollover

The normal Web-Kit install also installs a small user-level supervisor under `~/.web-kit` and adds its shim directory to the user's shell PATH.

Open a new terminal once after the first setup. From then on, **use the AI exactly as usual**:

```bash
cd my-project
codex
```

or:

```bash
cd my-project
claude
```

There is no required daily `npx`, `wk`, `session`, or `--prompt` command.

### Activation behavior

```text
normal codex / claude
        ↓
~/.web-kit/bin transparent shim
        ↓
Web-Kit project found above CWD?
      /                         \
    NO                           YES
     ↓                            ↓
real provider unchanged     native provider TUI
                                  ↓
                         context supervisor active
```

Outside projects containing a valid `.agent-kit.json`, the shim simply passes the original provider command through.

Provider administrative/noninteractive commands also pass through rather than being forced into interactive rollover control.

### Default threshold

```text
50% current context used
```

At a safe assistant-turn boundary:

```text
native Codex / Claude
        ↓
assistant turn completes
        ↓
measure current context + work evidence
        ↓
      < 50%
        └── continue the same native session

      >= 50%
        ↓
finish current safe work/check
        ↓
persist compact job state + exact next action
        ↓
end the now-idle old TUI
        ↓
start a genuinely fresh native provider TUI
        ↓
verify current source / diff / tests / runtime
        ↓
continue the recorded next action
```

Web Kit does **not** fake `/clear` or `/new` terminal keystrokes and does not replace Codex/Claude with a custom chat UI.

The threshold is checked at a provider turn boundary, so Web Kit does not intentionally kill an AI in the middle of an edit/tool call to hit exactly 50.000%.

### Provider telemetry and work evidence

Codex is supervised with a process-local turn-complete notifier. The notifier gives Web Kit the active thread/session ID, which is used to read that Codex session's current context/token-count state. Existing user notify configuration is preserved on a best-effort basis.

Claude Code is supervised with a temporary `--settings` overlay that installs a status-line bridge. The bridge receives the provider's current `context_window.used_percentage`; when possible it also delegates to the user's existing status-line command.

For supervised Codex/Claude sessions, the provider bridge also compares bounded repository fingerprints at safe turns. Real repository changes can be recorded as implementation evidence; repeated no-delta turns during implementation feed the anti-slop guard. Generated Web-Kit state/security-review artifacts are excluded from implementation evidence, and raw untracked file contents are not persisted by this progress fingerprinting.

No provider configuration file is rewritten just to monitor context.

### Rollover state

Project-local state is kept under:

```text
.agent-core/state/context-rollover/
├── supervisors/
├── telemetry/
├── requests/
├── turns/
└── handoffs/

.agent-core/state/jobs/
.agent-core/state/project-status.json
.agent-core/state/metrics/workflow-efficiency.json
.agent-core/state/context-handoff.json
```

A rollover handoff is routing/state evidence only. Current repository source, current diff, relevant tests/build, and runtime evidence remain authoritative.

The **Context Rollover Manager** role tells a fresh AI to verify the compact state, avoid repeating completed work, and resume the exact next safe action rather than restarting discovery/planning.

### Global configuration

The user-level supervisor stores defaults at:

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

A project may override the threshold using `.agent-kit.json`:

```json
{
  "context_rollover": {
    "threshold_percent": 50
  }
}
```

Use `WEB_KIT_DISABLE_CONTEXT_SUPERVISOR=1` during Web-Kit installation if user-level shims are explicitly unwanted. The core engineering workflow still installs normally.

### Explicit Session Controller fallback

The older explicit controller remains available for deterministic headless automation, CI, debugging, or environments where user-level transparent shims cannot be installed:

```bash
npx @ihgen/web-kit session codex --prompt "<task>"
npx @ihgen/web-kit session claude --prompt "<task>"
```

Its "one safe workflow unit" boundary is classification-aware: it does not create a formal plan requirement for SMALL work and does not cause a fresh provider process to restart planning.

This is **not** the normal developer UX.

## Non-destructive AI instruction files

Web Kit never replaces project-owned AI instructions.

Managed targets include:

```text
AGENTS.md
CLAUDE.md
GEMINI.md
.github/copilot-instructions.md
.cursor/rules/ihgen-web-kit.mdc
```

Behavior:

```text
file already exists
  -> preserve all existing content
  -> add/update only Web Kit's marked roles block

file does not exist
  -> explore project with lightweight structural discovery
  -> create file once with compact project summary
  -> add Web Kit roles block

later update
  -> preserve project summary and user content
  -> refresh only roles block
```

Managed markers:

```text
<!-- WEB-AGENT-KIT:AI-ROLES:START -->
...
<!-- WEB-AGENT-KIT:AI-ROLES:END -->
```

New installs do not create `AGENTS.web-kit.md`. An old `AGENTS.web-kit.md` from an earlier release is treated as a legacy project artifact and is left alone.

## One workflow across coding AIs

All supported assistants route into the same provider-neutral lifecycle:

```text
Codex ────────────┐
Kimi ─────────────┤
Claude Code ──────┤
Gemini CLI ───────┤
Cursor ───────────┤
GitHub Copilot ───┤
Other assistants ─┘
                  ↓
       .agent-core/rules/workflow.md
                  ↓
 .agent-core/rules/implementation-first.md
                  ↓
 .agent-core/rules/repository-navigation.md
                  ↓
   .agent-core/rules/context-rollover.md
```

The workflow/rules are provider-neutral. Transparent automatic turn telemetry/progress adapters currently cover the providers implemented by the supervisor (Codex and Claude); other assistants still consume the same repository workflow/routing/state rules without those provider-specific telemetry guarantees.

The assistant-specific files contain roles and project-owned instructions, not separate copies of the engineering workflow.

## Project-aware installation

Installation performs lightweight project discovery and records:

- project name/directory;
- detected technology groups and relevant skills;
- shallow repository structure;
- manifests/build files;
- configuration files;
- test roots;
- migration/data roots;
- Graphify capability;
- AI compatibility/role metadata;
- automatic context-rollover metadata.

Machine-readable profile:

```text
.agent-core/index/project-profile.json
```

Structural index:

```text
.agent-core/index/project-index.json
```

## Repository navigation rule

### Direct source lookup

For exact text, symbol, path, error, endpoint, or implementation lookup:

```text
rg / equivalent targeted current-source search
        ↓
exact file or symbol
        ↓
current source
```

### Relationship / dependency / impact discovery

When Graphify is ready:

```text
project profile
      ↓
Graph Refresh Gate
      ↓
fresh Graphify relationship query
      ↓
small candidate symbol set
      ↓
exact source verification
```

The Graph Refresh Gate is Node-based:

```bash
node .agent-core/rules/graphify-refresh.mjs \
  --project . \
  --task-id <task-id>
```

Graphify may be used only when `.agent-core/state/graphify.json` reports:

```json
{
  "routing_mode": "graphify-assisted",
  "dirty": false
}
```

Mental model:

```text
Graphify                 = Where should I look?
targeted search + source = What actually exists?
diff                     = What changed?
tests/build/runtime      = Does it actually work?
```

Graphify is navigation evidence only. Current source, current diff, tests/build output, and runtime evidence remain authoritative.

## Optional Graphify setup

Opt in with:

```bash
npx @ihgen/web-kit graphify
```

or:

```bash
npx @ihgen/web-kit update --install-graphify
```

Graphify setup flow:

```text
Graphify already available?
  -> register it for the project

Graphify missing?
  -> find uv
  -> if uv missing, bootstrap uv
  -> uv installs/manages Graphify and its Python runtime
  -> register Graphify for the project
```

Graphify project registration is wrapped so project-owned AI instruction files are restored byte-for-byte after registration. Web Kit's own roles remain controlled by Web Kit.

### Initial graph bootstrap

If Graphify is registered but `graphify-out/graph.json` does not exist, Web Kit creates:

```text
.agent-core/state/graphify-bootstrap-role.md
```

The current AI treats it as a temporary role and builds the graph using its registered Graphify skill, for example:

```text
/graphify .
```

or the assistant's Graphify skill invocation.

After the graph exists, the role instructs the AI to run:

```bash
node .agent-core/rules/graphify-setup.mjs \
  --project . \
  --complete
```

Completion refuses to remove the role until `graphify-out/graph.json` actually exists. After successful completion, the temporary role is deleted and normal refresh-gated Graphify navigation begins.

## Canonical engineering lifecycle

```text
USER
  ↓
CAPTAIN
  ↓
Create/reuse task + classify SMALL / MEDIUM / LARGE (+ high-risk escalation)
  ↓
Minimum repository evidence + Context Router
  ↓
┌──────────────── SMALL ────────────────┐
│ targeted discovery -> implementation │
│ -> local checks -> review -> validate│
└───────────────────────────────────────┘
                 or
┌─────────────── MEDIUM ────────────────┐
│ targeted discovery -> 3-6 bullets    │
│ -> implementation -> test/review     │
│ -> final validation                  │
└───────────────────────────────────────┘
                 or
┌──────────── LARGE / HIGH-RISK ───────┐
│ discovery/design -> formal plan      │
│ -> independent Plan Validator        │
│ -> implementation/specialist gates  │
│ -> final validation                  │
└───────────────────────────────────────┘
  ↓
Evidence-backed job/project status
  ↓
DONE
```

The Context Router, specialist agents, Graphify refresh, handoff validation, code simplification, testing, performance/accessibility/API/DevSecOps/SRE review, and other gates are invoked when the task/change surface actually needs them. Installed capabilities are not mandatory lifecycle stops.

Material evidence that invalidates the active plan enters a Plan Delta only when it changes architecture/ownership, public contracts, schema/migrations, security/trust boundaries, major dependencies/platforms, destructive/deployment behavior, or requested product scope. Ordinary implementation discoveries do not restart planning.

## Security review

`run security-review` remains an independent read-only review of **implemented code**.

Use it after implementation/tests when the changed attack surface is security-sensitive and as a mandatory full release gate.

```text
implemented code
    ↓
tests/checks
    ↓
security-review
    ↓
findings? ── yes -> responsible developer fixes -> tests -> independent re-review
    │
    no
    ↓
final/release validation
```

The Security Reviewer never fixes its own findings. `--scan-only` remains informational/`INCONCLUSIVE` and cannot grant approval.

Terminal command:

```bash
npx @ihgen/web-kit security-review
```

Inside a capable AI provider:

```text
run security-review
```

## Context/token routing

Rules include:

- no unrestricted repository reads by default;
- project profile/index before broad source expansion;
- navigation tool selected by question type;
- installed skill does not mean active skill;
- compact Context Packets for coherent implementation chunks rather than every file edit;
- compact evidence-linked handoffs instead of full transcripts;
- validated compact context-rollover handoffs instead of replaying the whole prior conversation;
- diff-first implementation review;
- never put the entire Graphify graph into model context;
- Graphify failure falls back to standard routing without blocking work;
- stop discovery once the next safe implementation action is sufficiently supported;
- token optimization never overrides correctness, security, or user intent.

## Local Node CLI

The repository development CLI is Node-based:

```bash
node scripts/agent-kit.mjs scan /path/to/project
node scripts/agent-kit.mjs install /path/to/project
node scripts/agent-kit.mjs doctor /path/to/project
node scripts/agent-kit.mjs update /path/to/project
node scripts/agent-kit.mjs graphify /path/to/project
node scripts/agent-kit.mjs catalog
node scripts/agent-kit.mjs add-skill /path/to/project <skill-name>
```

Installed projects receive Node helpers including:

```text
.agent-core/bin/work-progress.mjs
.agent-core/bin/security-review.mjs
.agent-core/bin/session-controller.mjs
.agent-core/bin/context-supervisor.mjs
.agent-core/bin/provider-bridge.mjs
.agent-core/bin/supervisor-setup.mjs
.agent-core/bin/web-kit-update.mjs
```

The recommended project installation/update entry point remains:

```bash
npx @ihgen/web-kit
```

After the first supervisor setup, normal AI entry points remain:

```bash
codex
claude
```

## Release mapping

The npm package version maps directly to a GitHub tag:

```text
@ihgen/web-kit@X.Y.Z
        ↓
iHGEN/Web-Development-Agent-Kit@vX.Y.Z
```

Create the matching GitHub tag before publishing the npm release.
