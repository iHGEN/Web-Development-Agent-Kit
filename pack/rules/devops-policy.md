# DevOps / Platform Engineering Policy

DevOps is a routed part of the Web Development Kit. The Captain must choose the smallest operational
team needed for the task rather than giving every DevOps agent every infrastructure file.

## Routed roles

- Docker / Container Engineer
- DevOps / Platform Engineer
- CI/CD Engineer
- Cloud Infrastructure Engineer
- Kubernetes Platform Engineer
- Infrastructure as Code Engineer
- Linux Operations Engineer
- SRE / Reliability Engineer
- Release / Deployment Engineer
- DevSecOps Reviewer

## Mandatory principles

1. Reproducible builds.
2. Traceable release artifacts.
3. Least privilege.
4. No secrets in source, image layers, workflow logs, or generated artifacts.
5. Explicit environment configuration.
6. Health/readiness before production traffic.
7. Safe deployment and rollback.
8. Observable production behavior.
9. Backup/restore for critical state.
10. Reviewable infrastructure changes.
11. Preserve the current hosting/platform model unless change is required.
12. Security and reliability are release gates.

## Token routing

DevOps agents normally receive only:
- infrastructure/config files;
- relevant build manifests;
- deployment/runtime contracts;
- health endpoints;
- exact logs/errors required by the task;
- active DevOps skills.

They do not automatically receive the entire application source.
