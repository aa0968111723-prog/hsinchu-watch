$ErrorActionPreference = "Stop"
$Node = (Get-Command node).Source
& $Node (Join-Path $PSScriptRoot "src\run-once.js")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $Node (Join-Path $PSScriptRoot "src\publish-pages.js")
exit $LASTEXITCODE
