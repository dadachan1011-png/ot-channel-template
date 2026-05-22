param(
  [string]$ShortcutName = "ChannelHub.lnk"
)

$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup $ShortcutName

if (Test-Path $shortcutPath) {
  Remove-Item $shortcutPath -Force
  Write-Output "Removed startup shortcut: $shortcutPath"
} else {
  Write-Output "Startup shortcut not found: $shortcutPath"
}
