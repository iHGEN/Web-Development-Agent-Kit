# Web Development Agent Kit

A web-only multi-agent engineering kit with strict intent preservation, targeted discovery, independent plan/handoff validation, automatic project skill detection, project-aware `AGENTS.md` generation, DevOps routing, and context/token optimization.

## Core principle

The agent team is stable. Technology/framework/database/DevOps expertise lives in skills.

A large catalog is safe because:

```text
available != installed != active
```

Each task receives only the agents, skills, files, symbols, contracts, and validation context it actually needs.

## Project-aware installation

Starting with `v1.1.2`, installation discovers the target project before finalizing `AGENTS.md`.

The installer generates a lightweight project profile containing:

- project name;
- project directory;
- detected technology groups;
- shallow repository structure;
- important manifests/build files;
- important configuration files;
- test roots;
- migration/data-change roots.

The resulting `AGENTS.md` is organized like this:

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

The generated structure is routing metadata only. It never gives agents permission to read the whole repository.

See `docs/PROJECT_AWARE_AGENTS.md`.

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
Read generated Project Profile
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
  ├─ FAIL → revise → validate again
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
  ├─ FAIL → responsible worker → revalidate
  └─ PASS → next registered step
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
  ├─ FAIL → owning agent → fix → handoff validation → affected reviews
  └─ PASS
       ↓
CAPTAIN
       ↓
DONE
```

### Plan Delta rule

If implementation discovers evidence that materially invalidates the locked plan:

```text
STOP affected step
  → record new evidence
  → propose Plan Delta
  → independent Plan Validator
  → relock new plan version
  → route fresh context
  → continue
```

No silent improvisation outside the locked plan.

## Continuous context/token routing

The Context Router / Token Governor runs throughout the lifecycle.

Preferred read progression:

```text
project profile
  → repository index
  → targeted search
  → symbol/range
  → full file only when needed
  → evidence-backed dependency expansion
```

Rules:

- no unrestricted repository reads by default;
- installed skill does not mean active skill;
- compact evidence-linked findings instead of full prior transcripts;
- fresh context packet per approved implementation step;
- diff-first handoff/review validation;
- failure-specific context during recovery;
- token optimization never overrides correctness, security, or user intent.

## Main commands

```bash
python scripts/agent-kit.py scan /path/to/project
python scripts/agent-kit.py install /path/to/project
python scripts/agent-kit.py doctor /path/to/project
python scripts/agent-kit.py update /path/to/project
python scripts/agent-kit.py catalog
python scripts/agent-kit.py add-skill /path/to/project <skill-name>
```

Install/update regenerates the managed project profile and project-aware `AGENTS.md`.

## Agent groups

### Control / discovery

- Web Orchestrator / Captain (`web-orchestrator`)
- Repository Indexer (`repository-indexer`)
- Context Router / Token Governor (`context-router`)
- Intent & Discovery Agent (`intent-discovery`)
- Web Architect (`web-architect`)

### Implementation

- Frontend Developer (`frontend-developer`)
- Backend Developer (`backend-developer`)
- Database / Persistence Engineer (`database-engineer`)
- Realtime / Messaging Engineer (`realtime-engineer`)
- External Integration Engineer (`integration-engineer`)

### Quality / independent validation

- Plan Validator (`plan-validator`)
- Handoff Validator / Gatekeeper (`handoff-validator`)
- Final Integration Validator (`final-integration-validator`)
- Code Simplifier / Maintainability Refactorer (`code-simplifier`)
- Test / QA Engineer (`test-engineer`)
- Web Security Reviewer (`security-reviewer`)
- Web Performance Reviewer (`performance-reviewer`)
- Web Code Reviewer (`code-reviewer`)
- Accessibility Reviewer (`accessibility-reviewer`)
- API Contract Reviewer (`api-contract-reviewer`)
- Bug Hunter / Edge-Case Adversary (`bug-hunter`)
- Technical Documentation Agent (`documentation-agent`)

### DevOps / platform

- DevOps / Release Engineer (`devops-release-engineer`)
- Observability / Reliability Engineer (`observability-engineer`)
- Docker / Container Engineer (`docker-container-engineer`)
- DevOps / Platform Engineer (`devops-platform-engineer`)
- CI/CD Engineer (`ci-cd-engineer`)
- Cloud Infrastructure Engineer (`cloud-infrastructure-engineer`)
- Kubernetes Platform Engineer (`kubernetes-platform-engineer`)
- Infrastructure as Code Engineer (`infrastructure-as-code-engineer`)
- DevSecOps Reviewer (`devsecops-reviewer`)
- SRE / Reliability Engineer (`sre-reliability-engineer`)
- Release / Deployment Engineer (`release-deployment-engineer`)
- Linux Operations Engineer (`linux-operations-engineer`)

## Skill library

The central catalog covers:

- web core and maintainability;
- TypeScript/JavaScript/C#/PHP and other languages;
- React/Next/Vue and frontend engineering;
- ASP.NET Core/Laravel and backend frameworks;
- APIs/realtime;
- auth/security;
- databases/ORMs;
- distributed systems/jobs;
- storage/media;
- testing;
- performance/observability;
- Docker/CI/CD/cloud/Kubernetes/IaC/SRE/DevSecOps;
- packages, architecture patterns, and integrations.

The skill router installs and activates only the relevant subset.

## Remote installation

### Current main

```bash
curl -fsSL https://raw.githubusercontent.com/iHGEN/Web-Development-Agent-Kit/main/bootstrap/install.sh \
  | bash -s -- \
      --repo iHGEN/Web-Development-Agent-Kit \
      --ref main \
      --project .
```

### Recommended stable install after creating `v1.1.2`

```bash
curl -fsSL https://raw.githubusercontent.com/iHGEN/Web-Development-Agent-Kit/v1.1.2/bootstrap/install.sh \
  | bash -s -- \
      --repo iHGEN/Web-Development-Agent-Kit \
      --ref v1.1.2 \
      --project .
```

The project remembers its source and can later update with:

```bash
python .agent-core/bin/remote-install.py --project .
```

See `docs/REMOTE_INSTALL.md`.
