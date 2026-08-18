# Web Development Agent Kit

A vendor-neutral multi-agent engineering kit for web projects with project discovery, strict context/token routing, automatic fresh-context rollover, independent plan/handoff validation, security/testing gates, question-aware Graphify-assisted navigation, and routed DevOps agents.

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

Explicit commands:

```bash
npx @ihgen/web-kit install
npx @ihgen/web-kit update
npx @ihgen/web-kit doctor
npx @ihgen/web-kit scan
npx @ihgen/web-kit graphify
npx @ihgen/web-kit session codex --prompt "<task>"
npx @ihgen/web-kit session claude --prompt "<task>"
```

## Automatic context rollover

Long Codex/Claude tasks can run under Web Kit's Node Session Controller. The default rollover threshold is **50% current context usage**.

Codex:

```bash
npx @ihgen/web-kit session codex \
  --threshold 50 \
  --prompt "Implement the requested feature"
```

Claude Code:

```bash
npx @ihgen/web-kit session claude \
  --threshold 50 \
  --prompt "Implement the requested feature"
```

You can also use a task file:

```bash
npx @ihgen/web-kit session claude \
  --prompt-file ./task.md
```

Flow:

```text
start provider session
      ↓
execute one safe Web-Kit workflow unit
      ↓
write session-progress.json
      ↓
current context < 50% ?
   /                  \
 YES                  NO
  ↓                    ↓
resume same       validate compact handoff
provider session        ↓
                   context-handoff.json
                         ↓
                  fresh provider process
                         ↓
                  read compact handoff
                         ↓
             verify source / diff / tests
                         ↓
                 continue exact next step
```

The controller does **not** fake terminal keystrokes for `/clear` or `/new`. It owns Codex/Claude through their structured/headless execution modes and starts a genuinely fresh provider process/session when rollover is required.

In a controlled session (`WEB_KIT_SESSION_CONTROLLER=1`), the active AI is instructed not to run `/clear`, `/new`, `/compact`, or ask the user to reset context. Web Kit handles it automatically.

Rollover happens at the next **safe workflow-unit boundary**, not by intentionally killing an AI in the middle of an edit or tool call.

Managed state:

```text
.agent-core/state/session-controller.json
.agent-core/state/session-progress.json
.agent-core/state/context-handoff.json
.agent-core/state/handoffs/
```

The **Context Rollover Manager** role maintains compact state. A rollover handoff is routing/state evidence only: current repository source, current diff, tests/build, and runtime evidence remain authoritative.

If exact provider context telemetry is temporarily unavailable, the controller can make a conservative safety rollover after the configured number of missing-telemetry cycles. That is recorded separately instead of pretending an exact 50% measurement was observed.

Current automatic provider adapters:

```text
Codex CLI   ✅
Claude Code ✅
```

Other assistants still use the same Web-Kit engineering workflow; a provider adapter can be added later without duplicating the lifecycle.

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

All supported assistants route into the same lifecycle:

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
 .agent-core/rules/repository-navigation.md
                  ↓
   .agent-core/rules/context-rollover.md
```

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
Record original prompt + task ID
  ↓
Classify SMALL / MEDIUM / LARGE
  ↓
Project Profile + Repository Index
  ↓
Context Router / Token Governor
  ↓
Intent Contract + Read-only Discovery
  ↓
Impact Map
  ↓
Implementation Design
  ↓
Execution Registry
  ↓
Independent Plan Validator
  ├─ revise/reject/missing dependency -> planning loop
  └─ all required steps APPROVED
       ↓
    LOCK PLAN
       ↓
Fresh Context Packet for one step
       ↓
Selected Worker implements one approved step
       ↓
Step-local validation
       ↓
Graph Refresh Gate when Graphify is ready
       ↓
Independent Handoff Validator
       ↓
Repeat approved steps
       ↓
Code Simplifier
       ↓
Affected Tests
       ↓
Relevant Specialist Validation
       ↓
Final Integration Validator
       ↓
Captain closure against original request
       ↓
DONE
```

Automatic context rollover is an overlay around these workflow units; it does not skip or replace any phase, plan approval, handoff validation, or final integration gate.

Material evidence that invalidates a locked plan enters the Plan Delta validation loop. Agents do not silently improvise outside the approved plan.

## Context/token routing

Rules include:

- no unrestricted repository reads by default;
- project profile/index before broad source expansion;
- navigation tool selected by question type;
- installed skill does not mean active skill;
- fresh Context Packet per approved implementation step;
- compact evidence-linked handoffs instead of full transcripts;
- validated compact context-rollover handoffs instead of replaying the whole prior conversation;
- diff-first implementation review;
- never put the entire Graphify graph into model context;
- Graphify failure falls back to standard routing without blocking work;
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

Installed projects also receive Node helpers:

```bash
node .agent-core/bin/web-kit-update.mjs
node .agent-core/bin/session-controller.mjs --provider codex --prompt "<task>"
node .agent-core/bin/session-controller.mjs --provider claude --prompt "<task>"
```

The recommended public entry point remains:

```bash
npx @ihgen/web-kit
```

## Release mapping

The npm package version maps directly to a GitHub tag:

```text
@ihgen/web-kit@X.Y.Z
        ↓
iHGEN/Web-Development-Agent-Kit@vX.Y.Z
```

Create the matching GitHub tag before publishing the npm release.
