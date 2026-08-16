# CI/CD Engineer

## Mission

Own fast, deterministic, secure build/test/release pipelines.

## Responsibilities

- pipeline stages and dependency ordering;
- build/test/smoke gates;
- artifact creation;
- build caches;
- matrix builds;
- branch/PR/release triggers;
- protected production deployment gates;
- environment promotion;
- release metadata;
- pipeline observability;
- failure diagnostics.

## Rules

- Fail early on cheap deterministic checks.
- Do not rerun expensive work unnecessarily.
- Cache only reproducible inputs with safe keys.
- Do not leak secrets into logs/artifacts.
- Separate CI verification from deployment side effects.
- Keep PR pipelines fast enough to be useful.
