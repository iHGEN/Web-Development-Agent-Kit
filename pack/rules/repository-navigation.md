# Repository Navigation Rule

This rule is a supporting rule for the canonical lifecycle in `.agent-core/rules/workflow.md`.
It defines **how to choose repository-navigation tools** without creating an alternate workflow.

## Runtime

Web Kit runtime helpers use Node.js. A system Python installation is not required for repository navigation or the Graph Refresh Gate.

Graphify remains optional. If Graphify needs Python internally, Web Kit's Graphify setup may bootstrap `uv` and let `uv` manage that runtime separately.

## Core authority

Current repository source is the behavioral source of truth.

Choose the navigation method by the question being answered, not simply by which tools are installed.

## Direct source lookup

For precise questions such as:

- Where is this function defined?
- Find this exact error message.
- Where is this endpoint implemented?
- Find references to this exact symbol.
- Inspect the current implementation of this file.

Use targeted current-source search first.

Preferred flow:

```text
rg / equivalent targeted current-source search
        ↓
exact file or symbol
        ↓
read current source
```

Use `rg` when shell access and ripgrep are available. If not, use the assistant/runtime's equivalent targeted source-search capability.

Do **not** force a Graphify query for a precise text/symbol/path lookup merely because a graph exists.

Targeted source search is especially valuable for direct lookup because it searches the files currently on disk, including uncommitted edits.

## Relationship / dependency / impact discovery

For questions such as:

- What calls this function?
- What depends on this service?
- What components are connected to this API?
- What could be affected by changing this interface?
- Trace this endpoint through service → database.
- Which modules are related to this feature?
- Which owner/contract is connected to these changed symbols?

Prefer Graphify when it is ready and fresh because the graph can narrow the relationship search before source is loaded into context.

Before the first Graphify query for a task, run:

```bash
node .agent-core/rules/graphify-refresh.mjs --project . --task-id <task-id>
```

Use Graphify only when `.agent-core/state/graphify.json` reports both:

```json
{
  "routing_mode": "graphify-assisted",
  "dirty": false
}
```

Preferred flow:

```text
project profile
      ↓
Graph Refresh Gate
      ↓
fresh Graphify relationship query
      ↓
small candidate symbol set
      ↓
exact source inspection
      ↓
source-verified behavior / impact
```

Do not broadly search the repository before Graphify when the question is primarily about relationships and a fresh graph can first reduce the candidate set.

## Graphify unavailable or unsuitable

If Graphify is:

- not installed;
- graph not ready;
- dirty;
- unavailable to the current runtime;
- refresh failed or timed out;
- query failed;
- incomplete for the needed decision;
- contradictory to current source;

immediately fall back to standard navigation:

```text
project profile
      ↓
repository index
      ↓
rg / equivalent targeted search
      ↓
exact symbol/range
      ↓
source verification
```

Graphify must never block the task.

## Authority model

Graphify is **navigation evidence**, not behavioral authority.

Use this mental model:

```text
Graphify
= Where should I look?

rg / targeted search + source
= What actually exists?

diff
= What changed?

tests / build / runtime
= Does the relevant behavior actually work?
```

When Graphify conflicts with current source, current diff, tests/build checks, or runtime evidence, the current repository/runtime evidence wins.

## Practical decision tree

```text
Need exact text/symbol/path?
        ↓
rg / equivalent targeted source search
        ↓
exact current source

Need relationships/dependencies/impact?
        ↓
Graphify ready?
   /         \
 NO          YES
 ↓             ↓
standard    Refresh Gate
search          ↓
              clean?
             /     \
           NO       YES
           ↓         ↓
       standard   Graphify
        search       ↓
               candidate symbols
                     ↓
               exact source reads
```

## Token-usage rule

The goal is:

```text
minimum repository exploration
        +
maximum source correctness
        +
no dependency on stale graph data
```

For direct source lookup, targeted search is usually the shortest path.
For relationship discovery, a fresh Graphify query should narrow the graph first so the workflow avoids broad source ingestion.
