@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

for /f "tokens=*" %%t in ('gh auth token 2^>nul') do set GH_TOKEN=%%t

echo ============================================
echo   DBY POS - Build ^& Release Tool
echo ============================================
echo.

:: Read current version from package.json
for /f %%v in ('node scripts\\release-version.cjs current') do set CURRENT_VERSION=%%v
if not defined CURRENT_VERSION ( echo [ERROR] Cannot read version from package.json & pause & exit /b 1 )

:: Increment patch version using Node to avoid fragile text parsing
for /f %%v in ('node scripts\\release-version.cjs next-patch') do set NEW_VERSION=%%v
if not defined NEW_VERSION ( echo [ERROR] Cannot calculate next patch version & pause & exit /b 1 )
set NOTES=Bug fixes and improvements

echo Tang version: v!CURRENT_VERSION! -^> v!NEW_VERSION!
echo.

:: Cập nhật package.json
node scripts\release-version.cjs set !NEW_VERSION! >nul

echo [1/6] Regenerate Prisma Client...
echo ----------------------------------------
:: Kill Electron/Node neu dang chay (tranh lock file DLL)
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM "DBY POS.exe" >nul 2>&1
timeout /t 2 /nobreak >nul
call node_modules\.bin\prisma generate
if errorlevel 1 ( echo ❌ Prisma generate that bai! & pause & exit /b 1 )
echo ✅ Prisma generate thanh cong!
echo.

echo [2/6] Building Vite...
echo ----------------------------------------
call node_modules\.bin\vite build
if errorlevel 1 ( echo ❌ Vite build that bai! & pause & exit /b 1 )
echo ✅ Vite build thanh cong!
echo.

echo [3/7] Building Python Face Service EXE...
echo ----------------------------------------
call "python\build_face_service.bat"
if errorlevel 1 ( echo ❌ Python face service EXE build that bai! Dung release. & pause & exit /b 1 )
echo.

echo [4/7] Building Electron...
echo ----------------------------------------
node --max-old-space-size=4096 node_modules/electron-builder/cli.js
if errorlevel 1 ( echo ❌ Electron build that bai! & pause & exit /b 1 )
echo ✅ Electron build thanh cong!
echo.

echo [5/7] Nhung icon + Copy Prisma...
echo ----------------------------------------
for /f "tokens=*" %%r in ('dir /s /b "%LOCALAPPDATA%\\electron-builder\\Cache\\winCodeSign\\rcedit-x64.exe" 2^>nul') do (
    "%%r" "release4\\win-unpacked\\DBY POS.exe" --set-icon "public\\app_icon.ico" >nul 2>&1
)
xcopy "node_modules\.prisma\*" "release4\win-unpacked\resources\app\node_modules\.prisma\" /E /I /Y /Q >nul 2>&1
echo ✅ Xong!
echo.

echo [6/7] Nen file zip (chi resources, khong nen Electron runtime)...
echo ----------------------------------------
if exist "DBYPOS-v!NEW_VERSION!.zip" del "DBYPOS-v!NEW_VERSION!.zip"

:: Tao thu muc tam voi cau truc giong RELEASE-ver2 nhung co them node_modules Prisma
if exist "_full_temp" rmdir /S /Q "_full_temp"
mkdir "_full_temp\resources\app\dist"
mkdir "_full_temp\resources\app\electron"
mkdir "_full_temp\resources\app\node_modules\@prisma"
mkdir "_full_temp\resources\app\node_modules\.prisma"

xcopy "dist\*"                       "_full_temp\resources\app\dist\"                        /E /I /Y /Q >nul 2>&1
xcopy "electron\*"                   "_full_temp\resources\app\electron\"                    /E /I /Y /Q >nul 2>&1
xcopy "node_modules\@prisma\*"       "_full_temp\resources\app\node_modules\@prisma\"        /E /I /Y /Q >nul 2>&1
xcopy "node_modules\.prisma\*"       "_full_temp\resources\app\node_modules\.prisma\"        /E /I /Y /Q >nul 2>&1
:: Pack EXE nhận diện khuôn mặt — máy khách không cần cài Python
if exist "python\dist\attendance_service.exe" (
    mkdir "_full_temp\resources\app\python\dist" >nul 2>&1
    copy /Y "python\dist\attendance_service.exe" "_full_temp\resources\app\python\dist\" >nul 2>&1
    echo    [OK] Included attendance_service.exe ^(standalone mode^)
) else (
    echo    [!] Khong co EXE - fallback Python script se duoc dung
)
:: Luon copy .py + requirements (fallback cho may co Python cai san)
mkdir "_full_temp\resources\app\python" >nul 2>&1
copy /Y "python\attendance_service.py"  "_full_temp\resources\app\python\" >nul 2>&1
copy /Y "python\requirements.txt"       "_full_temp\resources\app\python\" >nul 2>&1
copy /Y "package.json"               "_full_temp\resources\app\package.json"                 >nul 2>&1

cd _full_temp
powershell -Command "Compress-Archive -Path '*' -DestinationPath '..\DBYPOS-v!NEW_VERSION!.zip' -Force"
cd ..

rmdir /S /Q "_full_temp" 2>nul

if not exist "DBYPOS-v!NEW_VERSION!.zip" ( echo ❌ Nen zip that bai! & pause & exit /b 1 )
for %%F in ("DBYPOS-v!NEW_VERSION!.zip") do set /a FILE_SIZE_MB=%%~zF / 1048576
echo ✅ Nen thanh cong: DBYPOS-v!NEW_VERSION!.zip (~!FILE_SIZE_MB! MB)
echo.

echo [7/7] Git commit + Push + GitHub Release...
echo ----------------------------------------
git add -A
git commit -m "v!NEW_VERSION! - !NOTES!"
git push origin master > _gh_out.txt 2>&1
set PUSH_EXIT=!errorlevel!
type _gh_out.txt
del _gh_out.txt >nul 2>&1
if !PUSH_EXIT! neq 0 ( echo [LOI] Git push that bai! & pause & exit /b 1 )
echo [OK] Push len GitHub thanh cong!

set CURRENT_DIR=%CD%
echo.
echo Dang tao GitHub Release...
gh release create v!NEW_VERSION! "%CURRENT_DIR%\DBYPOS-v!NEW_VERSION!.zip" --title "DBY POS v!NEW_VERSION!" --notes "!NOTES!" > _gh_out.txt 2>&1
set GH_EXIT=!errorlevel!
type _gh_out.txt
del _gh_out.txt >nul 2>&1
if !GH_EXIT! neq 0 (
    echo [LOI] Tao GitHub Release that bai! Tiep tuc backup...
) else (
    echo [OK] GitHub Release tao thanh cong!
)

echo.
echo ============================================
echo   [7/7] KHOI DONG DONG BO GOOGLE DRIVE
echo ============================================
call node _auto_backup_drive.js
if errorlevel 1 (
    echo.
    echo ❌ LOI: Google Drive Backup THAT BAI!
    echo    Kiem tra: electron\gdrive-credentials.json hoac electron\gdrive-token.json co hop le khong?
    set GDRIVE_STATUS=THAT BAI
) else (
    echo.
    echo ✅ Google Drive Backup THANH CONG!
    set GDRIVE_STATUS=THANH CONG
)

echo.
echo ============================================
echo   TONG KET CUOI CUNG
echo ============================================
echo   Version: v!NEW_VERSION!
echo   ZIP: DBYPOS-v!NEW_VERSION!.zip (~!FILE_SIZE_MB! MB)
echo   URL: https://github.com/yendao444-del/airclean-wms/releases/tag/v!NEW_VERSION!
echo   [OK] Git Push:       THANH CONG
echo   [OK] GitHub Release: THANH CONG
echo   [GD] Google Drive:   !GDRIVE_STATUS!
echo ============================================
echo.
pause
