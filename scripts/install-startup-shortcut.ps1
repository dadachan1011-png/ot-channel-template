param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$ShortcutName = "ChannelStack.lnk"
)

$ErrorActionPreference = "Stop"
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup $ShortcutName
$watchScript = Join-Path $ProjectRoot "scripts\watch-stack.ps1"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$watchScript`""
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.Description = "Keep Channel Hub and configured chat bridges running after Windows logon"
$shortcut.Save()

Start-Process -FilePath "powershell.exe" `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $watchScript) `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden

Write-Output "Installed startup shortcut: $shortcutPath"
