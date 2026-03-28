@echo off
chcp 65001 >nul
cls
echo.
echo ╔════════════════════════════════════════╗
echo ║   🚀 DBY POS - DESKTOP APP (DEV)      ║
echo ╚════════════════════════════════════════╝
echo.

cd /d "%~dp0"

echo [1/3] Khởi động Vite dev server...
start "Vite Dev Server" cmd /k "npm run dev"

echo [2/3] Chờ Vite sẵn sàng tại localhost:5173...
:WAIT_VITE
timeout /t 1 /nobreak >nul
curl -s http://localhost:5173 >nul 2>&1
if errorlevel 1 goto WAIT_VITE

echo ✅ Vite ready!
echo.
echo [3/3] Mở Electron với HMR...
set VITE_DEV_SERVER_URL=http://localhost:5173
npx electron .
