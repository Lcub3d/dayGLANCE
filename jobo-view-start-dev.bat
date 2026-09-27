@echo off
setlocal
chcp 65001 >nul

rem Double-click to start feat/jobo-view and open the default browser.
rem Pass --no-open to check startup without opening a browser.
set "HOST=127.0.0.1"
set "PORT=5187"
set "OPEN_BROWSER=1"
if /I "%~1"=="--no-open" set "OPEN_BROWSER=0"

cd /d "%~dp0"
if errorlevel 1 goto :fail
title JOBO View dev server
echo [JOBO View] http://%HOST%:%PORT%/
echo Folder: %CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is missing. Install Node.js 22 or newer.
  goto :fail
)
where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is missing. Reinstall Node.js and reopen this file.
  goto :fail
)

if not exist "node_modules\.bin\vite.cmd" (
  echo Installing dependencies. First startup may take a few minutes...
  call npm ci --no-audit --no-fund
  if errorlevel 1 goto :fail
)

rem Vite opens the browser only after the server is ready.
rem strictPort prevents switching to another branch's browser-data origin.
set "OPEN_ARG="
if "%OPEN_BROWSER%"=="1" set "OPEN_ARG=--open"
echo Starting server. Keep this window open; press Ctrl+C to stop.
call npm run dev -- --host %HOST% --port %PORT% --strictPort %OPEN_ARG%
if errorlevel 1 goto :fail
endlocal
exit /b 0

:fail
echo.
echo Startup failed. Read the error above.
echo If port %PORT% is busy, check the running server before starting again.
if "%OPEN_BROWSER%"=="1" pause
endlocal
exit /b 1
