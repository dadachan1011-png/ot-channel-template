param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$localDir = Join-Path $ProjectRoot ".local"
$pidFile = Join-Path $localDir "hub.pid"

if (Test-Path $pidFile) {
  $pidValue = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($pidValue) {
    Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$listener = netstat -ano | Select-String ":4770" | Where-Object { $_.Line -match "LISTENING\s+(\d+)" } | Select-Object -First 1
if ($listener -and $listener.Line -match "LISTENING\s+(\d+)") {
  Stop-Process -Id $Matches[1] -Force -ErrorAction SilentlyContinue
}

Write-Output "Hub stopped"
