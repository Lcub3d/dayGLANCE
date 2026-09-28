@echo off
setlocal
chcp 65001 >nul

rem Double-click to start this checkout and open the default browser.
rem Dedicated origin for Jobu: http://127.0.0.1:5197/
rem Pass --no-open to verify startup without opening a browser or pausing.
set "JOBU_HOST=127.0.0.1"
set "JOBU_PORT=5197"
set "JOBU_OPEN_BROWSER=1"
if /I "%~1"=="--no-open" set "JOBU_OPEN_BROWSER=0"

cd /d "%~dp0"
if errorlevel 1 goto :fail
title JOBU dev server
echo [JOBU] http://%JOBU_HOST%:%JOBU_PORT%/
echo Folder: %CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is missing. Install Node.js 22 or newer.
  goto :fail
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm is missing. Reinstall Node.js and reopen this file.
  goto :fail
)

rem Check actual dependencies: node_modules may belong to an older branch.
if not exist "node_modules\.bin\vite.cmd" goto :install
call npm.cmd ls --depth=0 --omit=optional >nul 2>nul
if errorlevel 1 goto :install
goto :start

:install
echo Installing dependencies from package-lock.json. This may take a few minutes...
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 goto :fail

:start
rem Vite opens the browser after listening; strictPort keeps this origin stable.
set "JOBU_OPEN_ARG="
if "%JOBU_OPEN_BROWSER%"=="1" set "JOBU_OPEN_ARG=--open"
echo Starting server. Keep this window open; press Ctrl+C to stop.
call npm.cmd run dev -- --host %JOBU_HOST% --port %JOBU_PORT% --strictPort %JOBU_OPEN_ARG%
if errorlevel 1 goto :fail
endlocal
exit /b 0

:fail
echo.
echo Startup failed. Read the error above.
echo If port %JOBU_PORT% is busy, check the running server before starting again.
if "%JOBU_OPEN_BROWSER%"=="1" pause
endlocal
exit /b 1
