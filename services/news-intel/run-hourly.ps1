$ErrorActionPreference = "Stop"
$Node = (Get-Command node).Source
$Log = Join-Path $PSScriptRoot "state\hourly-run.log"
function Write-Hourly([string]$Line) {
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null
    Add-Content -Path $Log -Encoding utf8 -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString("o"), $Line)
  } catch {}
}
Write-Hourly "start"
& $Node (Join-Path $PSScriptRoot "src\run-once.js")
$collect = $LASTEXITCODE
Write-Hourly "collect $collect"
if ($collect -ne 0) { exit $collect }
& $Node (Join-Path $PSScriptRoot "src\publish-pages.js")
$publish = $LASTEXITCODE
Write-Hourly "publish $publish"
exit $publish
