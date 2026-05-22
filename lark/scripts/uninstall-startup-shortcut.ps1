param(
  [string]$ShortcutName = "LarkCodexBridge.lnk"
)

$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup $ShortcutName
Remove-Item $shortcutPath -Force -ErrorAction SilentlyContinue
Write-Output "Removed startup shortcut: $shortcutPath"
