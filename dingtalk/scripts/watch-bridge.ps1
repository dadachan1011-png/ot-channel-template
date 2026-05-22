param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [int]$RestartDelaySeconds = 5
)

$ErrorActionPreference = "Continue"
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
$watchLog = Join-Path $localDir "bridge.watch.log"

while ($true) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

  $listener = netstat -ano | Select-String ":4767" | Where-Object { $_.Line -match "LISTENING\s+(\d+)" } | Select-Object -First 1
  if ($listener -and $listener.Line -match "LISTENING\s+(\d+)") {
    $Matches[1] | Set-Content (Join-Path $localDir "bridge.pid")
    Add-Content -Path $watchLog -Value "[$timestamp] bridge already listening: $($Matches[1])"
    Start-Sleep -Seconds $RestartDelaySeconds
    continue
  }

  Add-Content -Path $watchLog -Value "[$timestamp] starting bridge"

  $process = Start-Process -FilePath "npm.cmd" `
    -ArgumentList @("run", "dev") `
    -WorkingDirectory $ProjectRoot `
    -RedirectStandardOutput (Join-Path $localDir "bridge.out.log") `
    -RedirectStandardError (Join-Path $localDir "bridge.err.log") `
    -WindowStyle Hidden `
    -PassThru

  $process.Id | Set-Content (Join-Path $localDir "bridge.pid")
  Wait-Process -Id $process.Id

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $watchLog -Value "[$timestamp] bridge exited; restarting in $RestartDelaySeconds seconds"
  Start-Sleep -Seconds $RestartDelaySeconds
}
