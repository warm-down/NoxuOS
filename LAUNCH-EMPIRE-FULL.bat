@echo off
chcp 65001 >nul
cls

echo.
echo    AI EMPIRE - FULL STACK LAUNCH
echo.
echo    MODE: FULL STACK / SUPERVISED
echo    AI:   LOCAL OLLAMA FIRST
echo    HW:   APPROVAL REQUIRED
echo.
echo ============================================

set HARDWARE_APPROVAL_REQUIRED=true
set AUTO_APPROVE_PHYSICAL=false
set EMPIRE_MODE=FULL_STACK_SUPERVISED
set AI_PROVIDER=ollama

pushd "%~dp0agent-workflow-app"

if not exist "node_modules" (
  echo [setup] Installing agent dependencies...
  call npm install
  if errorlevel 1 (
    popd
    exit /b 1
  )
)

echo [1/6] Checking Ollama...
curl -s http://127.0.0.1:11434/api/tags >nul 2>&1
if errorlevel 1 (
  echo Starting Ollama...
  start "" ollama serve
  timeout /t 8 >nul
)

curl -s http://127.0.0.1:11434/api/tags >nul 2>&1
if errorlevel 1 (
  echo Ollama is still not responding on 127.0.0.1:11434.
  popd
  exit /b 1
)

echo [2/6] Launch checks...
call npm run launch:check
if errorlevel 1 (
  echo Launch check failed.
  popd
  exit /b 1
)

echo [3/6] Starting/restarting voice and Telegram stack...
call npm run voice:restart
if errorlevel 1 (
  echo Voice stack failed.
  popd
  exit /b 1
)

echo [4/6] Capability check...
call npm run capability:check
if errorlevel 1 (
  echo Capability check failed.
  popd
  exit /b 1
)

echo [5/6] Architecture check...
call npm run architecture:check
if errorlevel 1 (
  echo Architecture check failed. Finish Pi 5, Pi 400, and Kali readiness before using FULL launch.
  popd
  exit /b 1
)

echo [6/6] Command center...
echo.
echo ============================================
echo  EMPIRE ONLINE - FULL STACK SUPERVISED
echo  Voice, Telegram, mesh, and local agents are checked.
echo  Physical hardware actions still require approval.
echo ============================================
echo.

call npm run interactive

popd
