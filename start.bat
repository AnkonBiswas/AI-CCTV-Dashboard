@echo off
title AI Face Recognition Dashboard
echo ==========================================
echo Starting AI Face Recognition System...
echo ==========================================

:: Kill existing processes to prevent port conflicts
echo [1/4] Cleaning up existing services...
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im python.exe >nul 2>&1
taskkill /f /im mediamtx.exe >nul 2>&1

:: Start MediaMTX
echo [2/4] Starting MediaMTX (Stream Server)...
cd mediamtx
start "MediaMTX" /min mediamtx.exe
timeout /t 3 /nobreak >nul

:: Start Backend
echo [3/4] Starting Backend (AI Controller)...
cd ..\backend
start "Dashboard Backend" /min npm start
timeout /t 2 /nobreak >nul

:: Start Frontend
echo [4/4] Starting Frontend (Interface)...
cd ..\frontend
start "Dashboard Frontend" /min python -m http.server 8080

echo.
echo ==========================================
echo  SYSTEM READY
echo  Dashboard: http://localhost:8080
echo ==========================================
echo.
pause
