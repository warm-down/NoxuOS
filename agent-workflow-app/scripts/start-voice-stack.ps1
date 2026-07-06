$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogDir = Join-Path $AppDir "logs"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Test-HttpReady {
  param([string]$Url)
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Start-IfMissing {
  param(
    [string]$Name,
    [string]$Pattern,
    [string]$Command,
    [string]$LogName
  )

  $existing = Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -match $Pattern -and $_.ProcessId -ne $PID }

  if ($existing) {
    Write-Output "$Name already running."
    return
  }

  $logPath = Join-Path $LogDir $LogName
  $wrapped = @"
Set-Location '$AppDir'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$Command *> '$logPath'
"@

  Start-Process powershell `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $wrapped `
    -WindowStyle Hidden

  Write-Output "Started $Name. Log: $logPath"
}

Set-Location $AppDir

if (-not (Test-HttpReady "http://127.0.0.1:11434/api/tags")) {
  Write-Output "Starting Ollama..."
  Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
  Start-Sleep -Seconds 5
} else {
  Write-Output "Ollama already ready."
}

Start-IfMissing `
  -Name "Telegram bridge" `
  -Pattern "src[\\/]telegram\.js|npm run telegram" `
  -Command "npm run telegram" `
  -LogName "telegram.log"

Start-IfMissing `
  -Name "Laptop voice listener" `
  -Pattern "src[\\/]local-voice\.js|npm run voice:listen" `
  -Command "npm run voice:listen" `
  -LogName "voice-listener.log"

Write-Output ""
Write-Output "Voice stack started."
Write-Output "Try saying: wake up status"
Write-Output "Telegram bot and laptop mic can now route commands to the Empire mesh."

Start-Sleep -Seconds 3
Write-Output ""
Write-Output "Verifying voice stack..."
npm run voice:verify
