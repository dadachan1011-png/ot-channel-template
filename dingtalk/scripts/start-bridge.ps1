param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
$requiredEnv = @(
  "DINGTALK_CLIENT_ID",
  "DINGTALK_CLIENT_SECRET",
  "DINGTALK_ALLOWED_SENDER_STAFF_ID",
  "DINGTALK_ROBOT_CODE",
  "DINGTALK_NOTIFY_USER_ID"
)

foreach ($name in $requiredEnv) {
  if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
    $value = [Environment]::GetEnvironmentVariable($name, "User")
    if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, "Machine") }
    if ($value) { Set-Item -Path "Env:$name" -Value $value }
  }
}

$localDir = Join-Path $ProjectRoot ".local"
New-Item -ItemType Directory -Force -Path $localDir | Out-Null

$pidFile = Join-Path $localDir "bridge.pid"
$outLog = Join-Path $localDir "bridge.out.log"
$errLog = Join-Path $localDir "bridge.err.log"

$listener = netstat -ano | Select-String ":4767" | Where-Object { $_.Line -match "LISTENING\s+(\d+)" } | Select-Object -First 1
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
Start-Sleep -Seconds 2
$listener = netstat -ano | Select-String ":4767" | Where-Object { $_.Line -match "LISTENING\s+(\d+)" } | Select-Object -First 1
if ($listener -and $listener.Line -match "LISTENING\s+(\d+)") {
  $Matches[1] | Set-Content $pidFile
  Write-Output "Bridge started: $($Matches[1])"
} else {
  Write-Output "Bridge starting: $($process.Id)"
}
