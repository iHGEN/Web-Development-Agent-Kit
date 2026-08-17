param(
  [string]$Project = ".",
  [string]$Repo = "",
  [string]$Ref = "",
  [string]$Source = "",
  [string]$Sha256 = ""
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required to install Web Development Agent Kit."
}
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw "npm/npx is required to install Web Development Agent Kit."
}

$args = @("--yes", "@ihgen/web-kit", "install", "--project", $Project)
if ($Repo) { $args += @("--repo", $Repo) }
if ($Ref) { $args += @("--ref", $Ref) }
if ($Source) { $args += @("--source", $Source) }
if ($Sha256) { $args += @("--sha256", $Sha256) }

& npx @args
exit $LASTEXITCODE
