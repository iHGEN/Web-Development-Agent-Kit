# Web Development Agent Kit

A web-only multi-agent engineering kit with strict intent preservation, targeted discovery, independent plan/handoff validation, automatic project skill detection, on-demand skill activation, DevOps routing, and context/token optimization.

## Core principle

The agent team is stable. Technology/framework/database/DevOps expertise lives in skills.

A large catalog is safe because **available != installed != active**. Each task receives only the agents, skills, files, symbols, contracts, and validation context it actually needs.

## Canonical workflow

`pack/rules/workflow.md` is the single authoritative lifecycle.

```text
                           USER
                            │
                            ▼
                ┌─────────────────────┐
                │ WEB ORCHESTRATOR    │
                │      CAPTAIN        │
                └──────────┬──────────┘
                           │
              Record original prompt verbatim
                           │
                           ▼
                    CLASSIFY TASK
                Small / Medium / Large
                           │
                           ▼
                ┌─────────────────────┐
                │ REPOSITORY INDEXER  │
                └──────────┬──────────┘
                           │
                  Structure only first
                           │
                           ▼
                ┌─────────────────────┐
                │ CONTEXT ROUTER      │
                │ TOKEN GOVERNOR      │
                └──────────┬──────────┘
                           │
                 Minimal discovery context
                           │
                           ▼
                ┌─────────────────────┐
                │ INTENT + DISCOVERY  │
                └──────────┬──────────┘
                           │
             Clarify WITHOUT changing meaning
                           │
                           ▼
                    INTENT CONTRACT
                           │
                           ▼
                  READ-ONLY DISCOVERY
                           │
              Existing code / dependencies /
             tests / APIs / ownership / config /
                framework-native capabilities
                           │
                           ▼
                     IMPACT MAP
                           │
                           ▼
                IMPLEMENTATION DESIGN
                           │
                           ▼
                ┌─────────────────────┐
                │ EXECUTION REGISTRY  │
                └──────────┬──────────┘
                           │
              Register every planned code step
                           │
                           ▼
                ┌─────────────────────┐
                │   PLAN VALIDATOR    │
                └──────────┬──────────┘
                           │
             ┌─────────────┴─────────────┐
             │                           │
           FAIL                         PASS
             │                           │
             ▼                           ▼
       Revise the plan                LOCK PLAN
             │                           │
             └──────────────►────────────┘
                                         │
                                         ▼
                              CONTEXT ROUTER AGAIN
                                         │
                         One approved step + one worker
                         + relevant skills/context only
                                         │
                                         ▼
                               IMPLEMENT STEP 1
                                         │
                                         ▼
                              HANDOFF VALIDATOR
                                         │
                      ┌──────────────────┴─────────────┐
                      │                                │
                    FAIL                              PASS
                      │                                │
                      ▼                                ▼
              Return to worker                 ROUTE NEXT STEP
                      │                                │
                      └──────────────►─────────────────┘
                                                       │
                                             repeat every step
                                                       │
                                                       ▼
                                           ALL PLAN STEPS PASS
                                                       │
                                                       ▼
                                          ┌──────────────────┐
                                          │ CODE SIMPLIFIER  │
                                          └────────┬─────────┘
                                                   │
                                                   ▼
                                            RUN TESTS AGAIN
                                                   │
                                                   ▼
                                      SPECIALIZED VALIDATION
                                                   │
                 Test / Security / Code / Performance / Accessibility /
                   Bug Hunter / API Contract / DevSecOps / SRE as relevant
                                                   │
                                                   ▼
                                   FINAL INTEGRATION VALIDATOR
                                                   │
                                    ┌──────────────┴──────────────┐
                                    │                             │
                                  FAIL                           PASS
                                    │                             │
                                    ▼                             ▼
                       Route failure to owning agent          CAPTAIN
                       → fix → Handoff Validator                  │
                       → affected reviews only                    ▼
                       → Final Validator again                   DONE
```

### Plan Delta rule

If implementation discovers evidence that materially invalidates the locked plan:

```text
STOP affected step
  -> record new evidence
  -> propose Plan Delta
  -> independent Plan Validator
  -> relock new plan version
  -> route fresh context
  -> continue
```

No silent improvisation outside the locked plan.

## Continuous context/token routing

The Context Router / Token Governor runs throughout the lifecycle, not just once.

- Before discovery: route only index facts, likely entry points, and discovery skills.
- Before each implementation step: route only that approved step, relevant symbols/contracts, and relevant skills.
- On context expansion: require the exact path/symbol/contract and the decision it will unblock.
- After implementation: validators work diff-first.
- During failure recovery: route only failure-specific context.
- Reuse compact evidence-linked summaries instead of repeatedly rereading unchanged source.

Preferred read order:

```text
index -> targeted search -> symbol/range -> full file only when needed -> evidence-backed expansion
```

Token optimization never overrides correctness, security, or user intent.

## What gets installed

On installation the kit copies only:
- baseline web skills;
- strong statically detected project skills;
- complete skill catalog metadata, not every skill body;
- the agent team;
- routing, context, workflow, contracts, and validation rules.

Additional catalog skills can be activated on demand.

## Main commands

```bash
python scripts/agent-kit.py scan /path/to/project
python scripts/agent-kit.py install /path/to/project
python scripts/agent-kit.py doctor /path/to/project
python scripts/agent-kit.py update /path/to/project
python scripts/agent-kit.py catalog
python scripts/agent-kit.py add-skill /path/to/project <skill-name>
```

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

The central catalog covers web core, languages, frontend/backend frameworks, APIs/realtime, authentication/authorization, security, databases/ORMs, distributed systems/jobs, storage/media, testing, observability/performance, DevOps/delivery, package management, architecture patterns, and external integrations.

The key rule remains:

```text
large central catalog
        ↓
project detection
        ↓
small installed project subset
        ↓
current task
        ↓
Context Router
        ↓
small active skill subset for one agent
```

## Remote installation

From the public repository/tag:

```bash
curl -fsSL https://raw.githubusercontent.com/iHGEN/Web-Development-Agent-Kit/v1.1.0/bootstrap/install.sh \
  | bash -s -- \
      --repo iHGEN/Web-Development-Agent-Kit \
      --ref v1.1.0 \
      --project .
```

The project remembers its source and can later update with:

```bash
python .agent-core/bin/remote-install.py --project .
```

See `docs/REMOTE_INSTALL.md`.
