# Context Routing & Token Optimization

This kit uses **strict routed context**.

The goal is not "give every agent the whole repository."
The goal is "give each agent the minimum verified context needed to complete its responsibility."

## Hard rule — default deny

Agents do not have permission to read arbitrary repository files by default.

Before an agent reads source code, the Context Router must provide a **Context Packet** containing:
- task/step ID;
- agent role;
- objective;
- relevant acceptance criteria;
- allowed files/symbols or candidate paths;
- active skills;
- known contracts;
- relevant prior findings;
- token/context budget;
- expansion rules.

An agent may request more context, but must state why.

## Index first, source second

Preferred order:

1. Project metadata/index
2. Manifests/configuration
3. Search results / symbol references
4. Exact relevant symbols or file ranges
5. Full file only when necessary
6. Additional dependencies only when evidence requires expansion

Never begin by reading an entire repository or entire directory tree as source text.

## Read breadth control

Do not recursively follow every import.

Expand only when the current evidence proves another dependency is necessary to:
- understand behavior;
- modify the requested feature;
- verify a contract;
- run/understand a relevant test;
- validate a handoff;
- assess a material security/performance risk.

Record every expansion in the task context log.

## Task sizes

The router classifies work:

### SMALL
Typical:
- local bug;
- UI change;
- one endpoint adjustment;
- isolated validation change.

Start with at most 5 candidate source files.
Hard cap: 12 without Captain review.
Target active skills: <= 3.

### MEDIUM
Typical:
- feature across frontend/backend;
- auth flow change;
- new API + persistence;
- moderate integration.

Start with at most 10 candidate source files.
Hard cap: 25 without Captain review.
Target active skills: <= 5.

### LARGE
Typical:
- cross-service feature;
- broad architectural change;
- migration touching multiple boundaries.

Start with at most 15 candidate source files.
Hard cap: 40 without Captain review.
Target active skills: <= 7.

These are context-routing caps, not implementation file-change quotas.

## Skill routing

Installed skill != active skill.

A project may have 12 detected skills, but an agent should receive only the subset needed for its task.

Example:
A React repository also contains ASP.NET Core.

A `.tsx` UI task may get:
- web-core
- maintainable-code
- typescript
- react

It should not get:
- csharp
- aspnet-core
- postgresql

unless the task crosses those contracts.

## Context compaction

After discovery, do not pass full discovery transcripts to every agent.

Create a compact Context Packet:
- exact intent;
- relevant architecture summary;
- specific files/symbols;
- API/data contracts;
- approved plan step;
- risks;
- acceptance criteria.

Keep evidence references (paths/symbols) so downstream agents can request exact source if needed.

## Handoff compaction

Do not forward an agent's full working history.

Forward:
- what changed;
- why;
- exact files/symbols;
- relevant diff summary;
- verified behavior;
- tests;
- downstream contract;
- unresolved issue(s).

Handoff Validator should prefer the actual diff + relevant tests rather than rereading the entire project.

## Diff-first validation

After implementation:
1. inspect the change/diff first;
2. read changed symbols;
3. read directly affected tests/contracts;
4. expand to unchanged surrounding code only if necessary.

## Duplicate-read prevention

If a file has already been analyzed for the task:
- store a short task-local summary with evidence references;
- reuse the summary when sufficient;
- reread the source only if another agent needs details not captured in the summary or the file changed.

## Large files

Prefer:
- symbol search;
- relevant method/class/component ranges;
- relevant configuration section.

Do not read a 2,000-line file in full when one 50-line symbol is the actual ownership boundary.

## Generated/dependency files

Do not read:
- node_modules;
- vendor;
- build output;
- generated bundles;
- binaries;
- coverage output;

unless the user task explicitly concerns them.

## Budget overflow

If the agent believes it cannot safely complete the task inside the routed context:
1. stop;
2. request a specific expansion;
3. name the file/symbol/contract required;
4. explain why current context is insufficient.

The Context Router or Captain approves/rejects the expansion.
