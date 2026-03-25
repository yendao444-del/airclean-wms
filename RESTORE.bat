@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo   AIRCLEAN WMS - RESTORE SOURCE CODE
echo ============================================
echo.
echo Buoc 1: Chon file .bundle de restore...
echo.
set /p BUNDLE_PATH=Nhap duong dan file .bundle (vi du: C:Downloadsackup.bundle): 

if not exist "!BUNDLE_PATH!" (
    echo [LOI] Khong tim thay file: !BUNDLE_PATH!
    pause
    exit /b 1
)

set /p PROJECT_NAME=Nhap ten thu muc project (vi du: airclean-wms): 

if exist "!PROJECT_NAME!" (
    echo [LOI] Thu muc "!PROJECT_NAME!" da ton tai! Doi ten khac.
    pause
    exit /b 1
)

echo.
echo [1/4] Clone tu bundle...
git clone "!BUNDLE_PATH!" "!PROJECT_NAME!"
if errorlevel 1 (
    echo [LOI] Clone that bai!
    pause
    exit /b 1
)
echo [OK] Clone thanh cong!

echo.
echo [2/4] Cai dat dependencies...
cd "!PROJECT_NAME!"
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
    echo [CANH BAO] prisma generate that bai, kiem tra lai sau.
) else (
    echo [OK] Prisma generate thanh cong!
)

echo.
echo [4/4] Mo VSCode...
code .

echo.
echo ============================================
echo   RESTORE HOAN TAT!
echo ============================================
echo.
echo   Project: !PROJECT_NAME!
echo   San sang code!
echo.
echo   Cac lenh tiep theo:
echo   - npm run dev       (chay dev mode)
echo   - RELEASE.bat       (build + deploy)
echo ============================================
echo.
pause