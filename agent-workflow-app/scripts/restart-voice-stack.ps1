$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$StartScript = Join-Path $AppDir "scripts\start-voice-stack.ps1"

Write-Output "Stopping stale voice stack processes..."

$processes = Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -match "src[\\/]telegram\.js|src[\\/]local-voice\.js|npm run telegram|npm run voice:listen"
  }

foreach ($process in $processes) {
  Write-Output "Stopping PID $($process.ProcessId): $($process.CommandLine)"
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2

Write-Output ""
Write-Output "Starting fresh voice stack..."
& $StartScript
