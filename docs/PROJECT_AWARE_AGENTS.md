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

## Choose shared or local instructions

The default **shared** mode retains Web Kit's existing integration with project instructions:

Web Kit manages these AI instruction locations:

```text
AGENTS.md
CLAUDE.md
GEMINI.md
.github/copilot-instructions.md
.cursor/rules/ihgen-web-kit.mdc
```

If you want Web Kit for yourself without making its workflow mandatory for teammates,
choose **local** mode:

```bash
npx @ihgen/web-kit install --local-instructions
# In an already installed project:
npx @ihgen/web-kit update --local-instructions
```

Local mode generates separate instructions under:

```text
.agent-core/instructions/AGENTS.md
.agent-core/instructions/CLAUDE.md
.agent-core/instructions/GEMINI.md
.agent-core/instructions/copilot-instructions.md
.agent-core/instructions/ihgen-web-kit.mdc
```

These files are protected by a nested `.gitignore`, including when installation
happens before `git init`. Local mode removes **only Web Kit-marked role blocks**
from any older shared project instructions. Project-written text and any old
generated project summaries remain untouched. It refuses malformed or duplicate
markers rather than risk corrupting the file.

Web Kit's controlled `session codex` and `session claude` commands inject the
corresponding local instructions into each provider session, including after a
context rollover. Normal interactive `codex` / `claude` launches through Web
Kit's transparent supervisor also use them. Codex receives additive developer
instructions, and Claude appends the local instruction file to its normal
prompt. Existing custom Codex `developer_instructions` or Claude
`--append-system-prompt-file` arguments take precedence and are never silently
replaced; in that situation, use an explicit Web Kit `session` command.

Unwrapped providers and other AI clients do **not** auto-load the files from
this hidden directory. Other clients can load their local file explicitly,
but this mode does not imply automatic integration with their unmodified CLIs.

Your selection persists in `.agent-kit.json`, so subsequent plain `update`
commands keep the same scope. To deliberately return to shared mode, run
`npx @ihgen/web-kit update --shared-instructions`. That restores Web Kit role
blocks in the project's shared instruction files; it does not delete the local
copies.

## Non-destructive instruction-file behavior (shared mode)

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

## No extra root AGENTS file

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

Normal users can use:

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
