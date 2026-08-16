# Web Development Agent Kit v1.0.0

A web-only multi-agent engineering kit with strict discovery/plan validation, independent handoff validation, automatic project skill detection, on-demand skill activation, and context/token routing.

## What gets installed

The **web agent team** is stable. Technology/framework/database/etc. expertise lives in skills.

On installation the kit copies only:
- baseline web skills;
- strong statically detected project skills;
- the complete skill catalog metadata (not every skill body);
- the agent team and routing/validation rules.

Additional catalog skills can be activated on demand with the CLI.

## Workflow

```text
User prompt
  -> Captain
  -> intent clarification (meaning preserved)
  -> repository index
  -> Context Router
  -> read-only targeted discovery
  -> impact map
  -> execution registry
  -> Plan Validator
  -> implementation steps
  -> Handoff Validator at boundaries
  -> Code Simplifier
  -> tests / security / performance / accessibility / review as relevant
  -> Bug Hunter
  -> Final Integration Validator
  -> Captain completion
```

## Commands

```bash
python scripts/agent-kit.py scan /path/to/project
python scripts/agent-kit.py install /path/to/project
python scripts/agent-kit.py doctor /path/to/project
python scripts/agent-kit.py update /path/to/project
python scripts/agent-kit.py catalog
python scripts/agent-kit.py add-skill /path/to/project <skill-name>
```

## Agents (24)

- Web Orchestrator / Captain (`web-orchestrator`)
- Repository Indexer (`repository-indexer`)
- Context Router / Token Governor (`context-router`)
- Intent & Discovery Agent (`intent-discovery`)
- Web Architect (`web-architect`)
- Frontend Developer (`frontend-developer`)
- Backend Developer (`backend-developer`)
- Database / Persistence Engineer (`database-engineer`)
- Realtime / Messaging Engineer (`realtime-engineer`)
- External Integration Engineer (`integration-engineer`)
- API Contract Reviewer (`api-contract-reviewer`)
- Accessibility Reviewer (`accessibility-reviewer`)
- DevOps / Release Engineer (`devops-release-engineer`)
- Observability / Reliability Engineer (`observability-engineer`)
- Plan Validator (`plan-validator`)
- Code Simplifier / Maintainability Refactorer (`code-simplifier`)
- Test / QA Engineer (`test-engineer`)
- Web Security Reviewer (`security-reviewer`)
- Web Performance Reviewer (`performance-reviewer`)
- Web Code Reviewer (`code-reviewer`)
- Bug Hunter / Edge-Case Adversary (`bug-hunter`)
- Handoff Validator / Gatekeeper (`handoff-validator`)
- Final Integration Validator (`final-integration-validator`)
- Technical Documentation Agent (`documentation-agent`)

## Complete skill catalog (232 skills)

### api-realtime (12)

`api-contract-testing`, `api-versioning`, `graphql`, `grpc`, `idempotency`, `openapi`, `pagination`, `rest-api`, `sse`, `webhook-consumer`, `webhooks`, `websockets`

### architecture-patterns (6)

`clean-architecture`, `domain-driven-design`, `microservices`, `modular-monolith`, `monorepo`, `vertical-slice`

### auth (14)

`abac`, `aspnet-identity`, `authentication`, `authorization`, `jwt`, `laravel-passport`, `laravel-sanctum`, `multi-tenancy`, `oauth2`, `oidc`, `rbac`, `refresh-tokens`, `session-auth`, `webauthn-passkeys`

### backend (12)

`aspnet-core`, `django`, `express`, `fastapi`, `fastify`, `fiber`, `gin`, `laravel`, `nestjs`, `nodejs`, `rails`, `spring-boot`

### core (21)

`accessibility-baseline`, `api-design`, `backward-compatibility`, `clean-code`, `code-simplification`, `configuration`, `dependency-management`, `documentation`, `error-handling`, `git-workflow`, `http`, `logging`, `maintainable-code`, `modular-design`, `performance-baseline`, `refactoring`, `security-baseline`, `testing-strategy`, `validation`, `web-architecture`, `web-core`

### data (19)

`database-design`, `drizzle`, `eloquent`, `entity-framework-core`, `indexing`, `migrations`, `mongodb`, `mongoose`, `mysql`, `postgresql`, `prisma`, `query-optimization`, `redis`, `sequelize`, `sql`, `sql-server`, `sqlite`, `transactions`, `typeorm`

### devops-delivery (14)

`apache`, `ci`, `cloudflare`, `deployment`, `docker`, `docker-compose`, `environment-management`, `github-actions`, `kubernetes`, `nginx`, `production-readiness`, `rollback`, `ssl-tls`, `terraform`

### distributed-jobs (16)

`background-jobs`, `bullmq`, `caching`, `concurrency`, `distributed-cache`, `distributed-locking`, `event-driven`, `eventual-consistency`, `hangfire`, `kafka`, `laravel-queues`, `pubsub`, `queues`, `rabbitmq`, `retry-resilience`, `scheduling`

### frontend (36)

`accessibility`, `angular`, `astro`, `bootstrap`, `browser-apis`, `browser-compatibility`, `client-routing`, `css`, `data-fetching`, `forms`, `frontend-performance`, `frontend-security`, `html`, `indexeddb`, `material-ui`, `nextjs`, `notifications`, `nuxt`, `pinia`, `pwa`, `react`, `redux`, `responsive-design`, `seo`, `service-workers`, `shadcn-ui`, `state-management`, `svelte`, `sveltekit`, `swr`, `tailwind`, `tanstack-query`, `vue`, `web-vitals`, `web-workers`, `zustand`

### integrations (11)

`ai-api-integration`, `analytics`, `elasticsearch`, `email`, `maps`, `oauth-providers`, `payments`, `search`, `sms`, `stripe`, `third-party-api`

### languages (10)

`csharp`, `go`, `java`, `javascript`, `kotlin`, `php`, `python`, `ruby`, `rust`, `typescript`

### observability-performance (13)

`audit-logging`, `backend-performance`, `bundle-optimization`, `database-performance`, `error-monitoring`, `health-checks`, `load-testing`, `metrics`, `opentelemetry`, `profiling`, `structured-logging`, `tracing`, `web-performance`

### packages (7)

`composer`, `dependency-upgrades`, `lockfiles`, `npm`, `nuget`, `pnpm`, `yarn`

### security (18)

`api-security`, `command-injection`, `cookie-session-security`, `cors`, `cryptography-basics`, `csrf`, `dependency-security`, `file-upload-security`, `open-redirects`, `owasp-asvs`, `rate-limiting`, `secrets-management`, `secure-headers`, `security-testing`, `sql-injection`, `ssrf`, `web-security`, `xss`

### storage-media (8)

`azure-blob`, `cdn`, `file-upload`, `image-processing`, `object-storage`, `s3`, `signed-urls`, `streaming-downloads`

### testing (15)

`api-testing`, `browser-testing`, `contract-testing`, `database-testing`, `e2e-testing`, `integration-testing`, `jest`, `mocking`, `pest`, `playwright`, `smoke-testing`, `test-data`, `unit-testing`, `vitest`, `xunit`

## Principle

A large central library is safe because **available != active**. A frontend agent working on one React component should normally receive only a few skills and a few relevant symbols, even if the central catalog contains 232 web skills.


## Install from a remote link

No local copy of the kit is required after you publish it.

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/web-dev-agent-kit/v1.1.0/bootstrap/install.sh \
  | bash -s -- --repo OWNER/web-dev-agent-kit --ref v1.1.0 --project .
```

The project remembers its source and can later update with:

```bash
python .agent-core/bin/remote-install.py --project .
```

See `docs/REMOTE_INSTALL.md`.

## Docker and complete DevOps routing

v1.1.0 adds routed agents for containers, platform engineering, CI/CD, cloud, Kubernetes,
infrastructure as code, Linux operations, SRE/reliability, releases, and DevSecOps.

A Docker task does not automatically load Kubernetes, Terraform, AWS, Azure, or unrelated
application source. The Context Router activates only the relevant DevOps agents, skills, configs,
contracts, and logs.
