# Web Development Agent Kit

A vendor-neutral multi-agent engineering kit for web projects with project discovery, strict context/token routing, independent plan/handoff validation, security/testing gates, question-aware Graphify-assisted navigation, and routed DevOps agents.

## Quick start

```bash
npx @ihgen/web-kit
```

The bare command is smart and idempotent:

```text
Web Kit missing                  -> install
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
```

## Non-destructive AI instruction files

Web Kit explores the project first and generates `.agent-core/index/project-profile.json`, but it does **not** replace existing AI instruction files.

Managed targets:

```text
Codex / Kimi / AGENTS-compatible -> AGENTS.md
Claude Code                      -> CLAUDE.md
Gemini CLI                       -> GEMINI.md
GitHub Copilot                   -> .github/copilot-instructions.md
Cursor                           -> .cursor/rules/ihgen-web-kit.mdc
```

Behavior:

```text
instruction file already exists
  -> keep all existing project/user content
  -> add or refresh only the marked Web-Kit roles block

instruction file does not exist
  -> create it once
  -> add a compact discovered project summary
  -> add the Web-Kit roles block

later update
  -> leave user content and initial summary unchanged
  -> refresh only the managed roles block
```

New installs do not create `AGENTS.web-kit.md`. If an older project already has that legacy file, Web Kit leaves it untouched and `doctor` may report it as legacy.

`--force-agents` remains accepted only for backwards CLI compatibility; it no longer authorizes replacing AI instruction files.

## One workflow across coding AIs

Web Kit has one canonical lifecycle independent of model/vendor:

```text
AGENTS.md / assistant instruction file
        ↓
Web-Kit managed roles block
        ↓
.agent-core/rules/workflow.md
        ↓
.agent-core/rules/repository-navigation.md
        ↓
.agent-core/routing/context-policy.json
```

The roles block tells the assistant which phase/role it is allowed to perform and points it to the shared workflow rather than duplicating a Claude/Codex/Gemini/Cursor-specific lifecycle.

See `.agent-core/rules/ai-compatibility.md` after installation.

## Optional Graphify setup

Graphify is optional. Without it, Web Kit uses the normal routed-context loop.

Opt in with:

```bash
npx @ihgen/web-kit graphify
```

or:

```bash
npx @ihgen/web-kit update --install-graphify
```

Web Kit installs/registers Graphify for the project. If Graphify cannot be installed or configured, standard routing continues normally.

### Temporary current-AI initial-build role

Graphify's initial graph must be built **inside the coding assistant**. When Graphify is installed but `graphify-out/graph.json` does not exist, Web Kit creates:

```text
.agent-core/state/graphify-bootstrap-role.md
```

Every managed AI roles block says: if that file exists, the **current AI** must treat it as a temporary role and build the initial project graph using the Graphify skill registered for that assistant.

The temporary role tells the AI to:

```text
check graphify-out/graph.json
        ↓
missing?
  -> invoke Graphify for repository root
  -> /graphify . in slash-command assistants
  -> use the installed $graphify skill in Codex
        ↓
verify graphify-out/graph.json exists
        ↓
run:
python .agent-core/rules/graphify-setup.py --project . --complete
        ↓
remove/deactivate temporary role
        ↓
return to normal Web-Kit workflow
```

The completion command refuses to remove the temporary role if the graph has not actually been created.

Graphify setup does not need to rewrite `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or the other Web-Kit-managed AI instruction content after the roles block exists.

## Repository navigation rule

Web Kit does not force Graphify first for every question and does not force `rg` first for every question.

### Direct source lookup

For exact text/symbol/path questions:

```text
rg / equivalent targeted current-source search
        ↓
exact file/symbol
        ↓
current source
```

### Relationship / dependency / impact discovery

For callers, dependencies, ownership, cross-layer paths, or impact:

```text
Graphify ready?
   /       \
 NO        YES
 ↓          ↓
standard  Graph Refresh Gate
 search        ↓
             clean?
            /     \
          NO      YES
          ↓        ↓
       standard  narrow Graphify query
        search        ↓
                 candidate symbols
                       ↓
                  exact source
```

Mental model:

```text
Graphify                  = Where should I look?
rg / targeted source      = What actually exists?
diff                       = What changed?
tests / build / runtime    = Does it actually work?
```

## Graph freshness

Once the initial graph exists, Web Kit controls refresh cadence with the Graph Refresh Gate:

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

The gate runs once per completed changed repository state, not once per file write.

Managed runtime state:

```text
.agent-core/state/graphify.json
```

Graphify is navigation evidence only. Current source, current diff, tests/build, and runtime behavior remain authoritative.

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
Project Profile + Repository Navigation Decision
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
Graph Refresh Gate when applicable
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
       ↓
Final Integration Validator
       ↓
Captain closure against original request
       ↓
DONE
```

Material repository evidence that invalidates the locked plan enters a Plan Delta validation loop. No silent improvisation.

## Context/token routing

Standard routing:

```text
project profile
  -> repository index
  -> targeted search
  -> exact symbol/range
  -> full file only when needed
  -> evidence-backed expansion
```

Relationship-oriented Graphify routing:

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
- Graphify failure falls back to standard routing instead of blocking work;
- compact evidence-linked handoffs instead of full transcripts;
- fresh context packet per approved implementation step;
- diff-first handoff/review validation;
- token optimization never overrides correctness, security, or user intent.

## Project-aware installation

Installation discovers and records:

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
