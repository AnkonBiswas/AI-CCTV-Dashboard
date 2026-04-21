@echo off
echo Starting RTSP Dashboard...

:: Start MediaMTX in a new window
echo Starting MediaMTX...
cd mediamtx
start "MediaMTX" mediamtx.exe
timeout /t 3

:: Start Backend in a new window
echo Starting Backend...
cd ..\backend
start "Backend" npm start
timeout /t 2

:: Serve Frontend using python or npx
echo Starting Frontend...
cd ..\frontend
start "Frontend" python -m http.server 8080

echo.
echo All services running!
echo Dashboard: http://localhost:8080
echo.
pause
