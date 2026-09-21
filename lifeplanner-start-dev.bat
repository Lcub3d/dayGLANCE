@echo off
setlocal
chcp 65001 >nul

rem ===========================================================
rem  Life Planner - local web preview launcher
rem
rem  Double-click this file, or run it from any shell.
rem  Serves the Vite dev server at http://127.0.0.1:5186/
rem  Press Ctrl+C in this window to stop the server.
rem
rem  Toggles below - edit only these two lines if needed.
rem ===========================================================

set "PORT=5186"
set "OPEN_BROWSER=1"

rem -----------------------------------------------------------

set "HOST=127.0.0.1"
set "URL=http://%HOST%:%PORT%/"

cd /d "%~dp0"
title Life Planner dev server

echo [Life Planner] local web preview
echo        folder : %CD%
echo        url    : %URL%
echo.

rem --- 1. node ---
where node >nul 2>nul
if errorlevel 1 (
  echo [1/3] ERROR - node was not found in PATH.
  echo       Install Node.js 22 and reopen this window.
  goto :fail
)
set "NODEV="
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo [1/3] node %NODEV% ok

rem --- 2. dependencies ---
if exist "node_modules\" (
  echo [2/3] node_modules present - skipping install
) else (
  echo [2/3] node_modules missing - running npm ci, this may take a minute ...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo       ERROR - npm ci failed. Scroll up for the cause.
    goto :fail
  )
)

rem --- 3. port ---
set "BUSY="
for /f "tokens=*" %%l in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do set "BUSY=1"
if defined BUSY (
  echo [3/3] WARNING - port %PORT% is already in use.
  echo       Another server may already be running. Open %URL% directly,
  echo       or close the other one and run this script again.
  echo.
) else (
  echo [3/3] port %PORT% free
)

rem --- optional: open the default browser once Vite is up ---
if "%OPEN_BROWSER%"=="1" (
  start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 5; Start-Process '%URL%'" >nul 2>nul
)

echo.
echo ---- starting vite - press Ctrl+C to stop ----
echo.

call npm run dev -- --host %HOST% --port %PORT% --strictPort

echo.
echo [Life Planner] server stopped.
endlocal
exit /b 0

:fail
echo.
pause
endlocal
exit /b 1
