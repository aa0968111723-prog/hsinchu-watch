$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Node = (Get-Command node).Source
$Script = Join-Path $Root "services\news-intel\run-hourly.ps1"
$TaskName = "HsinchuWatch-NewsIntel-Hourly"
$Action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$Script`""
schtasks.exe /Create /F /SC HOURLY /MO 1 /TN $TaskName /TR $Action /RL LIMITED
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
schtasks.exe /Query /TN $TaskName /FO LIST
exit $LASTEXITCODE
