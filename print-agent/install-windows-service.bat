@echo off
REM ---------------------------------------------------------------
REM  Matbex Print Agent — Windows auto-start installer (NSSM)
REM ---------------------------------------------------------------
REM  1. Download NSSM:  https://nssm.cc/download
REM  2. Put nssm.exe next to this script (or in PATH).
REM  3. Run this file as Administrator.
REM ---------------------------------------------------------------

setlocal
set SERVICE_NAME=MatbexPrintAgent
set EXE_PATH=%~dp0dist\matbex-print-agent.exe

if not exist "%EXE_PATH%" (
  echo [!] Build the agent first:  npm install ^&^& npm run build:win
  exit /b 1
)

where nssm >nul 2>nul
if errorlevel 1 (
  echo [!] nssm.exe not found. Download it from https://nssm.cc/download
  exit /b 1
)

nssm install %SERVICE_NAME% "%EXE_PATH%"
nssm set    %SERVICE_NAME% AppDirectory "%~dp0"
nssm set    %SERVICE_NAME% Start SERVICE_AUTO_START
nssm set    %SERVICE_NAME% AppStdout "%~dp0logs\agent.out.log"
nssm set    %SERVICE_NAME% AppStderr "%~dp0logs\agent.err.log"
nssm set    %SERVICE_NAME% AppRotateFiles 1
nssm set    %SERVICE_NAME% AppRotateBytes 5242880

mkdir "%~dp0logs" 2>nul
net start %SERVICE_NAME%

echo.
echo [OK] Matbex Print Agent installed and started.
echo      Endpoint: http://127.0.0.1:9911/print
endlocal