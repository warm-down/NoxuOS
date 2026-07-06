@echo off
chcp 65001 >nul
echo.
echo    AI EMPIRE - SUPERVISED LAUNCH
echo.
echo                    FULL LOCAL STACK
echo.
echo    AI: LOCAL/OLLAMA    HARDWARE: APPROVAL REQUIRED    MODE: SUPERVISED
echo.
echo ============================================

set HARDWARE_APPROVAL_REQUIRED=true
set AUTO_APPROVE_PHYSICAL=false
set EMPIRE_MODE=SUPERVISED
set AI_PROVIDER=ollama

echo [1/4] Checking Ollama and local agent node...
pushd "%~dp0agent-workflow-app"
call npm run launch:check
if errorlevel 1 (
  echo Launch check failed. Fix the local node before continuing.
  popd
  exit /b 1
)

echo [2/4] Checking Empire bridge...
call npm run bridge:check
if errorlevel 1 (
  echo Bridge check failed.
  popd
  exit /b 1
)
popd

echo [3/4] Pi 5 controller status...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod -Uri 'http://pi5.local:5000/devices' -TimeoutSec 3 | ConvertTo-Json -Depth 5 } catch { Write-Host 'Pi 5 controller not reachable yet. Standalone mode is OK for this laptop.' }"

echo [4/4] Running local agent workflow...
pushd "%~dp0agent-workflow-app"
call npm start
popd

echo.
echo ============================================
echo  EMPIRE ONLINE - SUPERVISED MODE
echo  Physical hardware actions require approval.
echo ============================================
