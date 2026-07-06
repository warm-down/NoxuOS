$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ScriptPath = Join-Path $AppDir "scripts\start-voice-stack.ps1"
$TaskName = "NoxuOS Voice Stack"

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""

$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0)

try {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null

  Write-Output "Installed scheduled task: $TaskName"
} catch {
  Write-Output "Scheduled task install failed: $($_.Exception.Message)"
  Write-Output "Installing Startup folder fallback instead."

  $startup = [Environment]::GetFolderPath("Startup")
  $cmdPath = Join-Path $startup "NoxuOS Voice Stack.cmd"
  $cmd = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`"`r`n"
  Set-Content -Path $cmdPath -Value $cmd -Encoding ASCII
  Write-Output "Installed startup launcher: $cmdPath"
}

Write-Output "Starting voice stack now..."
& $ScriptPath
