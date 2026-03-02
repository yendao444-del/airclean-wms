@echo off
chcp 65001 >nul
echo ========================================
echo   AIRCLEAN WMS - Rebuild & Restart
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] Tat Electron cu...
taskkill /F /IM electron.exe 2>nul
timeout /t 1 /nobreak >nul

echo [2/3] Xoa dist/ cu va build lai...
if exist "dist" rmdir /s /q "dist"
call npx vite build
if %errorlevel% neq 0 (
    echo.
    echo !!! BUILD THAT BAI - Kiem tra loi phia tren !!!
    pause
    exit /b 1
)

echo [3/3] Khoi dong Electron...
echo.
start "" npx electron .

echo ========================================
echo   HOAN TAT! App dang khoi dong...
echo ========================================
timeout /t 3 /nobreak >nul
