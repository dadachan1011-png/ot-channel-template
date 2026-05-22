param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

$forbiddenPathPatterns = @(
  "\\node_modules\\",
  "\\dist\\",
  "\\.local\\",
  "\\memory\\sessions\\",
  "\\memory\\pending\\",
  "\\memory\\profiles\\groups\\",
  "\\memory\\profiles\\direct\\",
  "\\memory\\prompts\\global\.md$"
)

$sensitiveTextPatterns = @(
  "Miranda",
  "chenm",
  "C:\\Users\\chenm",
  "D:\\CodexProjects",
  "D:\\CodexProjects\\AI-Infrastructure\\channel",
  "DINGTALK_CLIENT_SECRET=.+",
  "OPENAI_API_KEY=.+",
  "FEISHU_APP_SECRET=.+",
  "LARK_APP_SECRET=.+"
)

$files = Get-ChildItem -LiteralPath $Root -Recurse -File -Force |
  Where-Object {
    $full = $_.FullName
    -not ($forbiddenPathPatterns | Where-Object { $full -match $_ })
  }

$pathFailures = Get-ChildItem -LiteralPath $Root -Recurse -Force |
  Where-Object {
    $full = $_.FullName
    ($forbiddenPathPatterns | Where-Object { $full -match $_ })
  } |
  Select-Object -ExpandProperty FullName

if ($pathFailures) {
  Write-Error ("Forbidden generated/private paths found:`n" + ($pathFailures -join "`n"))
}

$textFailures = @()
foreach ($file in $files) {
  if ($file.FullName -eq $PSCommandPath) { continue }
  if ($file.Extension -in @(".png", ".jpg", ".jpeg", ".gif", ".ico", ".sqlite")) { continue }
  $content = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
  foreach ($pattern in $sensitiveTextPatterns) {
    if ($content -match $pattern) {
      $textFailures += "$($file.FullName) :: $pattern"
    }
  }
}

if ($textFailures) {
  Write-Error ("Sensitive template content found:`n" + ($textFailures -join "`n"))
}

Write-Host "Sanitization check passed."
