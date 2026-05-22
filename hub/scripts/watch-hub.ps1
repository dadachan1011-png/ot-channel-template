param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [int]$RestartDelaySeconds = 5
)

$ErrorActionPreference = "Continue"
$localDir = Join-Path $ProjectRoot ".local"
New-Item -ItemType Directory -Force -Path $localDir | Out-Null
$watchLog = Join-Path $localDir "hub.watch.log"

while ($true) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

  $listener = Get-NetTCPConnection -LocalPort 4770 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $listener.OwningProcess | Set-Content (Join-Path $localDir "hub.pid")
    Add-Content -Path $watchLog -Value "[$timestamp] hub already listening: $($listener.OwningProcess)"
    Start-Sleep -Seconds $RestartDelaySeconds
    continue
  }

  Add-Content -Path $watchLog -Value "[$timestamp] starting hub"

  $process = Start-Process -FilePath "npm.cmd" `
    -ArgumentList @("run", "dev") `
    -WorkingDirectory $ProjectRoot `
    -RedirectStandardOutput (Join-Path $localDir "hub.out.log") `
    -RedirectStandardError (Join-Path $localDir "hub.err.log") `
    -WindowStyle Hidden `
    -PassThru

  $process.Id | Set-Content (Join-Path $localDir "hub.pid")
  Wait-Process -Id $process.Id

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $watchLog -Value "[$timestamp] hub exited; restarting in $RestartDelaySeconds seconds"
  Start-Sleep -Seconds $RestartDelaySeconds
}
