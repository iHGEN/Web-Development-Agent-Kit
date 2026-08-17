# Project-aware AI Instructions

Web Development Agent Kit performs lightweight project discovery before synchronizing its managed AI roles.

## What installation discovers

The installer records:

- project name/directory;
- detected technology groups and skills;
- shallow project structure;
- important manifests/build files;
- important configuration files;
- test roots;
- migration/data-change roots;
- optional Graphify capability.

Source file contents are **not** embedded into the machine-readable project profile.

## Machine-readable project profile

Canonical generated project metadata is stored at:

```text
.agent-core/index/project-profile.json
```

The Context Router uses this profile for initial routing instead of requiring a generated project header inside every AI instruction file.

## Non-destructive instruction-file behavior

Web Kit manages these AI instruction locations:

```text
AGENTS.md
CLAUDE.md
GEMINI.md
.github/copilot-instructions.md
.cursor/rules/ihgen-web-kit.mdc
```

### If the file already exists

Web Kit preserves all existing project/user content exactly and adds or refreshes only:

```text
<!-- WEB-AGENT-KIT:AI-ROLES:START -->
...
<!-- WEB-AGENT-KIT:AI-ROLES:END -->
```

It does **not** inject a generated project summary into an existing file.

### If the file does not exist

Web Kit creates it once with:

```text
compact Project Summary
        +
Web Kit managed roles block
```

The one-time summary includes lightweight project identity/stack/structure information. Later Web-Kit updates leave that summary unchanged and refresh only the managed roles block.

## No parallel AGENTS file

Fresh installs do not create `AGENTS.web-kit.md`.

An `AGENTS.web-kit.md` left by an older Web-Kit release is a legacy artifact. New versions leave it untouched rather than silently deleting project files.

The old `--force-agents` behavior is deprecated/ignored. Web Kit does not overwrite project-owned AI instruction content.

## Roles point to canonical workflow

The managed roles block does not duplicate the lifecycle. It points assistants to:

```text
.agent-core/rules/workflow.md
.agent-core/rules/repository-navigation.md
.agent-core/routing/context-policy.json
.agent-core/index/project-profile.json
```

This keeps Codex, Kimi, Claude Code, Gemini CLI, Cursor, GitHub Copilot, and compatible assistants on one workflow.

## Runtime

Web Kit project discovery and AI-role management use Node.js:

```bash
node scripts/agent-kit.mjs install /path/to/project
```

Normal users should use:

```bash
npx @ihgen/web-kit
```

A system Python installation is not required.

## Refreshing after project changes

Running:

```bash
npx @ihgen/web-kit update
```

regenerates the machine-readable project profile/index and detected skills, while preserving project-owned instruction text and the one-time summaries already present in files Web Kit originally created.
