@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
    echo [ERROR] Chua co node_modules. Hay chay npm install truoc.
    pause
    exit /b 1
)

echo Starting Vite + Electron (development mode)...
set "DBYPOS_FAST_START="
set "DBYPOS_DISABLE_AUTO_UPDATE=1"
node "scripts\start-electron-dev.js"

if errorlevel 1 (
    if exist "tmp\start-launcher-replaced.flag" (
        del /q "tmp\start-launcher-replaced.flag" >nul 2>&1
        echo.
        echo [START] Cua so log nay da duoc chuyen sang lan START moi.
        exit /b 0
    )
    echo.
    echo [ERROR] Khong the khoi dong ung dung.
    pause
    exit /b 1
)
