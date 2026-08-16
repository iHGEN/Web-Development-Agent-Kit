# npm / npx CLI

The Web Development Agent Kit exposes a tiny npm launcher so users can install and manage the kit without keeping the repository locally.

## Final commands

```bash
npx @ihgen/web-kit
```

Equivalent explicit install:

```bash
npx @ihgen/web-kit install
```

Other commands:

```bash
npx @ihgen/web-kit update
npx @ihgen/web-kit doctor
npx @ihgen/web-kit scan
```

Pin an exact npm/GitHub kit release:

```bash
npx @ihgen/web-kit@1.1.3
```

## Version mapping

The npm package version maps directly to the GitHub tag:

```text
@ihgen/web-kit@1.1.3
        ↓
iHGEN/Web-Development-Agent-Kit@v1.1.3
```

Therefore, create the matching GitHub tag **before** publishing the npm version.

## Release `1.1.3`

From a local clone of this repository:

```bash
git pull origin main

git tag -a v1.1.3 \
  -m "Web Development Agent Kit v1.1.3 - npm CLI"

git push origin v1.1.3
```

Then verify the npm package contents:

```bash
npm pack --dry-run
```

The npm package is intentionally tiny. It publishes only:

```text
package.json
bin/web-kit.js
bootstrap/remote-install.py
README.md (npm includes standard documentation automatically)
```

The full agent/skill library remains in GitHub.

## Publish to npm

Make sure your npm account or npm organization owns the `@ihgen` scope.

```bash
npm login
npm whoami
npm publish --access public
```

After publishing:

```bash
npx @ihgen/web-kit
```

## How it works

```text
npx @ihgen/web-kit
        ↓
bin/web-kit.js
        ↓
find Python 3
        ↓
bootstrap/remote-install.py
        ↓
download GitHub tag matching npm version
        ↓
run Web Kit project discovery
        ↓
generate project-aware AGENTS.md
        ↓
install routed agents + detected skills
```

The npm package does not duplicate the complete skill catalog.

## CLI routing

### Install

```bash
npx @ihgen/web-kit
```

Downloads the matching GitHub release and installs the kit into the current directory.

### Update

```bash
npx @ihgen/web-kit update
```

Re-runs discovery using the npm package's matching GitHub tag and refreshes managed agents, project context, routing, and detected skills.

For an intentional exact upgrade:

```bash
npx @ihgen/web-kit@1.2.0 update
```

### Doctor

```bash
npx @ihgen/web-kit doctor
```

Checks the project's installed skills, agent definitions, routing files, index, and configuration.

### Scan

```bash
npx @ihgen/web-kit scan
```

Scans the project without installing it and prints the detected stack/project index.

## Custom project path

```bash
npx @ihgen/web-kit scan --project ../my-app
```

## Test `main` before tagging

Before `v1.1.3` exists, test the current GitHub branch with:

```bash
node bin/web-kit.js scan --ref main --project /path/to/test-project
```

or install from main:

```bash
node bin/web-kit.js install --ref main --project /path/to/test-project
```

## Requirements

- Node.js 18+ for the npm launcher.
- Python 3 for the Web Kit installer/discovery engine.
- Network access to GitHub unless `--source` points to a local ZIP.
