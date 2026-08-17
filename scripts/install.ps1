param(
    [string]$Project = "."
)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
node "$ScriptDir\agent-kit.mjs" install "$Project"
