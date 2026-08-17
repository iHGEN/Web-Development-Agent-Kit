# Install Web Development Agent Kit Remotely

## Requirement

Web Kit requires **Node.js + npm/npx only**. A system Python installation is not required.

## Recommended install

Inside the target project:

```bash
npx @ihgen/web-kit
```

Or explicitly:

```bash
npx @ihgen/web-kit install --project .
```

To test the latest GitHub `main` before a release tag exists:

```bash
npx @ihgen/web-kit install \
  --repo iHGEN/Web-Development-Agent-Kit \
  --ref main \
  --project .
```

## Thin bootstrap scripts

The repository still includes convenience bootstrap scripts, but they simply delegate to npm/npx and do not use Python.

### Linux / macOS / WSL

```bash
curl -fsSL https://raw.githubusercontent.com/iHGEN/Web-Development-Agent-Kit/main/bootstrap/install.sh \
  | bash -s -- --project . --repo iHGEN/Web-Development-Agent-Kit --ref main
```

### Windows PowerShell

```powershell
$installer = "$env:TEMP\web-kit-install.ps1"
Invoke-WebRequest `
  "https://raw.githubusercontent.com/iHGEN/Web-Development-Agent-Kit/main/bootstrap/install.ps1" `
  -OutFile $installer

& $installer `
  -Project "." `
  -Repo "iHGEN/Web-Development-Agent-Kit" `
  -Ref "main"
```

## What is generated

```text
.agent-kit.json
.agent-kit-source.json
.agent-core/
├── agents/
├── rules/
├── contracts/
├── registry/
├── routing/
├── catalog/
├── state/
├── bin/
│   └── web-kit-update.mjs
└── index/
    ├── project-index.json
    └── project-profile.json
.agents/
└── skills/
```

AI instruction files follow a non-destructive policy:

```text
file exists
  -> preserve project/user content
  -> add/update only Web Kit roles block

file missing
  -> create once with compact project summary
  -> add roles block
```

Managed targets include `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, GitHub Copilot instructions, and Cursor rules.

## Updating later

Recommended:

```bash
npx @ihgen/web-kit update --project .
```

Installed projects also receive:

```bash
node .agent-core/bin/web-kit-update.mjs
```

The updater uses npm/npx. It does not require Python.

## Direct ZIP/source override

```bash
npx @ihgen/web-kit install \
  --source https://your-host/web-kit.zip \
  --project .
```

Optional SHA-256 verification:

```bash
npx @ihgen/web-kit install \
  --source https://your-host/web-kit.zip \
  --sha256 <expected-sha256> \
  --project .
```

## Optional Graphify

```bash
npx @ihgen/web-kit graphify
```

If Graphify is absent, Web Kit can bootstrap `uv`; `uv` manages Graphify's Python runtime. If setup fails, standard routing remains available.

If the initial graph is missing, the current AI receives `.agent-core/state/graphify-bootstrap-role.md`. After creating `graphify-out/graph.json`, it completes the temporary role with:

```bash
node .agent-core/rules/graphify-setup.mjs --project . --complete
```

## Release pinning

For reproducible production use, publish a matching npm version and GitHub tag:

```text
@ihgen/web-kit@X.Y.Z
        ↓
iHGEN/Web-Development-Agent-Kit@vX.Y.Z
```

Then use:

```bash
npx @ihgen/web-kit@X.Y.Z
```
