param(
  [string]$ShortcutName = "ChannelStack.lnk"
)

$ErrorActionPreference = "Stop"
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup $ShortcutName

if (Test-Path $shortcutPath) {
  Remove-Item $shortcutPath -Force
  Write-Output "Removed startup shortcut: $shortcutPath"
} else {
  Write-Output "Startup shortcut not found: $shortcutPath"
}
