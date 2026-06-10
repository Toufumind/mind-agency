@echo off
echo Starting Mind Agency...
echo.

REM Start Next.js dev server in background
echo Starting Next.js dev server on port 3000...
start /B cmd /c "npm run dev"

REM Wait for server to be ready
echo Waiting for server to start...
timeout /t 8 /nobreak > nul

REM Launch Electron app
echo Launching Mind Agency desktop app...
start "" "dist-exe\Mind Agency-win32-x64\Mind Agency.exe"

echo.
echo Mind Agency is running!
echo Close this window or press Ctrl+C to stop.
pause
