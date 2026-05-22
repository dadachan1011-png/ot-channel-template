param(
  [string]$ShortcutName = "DingTalkCodexBridge.lnk"
)

$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup $ShortcutName
Remove-Item $shortcutPath -Force -ErrorAction SilentlyContinue
Write-Output "Removed startup shortcut: $shortcutPath"
