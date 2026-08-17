# Web Development Agent Kit — Reference Instructions

This source file documents the Web-Kit behavior that managed AI role blocks point to. It is **not permission to overwrite an existing project `AGENTS.md`**.

## Installation policy

Web Kit explores the project and generates machine-readable metadata in `.agent-core/`.

For AI instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, GitHub Copilot instructions, and Cursor rules):

- if a file already exists, preserve all project/user-owned content and add/update only the marked Web-Kit roles block;
- if a file does not exist, create it once with a compact project summary plus the managed roles block;
- do not rewrite the one-time project summary on later updates;
- do not create a parallel `AGENTS.web-kit.md` on fresh installations;
- never use `--force` behavior to replace project-owned AI instructions.

Managed role markers:

```text
<!-- WEB-AGENT-KIT:AI-ROLES:START -->
...
<!-- WEB-AGENT-KIT:AI-ROLES:END -->
```

## Runtime contract

Web Kit requires **Node.js + npm only**.

Web-Kit managed helpers use Node:

```bash
node .agent-core/rules/graphify-refresh.mjs --project . --task-id <task-id>
```

Python, pip, and pipx are not Web-Kit runtime requirements.

Graphify is optional. If Graphify is requested, Web Kit may bootstrap `uv`; `uv` can manage Graphify's Python runtime without requiring the user to manually install Python first. If Graphify cannot be installed or used, Web Kit continues in standard routing mode.

## Canonical authority

The installed lifecycle is:

```text
.agent-core/rules/workflow.md
```

Repository navigation is governed by:

```text
.agent-core/rules/repository-navigation.md
```

Machine-readable project metadata is:

```text
.agent-core/index/project-profile.json
.agent-core/index/project-index.json
.agent-core/routing/context-policy.json
.agent-core/routing/agent-route-map.json
```

The original user request remains authoritative over later interpretations.

## Repository navigation

Use the navigation tool that matches the current question.

### Direct source lookup

For exact text, symbol, path, error message, endpoint, or current implementation lookup:

```text
rg / equivalent targeted current-source search
        ↓
exact file or symbol
        ↓
current source
```

Do not force Graphify before precise lookup merely because a graph exists.

### Relationship / dependency / impact discovery

For callers, dependencies, ownership, path tracing, connected components, contracts, or impact discovery:

```text
project profile
      ↓
Graph Refresh Gate
      ↓
fresh Graphify relationship query
      ↓
small candidate symbol set
      ↓
exact current source verification
```

Use Graphify only when `.agent-core/state/graphify.json` reports:

```json
{
  "routing_mode": "graphify-assisted",
  "dirty": false
}
```

Graphify is navigation evidence only.

```text
Graphify                 = Where should I look?
targeted search + source = What actually exists?
diff                     = What changed?
tests/build/runtime      = Does it actually work?
```

## Graph Refresh Gate

Before the first relationship-oriented Graphify query in a task, and once after every completed code-changing step before another agent relies on Graphify, run:

```bash
node .agent-core/rules/graphify-refresh.mjs --project . --task-id <task-id>
```

Do not manually run `graphify update .` as a replacement for the gate and do not refresh after every file write.

## Temporary Graphify bootstrap role

When Graphify is registered but no initial graph exists, Web Kit creates:

```text
.agent-core/state/graphify-bootstrap-role.md
```

The current AI must execute that temporary role, build the initial graph with its registered Graphify skill, verify `graphify-out/graph.json`, then run:

```bash
node .agent-core/rules/graphify-setup.mjs --project . --complete
```

Completion is refused while the graph is missing. Successful completion removes the temporary role.

## Canonical lifecycle

```text
USER
  ↓
CAPTAIN
  ↓
Classify task + task ID
  ↓
Project Profile + Repository Index
  ↓
Context Router / Token Governor
  ↓
Intent Contract
  ↓
Read-only Discovery
  ↓
Impact Map
  ↓
Implementation Design
  ↓
Execution Registry
  ↓
Independent Plan Validator
  ↓
APPROVED / LOCKED
  ↓
Fresh per-step Context Packet
  ↓
Selected Worker implements ONE approved step
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
Affected tests
  ↓
Relevant specialist validation only
  ↓
Final Integration Validator
  ↓
Captain closure against original request
  ↓
DONE
```

No agent may self-approve a plan, implementation handoff, or final integration result when an independent validator is required.

Material new evidence that invalidates the locked plan requires a Plan Delta and independent revalidation before affected work continues.

## Context/token policy

- Default-deny broad repository reads.
- Use the project profile/index before expanding source context.
- Route a fresh Context Packet for one approved step at a time.
- Installed skill does not mean active skill.
- Use compact evidence-linked findings instead of forwarding full transcripts.
- Use diff-first context after implementation.
- Never load the full Graphify graph into model context.
- Token optimization never overrides correctness, security, or user intent.
