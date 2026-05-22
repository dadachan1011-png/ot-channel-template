param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$localDir = Join-Path $ProjectRoot ".local"
$pidFile = Join-Path $localDir "bridge.pid"

if (Test-Path $pidFile) {
  $pidValue = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($pidValue) {
    Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$connection = Get-NetTCPConnection -LocalPort 4767 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($connection) {
  Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
}


Write-Output "Bridge stopped"
