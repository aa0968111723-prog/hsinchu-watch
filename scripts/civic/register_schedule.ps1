$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Python = (Get-Command python).Source
$Script = Join-Path $Root "scripts\civic\collect_civic.py"
$TaskName = "HsinchuWatch-02-data-civic"
$Action = "`"$Python`" `"$Script`""
schtasks.exe /Create /F /SC MINUTE /MO 20 /TN $TaskName /TR $Action /RL LIMITED
if ($LASTEXITCODE -ne 0) {
    Write-Error "schtasks create failed with exit $LASTEXITCODE"
}
& $Python $Script --schedule-only
exit $LASTEXITCODE
