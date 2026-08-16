param(
  [string]$Repo="",
  [string]$Ref="main",
  [string]$Source="",
  [string]$Project=".",
  [string]$Sha256="",
  [switch]$ForceAgents
)
$ErrorActionPreference="Stop"
if (-not $Source) {
  if (-not $Repo) { throw "Provide -Repo OWNER/REPO or -Source ZIP_URL" }
  $Source="https://codeload.github.com/$Repo/zip/$Ref"
}
$temp=Join-Path ([IO.Path]::GetTempPath()) ("web-agent-kit-"+[guid]::NewGuid())
New-Item -ItemType Directory -Path $temp | Out-Null
$zip=Join-Path $temp "kit.zip"; $extract=Join-Path $temp "extract"
try {
  Invoke-WebRequest -Uri $Source -OutFile $zip
  if ($Sha256) {
    $actual=(Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256.ToLowerInvariant()) { throw "SHA-256 mismatch" }
  }
  Expand-Archive $zip $extract
  $cli=Get-ChildItem $extract -Recurse -Filter "agent-kit.py" |
    Where-Object {$_.FullName -match "[\\/]scripts[\\/]agent-kit\.py$"} |
    Select-Object -First 1
  if (-not $cli) { throw "agent-kit.py not found" }

  $target=(Resolve-Path $Project).Path
  $args=@($cli.FullName,"install",$target)
  if ($ForceAgents) {$args+="--force-agents"}
  & python @args
  if ($LASTEXITCODE -ne 0) { throw "Agent Kit installer failed" }

  @{repo=$Repo;ref=$Ref;source=$Source} | ConvertTo-Json |
    Set-Content -Encoding UTF8 (Join-Path $target ".agent-kit-source.json")

  $kitRoot=Split-Path -Parent (Split-Path -Parent $cli.FullName)
  $remote=Join-Path $kitRoot "bootstrap\remote-install.py"
  if (Test-Path $remote) {
    $bin=Join-Path $target ".agent-core\bin"
    New-Item -ItemType Directory -Force $bin | Out-Null
    Copy-Item $remote (Join-Path $bin "remote-install.py") -Force
  }

  Write-Host "Project-aware AGENTS context generated from detected project structure and stack"
}
finally { Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue }
