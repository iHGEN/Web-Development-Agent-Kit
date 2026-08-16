# Install the Web Development Agent Kit From a Link

Put this kit in a GitHub repository and create a version tag such as `v1.1.0`.

## Linux / macOS / WSL

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/web-dev-agent-kit/v1.1.0/bootstrap/install.sh \
  | bash -s -- \
      --repo OWNER/web-dev-agent-kit \
      --ref v1.1.0 \
      --project .
```

## Windows PowerShell

```powershell
$installer="$env:TEMP\web-agent-kit-install.ps1"

Invoke-WebRequest `
  "https://raw.githubusercontent.com/OWNER/web-dev-agent-kit/v1.1.0/bootstrap/install.ps1" `
  -OutFile $installer

& $installer -Repo "OWNER/web-dev-agent-kit" -Ref "v1.1.0" -Project "."
```

## Direct ZIP URL

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/web-dev-agent-kit/v1.1.0/bootstrap/install.sh \
  | bash -s -- \
      --source https://your-host/web-dev-agent-kit-v1.1.0.zip \
      --project .
```

## Update without keeping the kit locally

A remote install records `.agent-kit-source.json` and installs:

```text
.agent-core/bin/remote-install.py
```

Run later:

```bash
python .agent-core/bin/remote-install.py --project .
```

To change the pinned version:

```bash
python .agent-core/bin/remote-install.py \
  --repo OWNER/web-dev-agent-kit \
  --ref v1.2.0 \
  --project .
```

For important projects, pin a release tag or commit and optionally verify a published SHA-256.
