param(
  [string]$Token,
  [string]$EnvPath = ".env"
)

$ErrorActionPreference = "Stop"

if (-not $Token) {
  $Token = (Get-Clipboard -Raw -ErrorAction SilentlyContinue).Trim()
}

if (-not $Token) {
  $Token = Read-Host "Paste BotFather token"
}

if ($Token -notmatch '^\d{5,}:[A-Za-z0-9_-]{20,}$') {
  Write-Error "Clipboard/input does not look like a Telegram BotFather token."
}

if (-not (Test-Path $EnvPath)) {
  New-Item -ItemType File -Path $EnvPath | Out-Null
}

$content = Get-Content $EnvPath -Raw

if ($content -match '(?m)^TELEGRAM_BOT_TOKEN=') {
  $content = $content -replace '(?m)^TELEGRAM_BOT_TOKEN=.*$', "TELEGRAM_BOT_TOKEN=$Token"
} else {
  $content = $content.TrimEnd() + "`r`nTELEGRAM_BOT_TOKEN=$Token`r`n"
}

$defaults = [ordered]@{
  TELEGRAM_API_BASE_URL = "https://api.telegram.org"
  TELEGRAM_ALLOWED_CHAT_ID = ""
  TELEGRAM_ALLOW_ALL = "false"
  TELEGRAM_POLL_TIMEOUT_SECONDS = "25"
}

foreach ($entry in $defaults.GetEnumerator()) {
  if ($content -notmatch "(?m)^$($entry.Key)=") {
    $content = $content.TrimEnd() + "`r`n$($entry.Key)=$($entry.Value)`r`n"
  }
}

Set-Content -Path $EnvPath -Value $content -NoNewline

Write-Output "Telegram token saved to $EnvPath (hidden)."
Write-Output "Next: npm run telegram:setup"
