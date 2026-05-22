param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

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

$requiredEnv = @(
  "DINGTALK_CLIENT_ID",
  "DINGTALK_CLIENT_SECRET",
  "DINGTALK_ALLOWED_SENDER_STAFF_ID",
  "DINGTALK_ROBOT_CODE",
  "DINGTALK_NOTIFY_USER_ID"
)

foreach ($name in $requiredEnv) {
  $value = [Environment]::GetEnvironmentVariable($name, "Process")
  if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, "User") }
  if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, "Machine") }
  if (-not $value) { $value = Get-SharedEnvValue $name }
  if ($value) { Write-Output "$name=SET" } else { Write-Output "$name=MISSING" }
}

$localDir = Join-Path $ProjectRoot ".local"
$pidFile = Join-Path $localDir "bridge.pid"
$pidValue = $null
if (Test-Path $pidFile) {
  $pidValue = Get-Content $pidFile -ErrorAction SilentlyContinue
  $process = if ($pidValue) { Get-Process -Id $pidValue -ErrorAction SilentlyContinue } else { $null }
  if ($process) { Write-Output "PID_FILE_PROCESS=RUNNING PID=$pidValue" } else { Write-Output "PID_FILE_PROCESS=STALE_PID PID=$pidValue" }
} else {
  Write-Output "PID_FILE_PROCESS=NO_PID_FILE"
}

$netstat = netstat -ano | Select-String ":4767"
$listeners = $netstat | Where-Object { $_.Line -match "LISTENING\s+(\d+)" }
$isListening = $false
if ($listeners) {
  $isListening = $true
  Write-Output "NOTIFY_PORT=LISTENING"
  $netstat | ForEach-Object { Write-Output $_.Line.Trim() }
  $listener = $listeners | Select-Object -First 1
  if ($listener -and $listener.Line -match "LISTENING\s+(\d+)") {
    $listenerPid = $Matches[1]
    Write-Output "NOTIFY_PORT_OWNER_PID=$listenerPid"
    Write-Output "BRIDGE_PROCESS=RUNNING PID=$listenerPid"
    if ($listenerPid -ne $pidValue) {
      Write-Output "PID_FILE_MISMATCH=YES"
    }
  }
} else {
  Write-Output "NOTIFY_PORT=NOT_LISTENING"
  Write-Output "BRIDGE_PROCESS=NOT_LISTENING"
}

$shortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "DingTalkCodexBridge.lnk"
$stackShortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "ChannelStack.lnk"
if (Test-Path $stackShortcut) {
  Write-Output "STARTUP_SHORTCUT=INSTALLED_STACK"
} elseif (Test-Path $shortcut) {
  Write-Output "STARTUP_SHORTCUT=INSTALLED_BRIDGE"
} else {
  Write-Output "STARTUP_SHORTCUT=MISSING"
}

$outLog = Join-Path $localDir "bridge.out.log"
$errLog = Join-Path $localDir "bridge.err.log"
if (Test-Path $outLog) {
  Write-Output "RECENT_OUT_LOG:"
  Get-Content $outLog -Tail 20
}
if (Test-Path $errLog) {
  $errors = Get-Content $errLog -Tail 20
  if ($errors -and -not $isListening) {
    Write-Output "RECENT_ERR_LOG:"
    $errors
  } elseif ($errors -and $isListening) {
    Write-Output "RECENT_ERR_LOG=SUPPRESSED_WHILE_RUNNING"
  }
}
