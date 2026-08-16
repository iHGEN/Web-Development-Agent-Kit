# npm / npx CLI

The Web Development Agent Kit exposes a tiny npm launcher so users can install and manage the full GitHub-hosted kit without keeping the repository locally.

## Smart default

Run inside a web project:

```bash
npx @ihgen/web-kit
```

The bare command is **idempotent**. It reads `.agent-kit.json` and decides the safest action:

```text
Web Kit missing
  -> install

Installed version < npm CLI version
  -> update

Installed version == npm CLI version
  -> doctor / health check

Installed version > npm CLI version
  -> do NOT downgrade
  -> doctor the remembered installed source
```

The main installation marker is:

```text
.agent-kit.json
```

A normal remote installation also records:

```text
.agent-kit-source.json
```

This allows doctor/scan to use the source/ref that belongs to the installed project instead of silently changing versions.

## Explicit commands

```bash
npx @ihgen/web-kit install
npx @ihgen/web-kit update
npx @ihgen/web-kit doctor
npx @ihgen/web-kit scan
```

Explicit `install` and `update` use the npm package's matching GitHub release by default:

```text
@ihgen/web-kit@1.1.5
        ↓
iHGEN/Web-Development-Agent-Kit@v1.1.5
```

Create the matching GitHub tag before publishing the npm version.

## Downgrade protection

A newer project is never silently downgraded.

For example, if a project uses Web Kit `1.2.0` and someone runs `@ihgen/web-kit@1.1.5`, smart mode leaves the project version unchanged and runs health validation against the remembered installed source when available.

Explicit `install` / `update` also reject a semantic-version downgrade unless it is intentional:

```bash
npx @ihgen/web-kit update \
  --ref v1.1.5 \
  --allow-downgrade
```

Use `--allow-downgrade` carefully. It is handled by the npm launcher and is not forwarded into the project installer.

## Project selection

Current directory:

```bash
npx @ihgen/web-kit
```

Another project:

```bash
npx @ihgen/web-kit --project ../my-web-app
```

## Version and source overrides

Use a branch/tag/commit:

```bash
npx @ihgen/web-kit update --ref main
```

Use another repository:

```bash
npx @ihgen/web-kit update \
  --repo OWNER/REPO \
  --ref v1.1.5
```

Use a direct ZIP:

```bash
npx @ihgen/web-kit update \
  --source https://example.com/web-kit.zip
```

## Package size

The npm package is intentionally tiny and publishes only the launcher/runtime bootstrap:

```text
package.json
bin/web-kit.js
bootstrap/remote-install.py
README.md
```

The full agent/skill library remains in GitHub.

## How it works

```text
npx @ihgen/web-kit
        ↓
inspect target project
        ↓
choose install / update / doctor
        ↓
bin/web-kit.js
        ↓
bootstrap/remote-install.py
        ↓
download the required GitHub kit source
        ↓
run Web Kit discovery / install / validation
        ↓
project-aware AGENTS.md + routed agents + detected skills
```

## Release process

For `1.1.5`:

```bash
git pull origin main

git tag -a v1.1.5 \
  -m "Web Development Agent Kit v1.1.5 - smart idempotent npx"

git push origin v1.1.5

npm pack --dry-run
npm publish --access public
```

After publication:

```bash
npx @ihgen/web-kit
```

## Requirements

- Node.js 18+ for the npm launcher.
- Python 3 for the Web Kit installer/discovery engine.
- Network access to GitHub unless `--source` points to a local ZIP.

## Safety boundaries

Smart mode never:
- silently downgrades a newer project;
- treats all installed skills as active skills;
- grants agents unrestricted repository reads;
- modifies application source merely because the kit is installed.

Application code remains project-owned. The Web Kit manages its own agent/routing/skill metadata and generated project context.
