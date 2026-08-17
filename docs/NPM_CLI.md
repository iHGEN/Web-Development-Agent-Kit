# npm / npx CLI

Web Development Agent Kit is designed to be installed and managed through npm/npx.

## Requirements

```text
Node.js 18+
npm / npx
```

A system Python installation is **not required** by Web Kit.

Graphify is optional. If Graphify is requested and needs Python internally, Web Kit can bootstrap `uv`; `uv` then manages Graphify's Python runtime separately.

## Smart default

Run inside a web project:

```bash
npx @ihgen/web-kit
```

The bare command is idempotent:

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

Installation markers:

```text
.agent-kit.json
.agent-kit-source.json
```

## Explicit commands

```bash
npx @ihgen/web-kit install
npx @ihgen/web-kit update
npx @ihgen/web-kit doctor
npx @ihgen/web-kit scan
npx @ihgen/web-kit graphify
```

## Project selection

Current directory:

```bash
npx @ihgen/web-kit
```

Another project:

```bash
npx @ihgen/web-kit --project ../my-web-app
```

## Version/source overrides

```bash
npx @ihgen/web-kit update --ref main

npx @ihgen/web-kit update \
  --repo OWNER/REPO \
  --ref vX.Y.Z

npx @ihgen/web-kit update \
  --source https://example.com/web-kit.zip
```

## Downgrade protection

A newer project is never silently downgraded.

An intentional semantic-version downgrade requires:

```bash
npx @ihgen/web-kit update \
  --ref vX.Y.Z \
  --allow-downgrade
```

## Package contents

The npm package intentionally stays small:

```text
package.json
bin/web-kit.js
bootstrap/remote-install.mjs
README.md
```

The npm package includes the small JS dependency needed to extract the downloaded GitHub archive. The full agent/skill/rules library remains in GitHub.

## How it works

```text
npx @ihgen/web-kit
        ↓
inspect target project metadata
        ↓
choose install / update / doctor
        ↓
bin/web-kit.js
        ↓
bootstrap/remote-install.mjs
        ↓
download matching GitHub kit source
        ↓
node scripts/agent-kit.mjs
        ↓
project profile + index
        ↓
managed AI roles + detected skills + routing/validators
```

Web Kit never requires `python`, `python3`, `py`, pip, or pipx during normal install/update/scan/doctor execution.

## AI instruction safety

Existing project-owned instruction files are preserved:

```text
AGENTS.md
CLAUDE.md
GEMINI.md
.github/copilot-instructions.md
.cursor/rules/ihgen-web-kit.mdc
```

Web Kit changes only its marked roles block. Missing files are created once with a compact project summary plus roles.

## Optional Graphify

```bash
npx @ihgen/web-kit graphify
```

If Graphify is missing:

```text
find uv
  ↓
uv missing? -> bootstrap uv
  ↓
uv installs/manages Graphify
  ↓
register Graphify for project
```

If the initial graph is missing, the current AI receives the temporary role:

```text
.agent-core/state/graphify-bootstrap-role.md
```

After the AI builds `graphify-out/graph.json`, it completes the role with:

```bash
node .agent-core/rules/graphify-setup.mjs --project . --complete
```

## Release mapping

```text
@ihgen/web-kit@X.Y.Z
        ↓
iHGEN/Web-Development-Agent-Kit@vX.Y.Z
```

Create the matching GitHub tag before publishing the npm version.

## Safety boundaries

Smart mode never:
- silently downgrades a newer project;
- treats all installed skills as active skills;
- grants agents unrestricted repository reads;
- overwrites project-owned AI instructions;
- modifies application source merely because the kit is installed.
