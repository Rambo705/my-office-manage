@echo off
echo.
echo  ================================================
echo   Ziyan Service Manager v6.1 — Setup
echo   Installing sql.js (pure JavaScript SQLite)
echo   Works on ALL Node.js versions. No compilation.
echo  ================================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js not installed! Get it from: https://nodejs.org
    pause & exit /b 1
)

echo  Node.js version:
node --version
echo.

if not exist package.json (
    echo {"name":"ziyan-service-manager","version":"6.1.0","dependencies":{"sql.js":"^1.12.0"}} > package.json
)

echo  Installing sql.js...
npm install sql.js

if %errorlevel% neq 0 (
    echo.
    echo  ERROR: npm install failed. Try running as Administrator.
    pause & exit /b 1
)

if not exist uploads mkdir uploads

echo.
echo  Testing sql.js...
node -e "require('sql.js').then(()=>console.log('  sql.js OK')).catch(e=>console.error('  FAIL:',e.message))"

echo.
echo  ================================================
echo   Setup complete!
echo   Start the server: double-click start-server.bat
echo  ================================================
echo.
pause
