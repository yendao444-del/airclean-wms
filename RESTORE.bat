@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo   AIRCLEAN WMS - RESTORE SOURCE CODE
echo ============================================
echo.

set SCRIPT_DIR=%~dp0
set BUNDLE_PATH=
for %%F in ("%SCRIPT_DIR%*.bundle") do set BUNDLE_PATH=%%F

if "!BUNDLE_PATH!"=="" (
    echo [LOI] Khong tim thay file .bundle cung thu muc!
    pause
    exit /b 1
)
echo Tim thay: !BUNDLE_PATH!

set PROJECT_DIR=!SCRIPT_DIR!airclean-wms
if exist "!PROJECT_DIR!" (
    set PROJECT_DIR=!SCRIPT_DIR!airclean-wms_%date:~6,4%%date:~3,2%%date:~0,2%
)
echo Restore vao: !PROJECT_DIR!
echo.

echo [1/4] Clone tu bundle...
git clone "!BUNDLE_PATH!" "!PROJECT_DIR!"
if errorlevel 1 (
    echo [LOI] Clone that bai!
    pause
    exit /b 1
)
echo [OK] Clone thanh cong!

echo.
echo [2/4] Cai dat dependencies...
cd /d "!PROJECT_DIR!"
npm install
if errorlevel 1 (
    echo [LOI] npm install that bai!
    pause
    exit /b 1
)
echo [OK] npm install thanh cong!

echo.
echo [3/4] Generate Prisma client...
npx prisma generate
if errorlevel 1 (
    echo [CANH BAO] prisma generate that bai.
) else (
    echo [OK] Prisma generate thanh cong!
)

echo.
echo [4/4] Mo VSCode...
code .

echo.
echo ============================================
echo   RESTORE HOAN TAT - San sang code!
echo ============================================
echo   - npm run dev    (chay dev mode)
echo   - RELEASE.bat    (build + deploy)
echo ============================================
echo.
pause