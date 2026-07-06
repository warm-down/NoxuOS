$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogDir = Join-Path $AppDir "logs"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Test-OllamaReady {
  try {
    $response = Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 8
    return (($response.models | Measure-Object).Count -gt 0)
  } catch {
    return $false
  }
}

function Wait-OllamaReady {
  param([int]$Attempts = 6)

  for ($i = 1; $i -le $Attempts; $i++) {
    if (Test-OllamaReady) {
      return $true
    }
    Start-Sleep -Seconds 3
  }

  return $false
}

function Start-OllamaStable {
  if (Wait-OllamaReady -Attempts 2) {
    Write-Output "Ollama already ready."
    return
  }

  $existing = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq "ollama.exe" -or $_.CommandLine -match "ollama serve" }

  if ($existing) {
    Write-Output "Restarting unresponsive Ollama..."
    foreach ($process in $existing) {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
  } else {
    Write-Output "Starting Ollama..."
  }

  Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden

  if (-not (Wait-OllamaReady -Attempts 8)) {
    throw "Ollama did not become ready on http://127.0.0.1:11434"
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

function Wait-ProcessPattern {
  param(
    [string]$Name,
    [string]$Pattern,
    [int]$Attempts = 12
  )

  for ($i = 1; $i -le $Attempts; $i++) {
    $existing = Get-CimInstance Win32_Process |
      Where-Object { $_.CommandLine -match $Pattern -and $_.ProcessId -ne $PID }

    if ($existing) {
      Write-Output "$Name process ready."
      return
    }

    Start-Sleep -Seconds 1
  }

  throw "$Name process did not start."
}

Set-Location $AppDir

Start-OllamaStable

$telegramPattern = "src[\\/]telegram\.js|npm run telegram"
$voicePattern = "src[\\/]local-voice\.js|npm run voice:listen"

Start-IfMissing `
  -Name "Telegram bridge" `
  -Pattern $telegramPattern `
  -Command "npm run telegram" `
  -LogName "telegram.log"

Start-IfMissing `
  -Name "Laptop voice listener" `
  -Pattern $voicePattern `
  -Command "npm run voice:listen" `
  -LogName "voice-listener.log"

Wait-ProcessPattern -Name "Telegram bridge" -Pattern $telegramPattern
Wait-ProcessPattern -Name "Laptop voice listener" -Pattern $voicePattern

Write-Output ""
Write-Output "Voice stack started."
Write-Output "Try saying: wake up status"
Write-Output "Telegram bot and laptop mic can now route commands to the Empire mesh."

Start-Sleep -Seconds 8
Write-Output ""
Write-Output "Verifying voice stack..."
npm run voice:verify
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
