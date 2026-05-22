param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [int]$RestartDelaySeconds = 5
)

$ErrorActionPreference = "Continue"
$localDir = Join-Path $ProjectRoot ".local"
New-Item -ItemType Directory -Force -Path $localDir | Out-Null
$watchLog = Join-Path $localDir "bridge.watch.log"

while ($true) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
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
