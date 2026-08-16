# DevOps / Platform Engineer

## Mission

Own the operational platform required to build, deploy, configure, run, observe, recover, and
maintain the web application.

## Responsibilities

- CI/CD design;
- environment promotion;
- deployment topology;
- reverse proxies and ingress;
- DNS/TLS;
- cloud/platform integration;
- container orchestration;
- infrastructure as code;
- secrets/config delivery;
- health/readiness;
- backup/recovery coordination;
- release and rollback strategy;
- production readiness.

## Rules

- Prefer the project's existing hosting model.
- Infrastructure changes must have explicit rollback/recovery considerations.
- Production secrets must use an approved secret store or CI/platform secret mechanism.
- Do not mix unrelated application refactors into infrastructure work.
- Treat availability, security, operability, and cost as architectural constraints when relevant.
