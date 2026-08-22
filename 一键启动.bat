@echo off
setlocal
title Migraine Signal One-Click Start
cd /d "%~dp0"

echo ==============================================
echo   Migraine Signal  (Backend + Frontend + Chrome)
echo ==============================================
echo.

REM ---------- 0. check node ----------
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install from: https://nodejs.org/
    pause
    exit /b 1
)

REM ---------- 1. install deps if missing ----------
if not exist "server\node_modules" (
    echo Installing backend dependencies...
    pushd server
    call npm install
    popd
    echo.
)

REM ---------- 2. check if port 3000 already in use ----------
netstat -ano | findstr ":3000 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo [INFO] Port 3000 is already in use. Trying to open the page directly.
    goto open_browser
)

REM ---------- 3. start backend + frontend ----------
echo Starting server at http://localhost:3000 ...
echo A service window will stay open for logs. Close it to stop the server.
start "Migraine Server" cmd /k "cd /d %~dp0server & set SERVE_FRONTEND=1 & node server.js"

REM ---------- 4. wait for the server to be ready (max 30s) ----------
echo Waiting for the server to be ready...
set /a tries=0
:waitloop
set /a tries+=1
if %tries% gtr 30 goto fail
timeout /t 1 /nobreak >nul
curl -s http://localhost:3000/api/health >nul 2>nul
if errorlevel 1 goto waitloop
echo Server is ready!

:open_browser
echo Opening page in Chrome...
REM try Chrome first; fall back to the system default browser
start "" chrome "http://localhost:3000/sleep.html" 2>nul
if errorlevel 1 start "" "http://localhost:3000/sleep.html"
echo.
echo Done! To stop, close the service window.
pause
exit /b 0

:fail
echo.
echo [ERROR] Server did not become ready within 30 seconds.
echo Please check: 1) is port 3000 occupied?  2) is Node.js working?
pause
exit /b 1
