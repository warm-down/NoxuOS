@echo off
chcp 65001 >nul
cls

echo.
echo    AI EMPIRE - COMMAND CENTER v0.2
echo.
echo ============================================

set HARDWARE_APPROVAL_REQUIRED=true
set AUTO_APPROVE_PHYSICAL=false
set EMPIRE_MODE=SUPERVISED

if exist "agent-workflow-app\.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in ("agent-workflow-app\.env") do (
    if not "%%a"=="" set "%%a=%%b"
  )
)

echo [1/5] Checking Ollama...
curl -s http://localhost:11434/api/tags >nul 2>&1
if errorlevel 1 (
  echo     Starting Ollama...
  start "" ollama serve
  timeout /t 3 >nul
) else (
  echo     Ollama running
)

echo [2/5] Checking Pi 5 Controller...
curl -s http://pi5.local:5000/devices >nul 2>&1
if errorlevel 1 (
  echo     Pi 5 offline - standalone mode
) else (
  echo     Pi 5 connected
)

echo [3/5] Preparing agent app...
cd agent-workflow-app
if not exist "node_modules" (
  echo     Installing dependencies...
  call npm install
)

echo [4/5] Testing local launch path...
call npm run launch:check
if errorlevel 1 (
  echo     Launch check failed.
  cd ..
  exit /b 1
)

echo [5/5] Launching Command Center...
echo.
echo ============================================
echo  EMPIRE ONLINE - SUPERVISED MODE
echo  Type "help" for commands
echo ============================================
echo.

call npm run interactive

cd ..
pause
