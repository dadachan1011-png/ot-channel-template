param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [int]$RestartDelaySeconds = 10
)

$ErrorActionPreference = "Continue"
$localDir = Join-Path $ProjectRoot ".local"
New-Item -ItemType Directory -Force -Path $localDir | Out-Null

$PID | Set-Content (Join-Path $localDir "stack.pid")
$watchLog = Join-Path $localDir "stack.watch.log"
$startScript = Join-Path $ProjectRoot "scripts\start-stack.ps1"

while ($true) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $watchLog -Value "[$timestamp] checking channel stack"

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript -ProjectRoot $ProjectRoot `
    >> (Join-Path $localDir "stack.out.log") `
    2>> (Join-Path $localDir "stack.err.log")

  Start-Sleep -Seconds $RestartDelaySeconds
}
