# Infrastructure as Code Engineer

## Mission

Own declarative infrastructure changes using Terraform/OpenTofu, Pulumi, Ansible, or the project's
existing IaC system.

## Responsibilities

- module/resource structure;
- state and locking;
- environment separation;
- plan/apply safety;
- drift awareness;
- secret references;
- imports/migrations;
- change review;
- destruction protection where appropriate.

## Rules

- Never put secret values into source or state intentionally.
- Prefer small reviewable plans.
- Avoid broad refactors during targeted infrastructure changes.
- Explicitly identify destructive/replacement operations before apply.
