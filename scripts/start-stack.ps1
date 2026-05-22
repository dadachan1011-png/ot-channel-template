param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

function Test-ChannelEnv([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ($value) { return $true }

  $sharedEnv = $env:CHANNEL_SHARED_ENV_PATH
  if (-not $sharedEnv) { $sharedEnv = $env:CODEXPROJECTS_ENV_PATH }
  if (-not $sharedEnv) { $sharedEnv = Join-Path $ProjectRoot ".env" }
  if (-not (Test-Path $sharedEnv)) { return $false }

  foreach ($line in Get-Content -Encoding UTF8 -Path $sharedEnv) {
    if ($line -match "^\s*$([regex]::Escape($Name))=(.+)$") {
      return -not [string]::IsNullOrWhiteSpace($Matches[1])
    }
  }
  return $false
}

$modules = @(
  @{ Name = "hub"; Script = "scripts\start-hub.ps1" },
  @{ Name = "dingtalk"; Script = "scripts\start-bridge.ps1" }
)

if (Test-ChannelEnv "LARK_ALLOWED_OPEN_ID") {
  $modules = @(
    @{ Name = "hub"; Script = "scripts\start-hub.ps1" },
    @{ Name = "lark"; Script = "scripts\start-bridge.ps1" },
    @{ Name = "dingtalk"; Script = "scripts\start-bridge.ps1" }
  )
}

foreach ($module in $modules) {
  $moduleRoot = Join-Path $ProjectRoot $module.Name
  $scriptPath = Join-Path $moduleRoot $module.Script
  Write-Output "Starting $($module.Name)..."
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -ProjectRoot $moduleRoot
}

Write-Output "Channel stack started"
