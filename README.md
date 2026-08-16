# Web Development Agent Kit

A vendor-neutral multi-agent engineering kit for web projects with project discovery, strict context/token routing, independent plan/handoff validation, security/testing gates, Graphify-assisted navigation, and routed DevOps agents.

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
```

## Works across coding AIs

Web Kit has **one canonical workflow**, independent of the model or coding assistant.

Canonical installed sources:

```text
AGENTS.md / AGENTS.web-kit.md
.agent-core/rules/workflow.md
.agent-core/routing/context-policy.json
.agent-core/index/project-profile.json
```

Web Kit generates thin compatibility bridges rather than duplicating the workflow:

```text
Codex             -> AGENTS.md (native)
Kimi Code         -> AGENTS.md (native)
Claude Code       -> CLAUDE.md bridge
Gemini CLI        -> GEMINI.md bridge
GitHub Copilot    -> .github/copilot-instructions.md bridge
Cursor            -> .cursor/rules/ihgen-web-kit.mdc bridge
Other assistants  -> AGENTS.md when supported, or point their project instructions at the canonical files
```

Existing user instructions in `CLAUDE.md`, `GEMINI.md`, Copilot instructions, and a user-owned `AGENTS.md` are preserved. Web Kit updates only its marked bridge section.

See `.agent-core/rules/ai-compatibility.md` after installation.

## Optional Graphify setup

Graphify is **not required**. Without it, Web Kit uses the normal lightweight routed-context loop.

If you want graph-assisted repository navigation to reduce broad file exploration, opt in with:

```bash
npx @ihgen/web-kit graphify
```

or combine it with an update:

```bash
npx @ihgen/web-kit update --install-graphify
```

Web Kit prefers an isolated user-level Graphify installation with MCP support and runs repo-local assistant registration. If Graphify is not available or setup fails, Web Kit continues normally in standard mode.

After first-time Graphify setup, build the initial project graph once from your coding assistant:

```text
/graphify .
```

When `graphify-out/graph.json` exists, Web Kit can select the Graphify-assisted routing branch.

### Graph freshness

Web Kit includes a Graph Refresh Gate:

```text
worker completes one code-changing step
        ↓
Graph Refresh Gate
        ↓
repository unchanged? -> skip refresh
repository changed?   -> one incremental graphify update .
        ↓
refresh succeeds -> fresh graphify-assisted routing
refresh fails    -> standard routing fallback
        ↓
Handoff Validator
```

The gate is intentionally once per completed repository state, not once per file write.

Managed state:

```text
.agent-core/state/graphify.json
```

Graphify is navigation evidence only. Current source, diffs, tests, and runtime behavior remain authoritative.

## Canonical engineering lifecycle

```text
USER
  ↓
CAPTAIN
  ↓
Record original prompt
  ↓
Classify task
  ↓
Project Profile + Repository Navigation Mode
  ↓
Repository Indexer
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
Plan Validator
  ├─ FAIL -> revise -> validate again
  └─ PASS
       ↓
    LOCK PLAN
       ↓
Context Router
       ↓
Implement one approved step
       ↓
Graph Refresh Gate (when Graphify graph exists)
       ↓
Handoff Validator
       ↓
Repeat approved steps
       ↓
Code Simplifier
       ↓
Affected Tests
       ↓
Relevant specialist validation
(Security / Code / Performance / Accessibility / API / DevSecOps / Bug Hunter ...)
       ↓
Final Integration Validator
       ↓
Captain closure against original request
       ↓
DONE
```

If material repository evidence invalidates the locked plan, the affected step stops and enters a Plan Delta validation loop. No silent improvisation.

## Context/token routing

### Standard mode

```text
project profile
  -> repository index
  -> targeted search
  -> exact symbol/range
  -> full file only when needed
  -> evidence-backed expansion
```

### Graphify-assisted mode

```text
project profile
  -> Graph Refresh Gate
  -> narrow Graphify query/path/neighbors
  -> small candidate symbol set
  -> exact source symbol/range
  -> targeted search only for gaps
  -> evidence-backed expansion
```

Rules:

- no unrestricted repository reads by default;
- installed skill does not mean active skill;
- never dump the full Graphify graph into model context;
- Graphify failure must fall back to standard routing instead of blocking work;
- compact evidence-linked handoffs instead of full transcripts;
- fresh context packet per approved implementation step;
- diff-first handoff/review validation;
- token optimization never overrides correctness, security, or user intent.

## Project-aware installation

Installation discovers the target project and records:

- project name/directory;
- technology groups;
- shallow repository structure;
- manifests/build files;
- configuration files;
- test roots;
- migration/data roots;
- Graphify capability;
- cross-AI compatibility metadata.

Machine-readable profile:

```text
.agent-core/index/project-profile.json
```

## Local Python CLI

```bash
python scripts/agent-kit.py scan /path/to/project
python scripts/agent-kit.py install /path/to/project
python scripts/agent-kit.py doctor /path/to/project
python scripts/agent-kit.py update /path/to/project
python scripts/agent-kit.py graphify /path/to/project
python scripts/agent-kit.py catalog
python scripts/agent-kit.py add-skill /path/to/project <skill-name>
```

## Release mapping

The npm package version maps directly to a GitHub tag:

```text
@ihgen/web-kit@X.Y.Z
        ↓
iHGEN/Web-Development-Agent-Kit@vX.Y.Z
```

Create the matching GitHub tag before publishing the npm release.
