# Complete Web Library

This release contains 24 stable agent roles and 232 skills across 16 families.

## Agent design rule

Create agents for durable responsibilities and independent quality gates. Create skills for technologies, frameworks, patterns, and specialist knowledge.

## Skill installation rule

Baseline and strongly detected skills are copied automatically. Feature-specific skills remain in the central pack and can be activated only when a task actually requires them. This avoids bloating project context while keeping the full library available.

## Skill families

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


## DevOps expansion — v1.1.0

### New DevOps agents

- `ci-cd-engineer`
- `cloud-infrastructure-engineer`
- `devops-platform-engineer`
- `devsecops-reviewer`
- `docker-container-engineer`
- `infrastructure-as-code-engineer`
- `kubernetes-platform-engineer`
- `linux-operations-engineer`
- `release-deployment-engineer`
- `sre-reliability-engineer`

### DevOps / Delivery skills

- `ansible`
- `apache`
- `artifact-management`
- `artifact-signing`
- `aws`
- `azure`
- `azure-devops-pipelines`
- `backup-restore`
- `blue-green-deployment`
- `build-caching`
- `buildkite`
- `caddy`
- `canary-deployment`
- `capacity-planning`
- `cd`
- `cdn-operations`
- `certificate-management`
- `changelog`
- `ci`
- `circleci`
- `cloud-architecture`
- `cloud-cost-optimization`
- `cloud-iam`
- `cloud-networking`
- `cloudflare`
- `cloudflare-tunnel`
- `cloudflare-workers`
- `container-image-optimization`
- `container-registry`
- `container-scanning`
- `containerization`
- `conventional-commits`
- `cron-scheduling`
- `dast`
- `database-deployment`
- `dependency-scanning`
- `deployment`
- `devcontainers`
- `devsecops`
- `disaster-recovery`
- `dns`
- `docker`
- `docker-buildkit`
- `docker-compose`
- `docker-healthchecks`
- `docker-networking`
- `docker-performance`
- `docker-security`
- `docker-volumes`
- `dockerfile`
- `environment-management`
- `environment-promotion`
- `error-budgets`
- `feature-flags`
- `firewall`
- `gateway-api`
- `gcp`
- `github-actions`
- `gitlab-ci`
- `graceful-shutdown`
- `helm`
- `high-availability`
- `http2-http3`
- `iac-drift-management`
- `iac-module-design`
- `iac-scanning`
- `iac-state-management`
- `incident-response`
- `infrastructure-as-code`
- `jenkins`
- `kubernetes`
- `kubernetes-autoscaling`
- `kubernetes-ingress`
- `kubernetes-observability`
- `kubernetes-secrets`
- `kubernetes-security`
- `kustomize`
- `linux-server`
- `load-balancing`
- `log-rotation`
- `multi-arch-builds`
- `nginx`
- `opentofu`
- `pipeline-design`
- `post-deploy-verification`
- `preview-environments`
- `production-readiness`
- `provenance-attestation`
- `pulumi`
- `readiness-liveness`
- `release-automation`
- `reverse-proxy`
- `rollback`
- `rolling-deployment`
- `runbooks`
- `sast`
- `sbom`
- `secret-scanning`
- `self-hosted-runners`
- `semantic-versioning`
- `serverless`
- `service-mesh`
- `sli-slo-sla`
- `sre`
- `ssh-hardening`
- `ssl-tls`
- `supply-chain-security`
- `systemd`
- `terraform`
- `zero-downtime-deployment`

### Observability / Performance skills

- `alerting`
- `audit-logging`
- `backend-performance`
- `bundle-optimization`
- `database-performance`
- `error-monitoring`
- `grafana`
- `health-checks`
- `load-testing`
- `log-aggregation`
- `loki`
- `metrics`
- `opentelemetry`
- `profiling`
- `prometheus`
- `sentry`
- `structured-logging`
- `tracing`
- `web-performance`

**Total skill catalog: 334 skills.**
