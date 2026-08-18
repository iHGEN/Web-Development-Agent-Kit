# Cross-AI Compatibility Policy

The Web Development Agent Kit is **assistant-neutral**. The engineering lifecycle, routing rules, validators, skills, Graph Refresh Gate, project profile, and context-rollover contract do not belong to any model vendor.

## Runtime contract

Web Kit requires **Node.js + npm only**. Web-Kit-managed installation, discovery, routing, doctor, AI-role management, Graphify freshness helpers, and the Session Controller run with Node.js.

A system Python installation is not required by Web Kit. Graphify is optional; if Graphify requires Python internally, Web Kit may bootstrap `uv` and let `uv` manage Graphify's Python runtime separately. If Graphify cannot be installed or used, standard routing remains fully functional.

## Canonical sources

Installed projects use:

- root AI instructions / native AGENTS consumers: `AGENTS.md`;
- canonical lifecycle: `.agent-core/rules/workflow.md`;
- canonical repository navigation rule: `.agent-core/rules/repository-navigation.md`;
- automatic context rollover rule: `.agent-core/rules/context-rollover.md`;
- automatic Session Controller: `.agent-core/bin/session-controller.mjs`;
- routing policy: `.agent-core/routing/context-policy.json`;
- project profile: `.agent-core/index/project-profile.json`.

Assistant-specific instruction files do not define separate workflows. They contain project/user instructions plus a small Web-Kit-managed **roles block** that points into the same lifecycle.

## Non-destructive instruction-file rule

Web Kit MUST NOT replace existing project AI instruction files.

Managed targets are:

- AGENTS-compatible assistants / Codex / Kimi: `AGENTS.md`;
- Claude Code: `CLAUDE.md`;
- Gemini CLI: `GEMINI.md`;
- GitHub Copilot: `.github/copilot-instructions.md`;
- Cursor: `.cursor/rules/ihgen-web-kit.mdc`.

Behavior:

```text
instruction file already exists
  -> preserve all project/user content
  -> add or refresh only the marked Web-Kit roles block

instruction file does not exist
  -> explore the project using lightweight structural discovery
  -> create the file once with a compact project summary
  -> add the Web-Kit roles block

later Web-Kit update
  -> do not rewrite the initial summary or user content
  -> refresh only the Web-Kit roles block
```

`AGENTS.web-kit.md` is a legacy artifact from older releases. New installs do not create it and it is not canonical. If an old project already contains it, Web Kit leaves it untouched.

The old `--force-agents` option may be accepted only for compatibility and MUST NOT overwrite existing AI instruction files.

## Managed roles

The roles block tells the current assistant to:

- follow `.agent-core/rules/workflow.md`;
- follow `.agent-core/rules/repository-navigation.md`;
- follow `.agent-core/rules/context-rollover.md` when running under the automatic Session Controller;
- use the project profile and routed context policy;
- act only in the role selected for the current phase;
- respect independent plan/handoff/final validators;
- use targeted source search for direct lookup;
- use refresh-gated Graphify for relationship/impact navigation when fresh;
- keep source/diff/tests/build/runtime authoritative over Graphify and context-handoff summaries;
- invoke Web-Kit helpers with Node.js, never requiring project users to install Python for Web Kit itself.

Existing content outside the roles markers is project-owned and must be preserved.

## Automatic Session Controller

Fully automatic context switching is currently implemented for **Codex CLI and Claude Code** through a provider-neutral Node controller:

```text
.agent-core/bin/session-controller.mjs
```

Default rollover threshold:

```text
50% current context usage
```

The controller owns provider processes through their structured/headless modes.

```text
below threshold
  -> resume the current provider session

threshold reached after one safe workflow unit
  -> validate/write compact context handoff
  -> start a new provider process/session
  -> inject/read the handoff
  -> verify handoff claims from current repository evidence
  -> continue exact workflow position
```

The controller deliberately does not emulate terminal keystrokes for provider slash commands. In a controlled session (`WEB_KIT_SESSION_CONTROLLER=1`) the assistant must not run `/clear`, `/new`, `/compact`, or ask the user to reset context. The controller owns the fresh-context transition.

Controlled state is stored under `.agent-core/state/`:

```text
session-controller.json
session-progress.json
context-handoff.json
handoffs/
```

The Context Rollover Manager is a Web-Kit control role. It preserves workflow state, not full conversation history.

Context handoffs are routing/state evidence only. Current repository source, current diff, tests/build, and runtime evidence remain authoritative.

Automatic rollover must occur only at a safe workflow-unit boundary. Do not intentionally terminate a provider in the middle of a code edit/tool call merely because context crosses the threshold during that unit.

Provider adapters may be added for other assistants later without creating a second engineering workflow. Unsupported providers continue to use their normal interactive mode until a tested adapter exists.

## Temporary Graphify bootstrap role

When the user opts into Graphify but `graphify-out/graph.json` does not exist, Graphify setup creates:

```text
.agent-core/state/graphify-bootstrap-role.md
```

Every managed AI roles block contains a permanent instruction to check for this file. If it exists, the **current AI** treats it as a temporary role and builds the initial Graphify graph inside the assistant using the Graphify skill registered for that assistant.

The temporary role instructs the AI to verify `graphify-out/graph.json`, then run:

```bash
node .agent-core/rules/graphify-setup.mjs --project . --complete
```

Completion:

- verifies the graph exists;
- removes `.agent-core/state/graphify-bootstrap-role.md`;
- marks the temporary role inactive;
- initializes Graph Refresh Gate state/metadata;
- returns the assistant to the normal Web-Kit workflow.

If the graph is not built yet, completion refuses to remove the role.

Graphify setup protects project AI instruction files around repo-local Graphify registration, so `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot instructions, and Cursor rules remain project-owned outside the Web-Kit roles block.

## Generic assistants

For any other coding assistant:

1. load `AGENTS.md` if the assistant supports the AGENTS convention;
2. otherwise point its project-instruction mechanism at the canonical Web-Kit lifecycle/rules;
3. respect the same temporary Graphify bootstrap role when present;
4. use Graphify only when installed and freshness-gated;
5. fall back to standard routed context if Graphify is unavailable;
6. use manual/native context handling unless a tested Session Controller provider adapter exists.

The engineering workflow must never require a specific model family.

## Graphify is model-independent

Graphify remains an optional repository-navigation accelerator.

```text
Graphify absent/not ready
  -> standard routed-context loop

Graphify installed but initial graph missing
  -> temporary current-AI bootstrap role
  -> build graph inside the assistant
  -> remove temporary role on successful completion

Graphify ready + fresh
  -> graphify-assisted relationship navigation

Graphify unavailable/stale/fails
  -> standard fallback
```

Graphify is navigation evidence only. Current repository source, diffs, tests, build output, and runtime evidence are authoritative.
