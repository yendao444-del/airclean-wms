@echo off
setlocal
chcp 65001 >nul
title Telegram WMS Simulator

set "PROJECT_DIR=%~dp0telegram-wms-simulator"
set "DEMO_URL=http://127.0.0.1:5173/"

if not exist "%PROJECT_DIR%\package.json" (
  echo Khong tim thay thu muc demo:
  echo %PROJECT_DIR%
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Chua cai Node.js. Hay cai Node.js roi chay lai file nay.
  pause
  exit /b 1
)

cd /d "%PROJECT_DIR%"

if not exist "node_modules" (
  echo Dang cai thu vien lan dau...
  call npm install
  if errorlevel 1 goto :start_error
)

echo Dang khoi dong Telegram WMS Simulator...
echo Trinh duyet se tu mo tai %DEMO_URL%
echo Giu cua so nay mo de demo tiep tuc chay.
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "$url='%DEMO_URL%'; 1..60 | ForEach-Object { try { Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 1 | Out-Null; Start-Process $url; exit } catch { Start-Sleep -Milliseconds 500 } }"
call npm run dev -- --host 127.0.0.1 --port 5173 --strictPort

if errorlevel 1 goto :start_error
exit /b 0

:start_error
echo.
echo Khong the khoi dong demo. Kiem tra thong bao loi phia tren.
pause
exit /b 1
