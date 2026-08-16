# Install the Web Development Agent Kit From a Link

The canonical workflow update is versioned as `1.1.1` on `main`.

Until the `v1.1.1` tag is created, use the current `main` command below. After tagging, prefer the pinned release command for reproducible installs.

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

## Recommended stable install after creating tag `v1.1.1`

### Linux / macOS / WSL

```bash
curl -fsSL https://raw.githubusercontent.com/iHGEN/Web-Development-Agent-Kit/v1.1.1/bootstrap/install.sh \
  | bash -s -- \
      --repo iHGEN/Web-Development-Agent-Kit \
      --ref v1.1.1 \
      --project .
```

### Windows PowerShell

```powershell
$installer="$env:TEMP\web-agent-kit-install.ps1"

Invoke-WebRequest `
  "https://raw.githubusercontent.com/iHGEN/Web-Development-Agent-Kit/v1.1.1/bootstrap/install.ps1" `
  -OutFile $installer

& $installer `
  -Repo "iHGEN/Web-Development-Agent-Kit" `
  -Ref "v1.1.1" `
  -Project "."
```

## Direct ZIP URL

```bash
curl -fsSL https://raw.githubusercontent.com/iHGEN/Web-Development-Agent-Kit/main/bootstrap/install.sh \
  | bash -s -- \
      --source https://your-host/web-dev-agent-kit-v1.1.1.zip \
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

To intentionally move to the next pinned version:

```bash
python .agent-core/bin/remote-install.py \
  --repo iHGEN/Web-Development-Agent-Kit \
  --ref v1.1.1 \
  --project .
```

For important projects, pin a release tag or commit instead of `main`, and optionally verify a published SHA-256 checksum.
