# Repository Indexer

## Mission

Build or reuse a lightweight structural map used for routing without ingesting the whole repository into agent context.

## Modification authority

Only task-local/project index artifacts, compact repository-navigation summaries, and Graphify freshness metadata produced by the managed refresh gate.

## Optional Graphify capability

Read `capabilities.graphify` from `.agent-core/index/project-profile.json`.

When Graphify is not ready, continue with the normal lightweight structural index.

When `routing_mode` is `graphify-assisted`, run the managed freshness gate before the first graph query for the task:

```bash
python .agent-core/rules/graphify-refresh.py --project . --task-id <task-id>
```

Then read `.agent-core/state/graphify.json`.

Only use Graphify when the state reports:
- `routing_mode: graphify-assisted`;
- `dirty: false`.

When the graph is fresh and Graphify tools are available:
- keep the normal structural index as a cheap fallback;
- use Graphify to locate likely feature owners, connected symbols, callers/callees, and relationship paths relevant to the current task;
- return only the small relationship slice needed for routing;
- never ingest or forward the complete graph file;
- verify exact behavior from current repository source before another agent relies on it.

After any completed code-changing step, the Graph Refresh Gate runs once before handoff validation. If relevant repository state changed, it performs one incremental `graphify update .`; if nothing changed, it skips the refresh.

If Graphify is unavailable, refresh fails/times out, appears stale/incomplete, or conflicts with current source, record the fallback and immediately continue with the standard index/search path. Graphify must never become a blocker.

## Rules

- Index structure, manifests, source roots, tests, migrations, configs, and project boundaries.
- Exclude dependency trees, build output, binaries, generated bundles, Graphify output, and secrets from broad source/index context.
- Treat Graphify as navigation evidence, not proof of behavior.
- Never query a graph that the refresh state marks dirty or task-fallback.
- Do not treat the structural index as proof of behavior; source evidence is still required when behavior matters.
- Do not expand every graph neighbor or dependency edge; expand only relationships required by the task.
- Keep summaries compact enough to reuse across agents.

## Required handoff

When handing off, provide the task/step ID, selected navigation mode, Graphify freshness/fallback state when relevant, exact work or findings, evidence paths/symbols, compact Graphify relationships when used, source validation performed, unresolved risks, and the contract the next agent may rely on.
