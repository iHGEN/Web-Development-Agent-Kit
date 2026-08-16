# Web Development Agent Kit

A web-only multi-agent engineering kit with project discovery, project-aware `AGENTS.md` generation, strict context/token routing, independent plan/handoff validation, maintainability review, security/testing gates, and routed DevOps agents.

## Quick start

After publishing `@ihgen/web-kit@1.1.5` and creating GitHub tag `v1.1.5`:

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

Generated project context includes:
- project name and directory;
- detected technology groups;
- shallow repository structure;
- manifests/build files;
- important configuration;
- test roots;
- migration/data roots.

The top of the generated `AGENTS.md` looks conceptually like:

```text
Project Agent Context — <project name>
├── Project Identity
├── Detected Technology Stack
├── Shallow Project Structure
├── Manifests / Configuration
├── Test Roots
├── Migration / Data Roots
└── Project-aware Routing Rules

Web Development Agent Kit
├── Canonical Workflow
├── Context / Token Rules
├── Maintainability Contract
├── Web Agent Team
├── DevOps Agent Team
└── Skill Policy
```

The machine-readable copy is stored at:

```text
.agent-core/index/project-profile.json
```

The structure map is routing metadata only. It never gives agents permission to read the whole repository.

## Canonical workflow

`pack/rules/workflow.md` is the single authoritative lifecycle.

```text
USER
  ↓
CAPTAIN
  ↓
Record original prompt verbatim
  ↓
Classify Small / Medium / Large
  ↓
Read Project Profile
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
Context Router again
       ↓
One approved step + one selected worker + relevant skills only
       ↓
Implement step
       ↓
Handoff Validator
  ├─ FAIL -> responsible worker -> revalidate
  └─ PASS -> next registered step
       ↓
Repeat every approved step
       ↓
All plan steps pass
       ↓
Code Simplifier
       ↓
Run affected tests again
       ↓
Relevant specialist validation
       ↓
Final Integration Validator
  ├─ FAIL -> owning agent -> fix -> handoff validation -> affected reviews
  └─ PASS
       ↓
CAPTAIN
       ↓
DONE
```

If new repository evidence invalidates the locked plan, the affected step stops and a Plan Delta must pass independent validation before work continues. No silent improvisation.

## Continuous context/token routing

The Context Router / Token Governor runs throughout the lifecycle.

Preferred read progression:

```text
project profile
  -> repository index
  -> targeted search
  -> symbol/range
  -> full file only when needed
  -> evidence-backed dependency expansion
```

Rules:
- no unrestricted repository reads by default;
- installed skill does not mean active skill;
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

## Remote shell install

Pinned release after creating tag `v1.1.5`:

```bash
curl -fsSL https://raw.githubusercontent.com/iHGEN/Web-Development-Agent-Kit/v1.1.5/bootstrap/install.sh \
  | bash -s -- \
      --repo iHGEN/Web-Development-Agent-Kit \
      --ref v1.1.5 \
      --project .
```

For npm users, prefer:

```bash
npx @ihgen/web-kit
```

## Release mapping

The npm package version maps directly to the GitHub tag:

```text
@ihgen/web-kit@1.1.5
        ↓
iHGEN/Web-Development-Agent-Kit@v1.1.5
```

Create the matching GitHub tag before publishing the npm release.
