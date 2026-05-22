function Get-SharedEnvValue([string]$Name) {
  $sharedEnv = $env:CHANNEL_SHARED_ENV_PATH
  if (-not $sharedEnv) { $sharedEnv = $env:CODEXPROJECTS_ENV_PATH }
  if (-not $sharedEnv) { $sharedEnv = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path ".env" }
  if (-not (Test-Path $sharedEnv)) { return $null }

  foreach ($line in Get-Content -Encoding UTF8 -Path $sharedEnv) {
    if ($line -match "^\s*$([regex]::Escape($Name))=(.*)$") {
      return $Matches[1]
    }
  }
  return $null
}

$names = @(
  "DINGTALK_CLIENT_ID",
  "DINGTALK_CLIENT_SECRET",
  "DINGTALK_ALLOWED_SENDER_STAFF_ID",
  "DINGTALK_ROBOT_CODE",
  "DINGTALK_NOTIFY_USER_ID"
)

foreach ($name in $names) {
  $value = [Environment]::GetEnvironmentVariable($name, "Process")
  if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, "User") }
  if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, "Machine") }
  if (-not $value) { $value = Get-SharedEnvValue $name }

  if ($value) {
    Write-Output "$name=SET"
  } else {
    Write-Output "$name=MISSING"
  }
}
