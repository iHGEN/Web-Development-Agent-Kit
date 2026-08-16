# Cross-AI Compatibility Policy

The Web Development Agent Kit is **assistant-neutral**. The engineering lifecycle, routing rules, validators, skills, Graph Refresh Gate, and project context do not belong to any model vendor.

## Canonical sources

Installed projects use:

- project instructions: `AGENTS.md`, or `AGENTS.web-kit.md` when a user-owned `AGENTS.md` is preserved;
- canonical lifecycle: `.agent-core/rules/workflow.md`;
- routing policy: `.agent-core/routing/context-policy.json`;
- project profile: `.agent-core/index/project-profile.json`.

Assistant-specific files are bridges only. They MUST NOT fork or duplicate the lifecycle.

## Native AGENTS.md consumers

Codex and Kimi Code consume repository `AGENTS.md` instructions natively. Other tools that support the AGENTS convention should use the same file.

If the repository already had a user-owned `AGENTS.md`, Web Kit preserves it, writes `AGENTS.web-kit.md`, and adds a small managed bridge section to the user file pointing to the Web-Kit lifecycle.

## Managed assistant bridges

Web Kit creates or updates only its marked section in these files:

- Claude Code: `CLAUDE.md`;
- Gemini CLI: `GEMINI.md`;
- GitHub Copilot: `.github/copilot-instructions.md`;
- Cursor: `.cursor/rules/ihgen-web-kit.mdc`.

Existing user instructions outside the Web-Kit bridge markers are preserved.

## Generic assistants

For any other coding assistant:

1. load the repository `AGENTS.md` convention if supported;
2. otherwise point the assistant's project-instruction mechanism at `AGENTS.md`/`AGENTS.web-kit.md` and `.agent-core/rules/workflow.md`;
3. use MCP or terminal Graphify queries only when Graphify is installed and the Graph Refresh Gate reports a fresh graph;
4. if the assistant cannot use Graphify, continue with the standard routed-context loop.

The workflow must never require a specific model family.

## Graphify is model-independent

Graphify is an optional repository-navigation accelerator. It may be used through native assistant integration, MCP, or terminal commands. The same graph can support different coding assistants.

Web Kit behavior remains:

```text
Graphify absent/not ready
  -> standard routed-context loop

Graphify ready + fresh
  -> graphify-assisted loop

Graphify unavailable/stale/fails
  -> standard fallback
```

Graphify is navigation evidence only. Current repository source, diffs, tests, and runtime evidence are authoritative.
