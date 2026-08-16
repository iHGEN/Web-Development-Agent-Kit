# Install the Web Development Agent Kit From a Link

Project-aware `AGENTS.md` generation is versioned as `1.1.2` on `main`.

Installation now discovers the target project's name, detected stack, shallow structure, manifests/configuration, test roots, and migration/data roots before finalizing agent instructions. The generated project context is placed at the top of `AGENTS.md`, with the canonical Web-Kit workflow and roles underneath it.

Until the `v1.1.2` tag is created, use `main`. After tagging, prefer the pinned release command for reproducible installs.

## Current main — works immediately

### Linux / macOS / WSL

```bash
curl -fsSL https://raw.githubusercontent.com/iHGEN/Web-Development-Agent-Kit/main/bootstrap/install.sh \
  | bash -s -- \
      --repo iHGEN/Web-Development-Agent-Kit \
      --ref main \
      --project .
```

### Windows PowerShell

```powershell
$installer="$env:TEMP\web-agent-kit-install.ps1"

Invoke-WebRequest `
  "https://raw.githubusercontent.com/iHGEN/Web-Development-Agent-Kit/main/bootstrap/install.ps1" `
  -OutFile $installer

& $installer `
  -Repo "iHGEN/Web-Development-Agent-Kit" `
  -Ref "main" `
  -Project "."
```

## Recommended stable install after creating tag `v1.1.2`

### Linux / macOS / WSL

```bash
curl -fsSL https://raw.githubusercontent.com/iHGEN/Web-Development-Agent-Kit/v1.1.2/bootstrap/install.sh \
  | bash -s -- \
      --repo iHGEN/Web-Development-Agent-Kit \
      --ref v1.1.2 \
      --project .
```

### Windows PowerShell

```powershell
$installer="$env:TEMP\web-agent-kit-install.ps1"

Invoke-WebRequest `
  "https://raw.githubusercontent.com/iHGEN/Web-Development-Agent-Kit/v1.1.2/bootstrap/install.ps1" `
  -OutFile $installer

& $installer `
  -Repo "iHGEN/Web-Development-Agent-Kit" `
  -Ref "v1.1.2" `
  -Project "."
```

## What gets generated in the target project

```text
AGENTS.md
.agent-kit.json
.agent-kit-source.json
.agent-core/
├── agents/
├── rules/
├── contracts/
├── registry/
├── routing/
├── catalog/
└── index/
    ├── project-index.json
    └── project-profile.json
.agents/
└── skills/
```

`project-profile.json` is the machine-readable copy used for routing. The generated project context at the top of `AGENTS.md` is the human/agent-readable copy.

## Direct ZIP URL

```bash
curl -fsSL https://raw.githubusercontent.com/iHGEN/Web-Development-Agent-Kit/main/bootstrap/install.sh \
  | bash -s -- \
      --source https://your-host/web-dev-agent-kit-v1.1.2.zip \
      --project .
```

## Update without keeping the kit locally

A remote install records `.agent-kit-source.json` and installs:

```text
.agent-core/bin/remote-install.py
```

Run later using the remembered source/ref:

```bash
python .agent-core/bin/remote-install.py --project .
```

Updating also regenerates the project-aware profile and managed `AGENTS.md` so material stack/structure changes can be reflected.

To intentionally move to the next pinned version:

```bash
python .agent-core/bin/remote-install.py \
  --repo iHGEN/Web-Development-Agent-Kit \
  --ref v1.1.2 \
  --project .
```

For important projects, pin a release tag or commit instead of `main`, and optionally verify a published SHA-256 checksum.
