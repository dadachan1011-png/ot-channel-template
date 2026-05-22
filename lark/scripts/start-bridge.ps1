param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
$localDir = Join-Path $ProjectRoot ".local"
New-Item -ItemType Directory -Force -Path $localDir | Out-Null

$pidFile = Join-Path $localDir "bridge.pid"
$outLog = Join-Path $localDir "bridge.out.log"
$errLog = Join-Path $localDir "bridge.err.log"

$listener = netstat -ano | Select-String ":4766" | Where-Object { $_.Line -match "LISTENING\s+(\d+)" } | Select-Object -First 1
if ($listener -and $listener.Line -match "LISTENING\s+(\d+)") {
  $Matches[1] | Set-Content $pidFile
  Write-Output "Bridge already listening: $($Matches[1])"
  exit 0
}

if (Test-Path $pidFile) {
  $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Write-Output "Bridge already running: $oldPid"
    exit 0
  }
}

$process = Start-Process -FilePath "npm.cmd" `
  -ArgumentList @("run", "start") `
  -WorkingDirectory $ProjectRoot `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -WindowStyle Hidden `
  -PassThru

$process.Id | Set-Content $pidFile
Write-Output "Bridge started: $($process.Id)"
