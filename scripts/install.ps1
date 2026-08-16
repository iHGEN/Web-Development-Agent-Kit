param(
    [string]$Project = "."
)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
python "$ScriptDir\agent-kit.py" install "$Project"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
python "$ScriptDir\project_profile.py" "$Project"
