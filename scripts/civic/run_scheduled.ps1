$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root
python scripts\civic\collect_civic.py
exit $LASTEXITCODE
