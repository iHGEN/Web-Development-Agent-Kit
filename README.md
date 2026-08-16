# Web Development Agent Kit

A web-only multi-agent engineering kit with project discovery, project-aware `AGENTS.md` generation, strict context/token routing, independent plan/handoff validation, maintainability review, security/testing gates, routed DevOps agents, and optional Graphify-assisted repository navigation.

## Quick start

After publishing the current release and creating the matching GitHub tag:

```bash
npx @ihgen/web-kit
```

The bare command is smart and idempotent:

```text
Web Kit missing
  -> install

Installed version < npm CLI version
  -> update

Installed version == npm CLI version
  -> doctor / health check

Installed version > npm CLI version
  -> no downgrade
  -> doctor the remembered installed source
```

Explicit commands remain available:

```bash
npx @ihgen/web-kit install
npx @ihgen/web-kit update
npx @ihgen/web-kit doctor
npx @ihgen/web-kit scan
```

See `docs/NPM_CLI.md` for version/source overrides and downgrade protection.

## Core principle

The agent team is stable. Technology/framework/database/DevOps expertise lives in skills.

```text
available != installed != active
```

A project may have many skills available, but each task receives only the agents, skills, files, symbols, contracts, and validation context it needs.

## Project-aware installation

Installation discovers the target project before finalizing agent instructions.

Generated project context includes project identity, detected technologies, shallow repository structure, manifests/configuration, test roots, migration/data roots, and optional repository-navigation capability such as Graphify readiness.

The machine-readable copy is stored at:

```text
.agent-core/index/project-profile.json
```

The structure map is routing metadata only. It never gives agents permission to read the whole repository.

## Conditional Graphify routing

Web Kit has two repository-navigation modes:

```text
Graphify absent/not ready
  -> standard routing

Graphify graph ready
  -> freshness gate
  -> Graphify-assisted routing when fresh
  -> standard fallback on refresh/query failure
```

Graphify is used to narrow repository exploration, not as behavioral authority. Exact source, current diffs, tests, and runtime evidence remain authoritative.

### Graph Refresh Gate

Starting with **v1.1.8**, Web Kit keeps the graph fresh at agent handoff boundaries.

Before the first Graphify query in a task, and once after each completed code-changing agent step, the workflow runs:

```bash
python .agent-core/rules/graphify-refresh.py --project . --task-id <task-id>
```

The gate stores state at:

```text
.agent-core/state/graphify.json
```

Behavior:

```text
repository unchanged since last successful refresh
  -> skip Graphify update

repository changed
  -> one incremental `graphify update .`

refresh succeeds
  -> fresh Graphify-assisted routing

refresh unavailable / failed / timed out
  -> standard routing for the task
  -> workflow continues
```

The gate deliberately runs once per completed changed state, not after every file write.

## Canonical workflow

`pack/rules/workflow.md` is the source-pack canonical lifecycle. Installed projects follow `.agent-core/rules/workflow.md`.

```text
USER
  ↓
CAPTAIN
  ↓
Record original prompt + classify task
  ↓
Project Profile + Repository Index
  ↓
Graphify ready?
  ├─ NO -> Standard routing
  └─ YES -> Graph Refresh Gate -> fresh Graphify-assisted routing or standard fallback
  ↓
Context Router
  ↓
Intent Contract + Read-only Discovery
  ↓
Impact Map + Implementation Design
  ↓
Execution Registry
  ↓
Plan Validator
  ├─ FAIL -> revise -> validate again
  └─ PASS -> LOCK PLAN
  ↓
Context Router -> one approved step
  ↓
Worker implements + local checks
  ↓
Graph Refresh Gate
  ↓
Handoff Validator
  ├─ FAIL -> worker fix -> refresh gate -> revalidate
  └─ PASS -> next step
  ↓
Repeat every approved step
  ↓
Code Simplifier -> refresh if code changed
  ↓
Affected tests
  ↓
Relevant specialist validation
  ↓
Final Integration Validator
  ├─ FAIL -> owning agent -> fix -> refresh -> handoff -> affected reviews
  └─ PASS
  ↓
CAPTAIN -> DONE
```

If new repository evidence invalidates the locked plan, the affected step stops and a Plan Delta must pass independent validation before work continues. No silent improvisation.

## Continuous context/token routing

Standard progression:

```text
project profile
  -> repository index
  -> targeted search
  -> symbol/range
  -> full file only when needed
  -> evidence-backed expansion
```

Graphify-assisted progression when fresh:

```text
project profile
  -> Graph Refresh Gate
  -> narrow Graphify query/path/neighbors
  -> small candidate symbol set
  -> exact source symbol/range
  -> targeted search for gaps
  -> full file only when needed
```

Rules:
- no unrestricted repository reads by default;
- installed skill does not mean active skill;
- never load the complete Graphify graph into model context;
- Graphify readiness does not imply freshness;
- compact evidence-linked findings instead of full transcripts;
- fresh context packet per approved implementation step;
- diff-first handoff/review validation;
- failure-specific context during recovery;
- token optimization never overrides correctness, security, or user intent.

## Agent groups

### Control / discovery
- Web Orchestrator / Captain
- Repository Indexer
- Context Router / Token Governor
- Intent & Discovery Agent
- Web Architect

### Implementation
- Frontend Developer
- Backend Developer
- Database / Persistence Engineer
- Realtime / Messaging Engineer
- External Integration Engineer

### Quality / validation
- Plan Validator
- Handoff Validator / Gatekeeper
- Final Integration Validator
- Code Simplifier / Maintainability Refactorer
- Test / QA Engineer
- Web Security Reviewer
- Web Performance Reviewer
- Web Code Reviewer
- Accessibility Reviewer
- API Contract Reviewer
- Bug Hunter / Edge-Case Adversary
- Technical Documentation Agent

### DevOps / platform
- DevOps / Release Engineer
- Observability / Reliability Engineer
- Docker / Container Engineer
- DevOps / Platform Engineer
- CI/CD Engineer
- Cloud Infrastructure Engineer
- Kubernetes Platform Engineer
- Infrastructure as Code Engineer
- DevSecOps Reviewer
- SRE / Reliability Engineer
- Release / Deployment Engineer
- Linux Operations Engineer

## Skill library

The central catalog covers web core/maintainability, languages, frontend/backend frameworks, APIs/realtime, authentication/authorization, security, databases/ORMs, distributed systems/jobs, storage/media, testing, performance/observability, Docker/CI/CD/cloud/Kubernetes/IaC/SRE/DevSecOps, package management, architecture patterns, and external integrations.

The project detector installs only the relevant subset, and the Context Router activates only the relevant skills for each task.

## Local Python CLI

```bash
python scripts/agent-kit.py scan /path/to/project
python scripts/agent-kit.py install /path/to/project
python scripts/agent-kit.py doctor /path/to/project
python scripts/agent-kit.py update /path/to/project
python scripts/agent-kit.py catalog
python scripts/agent-kit.py add-skill /path/to/project <skill-name>
```

## Remote / npm install

For npm users, prefer:

```bash
npx @ihgen/web-kit
```

Pinned `v1.1.8` after the tag and npm release exist:

```bash
npx @ihgen/web-kit@1.1.8
```

## Release mapping

The npm package version maps directly to the GitHub tag:

```text
@ihgen/web-kit@1.1.8
        ↓
iHGEN/Web-Development-Agent-Kit@v1.1.8
```

Create the matching GitHub tag before publishing the npm release.
