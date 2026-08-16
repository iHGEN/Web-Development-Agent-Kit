param(
    [string]$Project = "."
)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
python "$ScriptDir\agent-kit.py" install "$Project"
