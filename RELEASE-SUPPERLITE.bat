@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

for /f "tokens=*" %%t in ('gh auth token 2^>nul') do set GH_TOKEN=%%t

echo ============================================
echo   DBY POS - SUPPER LITE PATCH
echo   Chi gom dist + package.json
echo ============================================
echo.
echo [!] Chi dung cho thay doi giao dien, CSS, cong thuc frontend.
echo [!] Neu sua electron, prisma, python hoac them dependency, dung RELEASE-ver3.bat.
echo.

for /f %%v in ('node scripts\release-version.cjs current') do set CURRENT_VERSION=%%v
if not defined CURRENT_VERSION (
    echo [ERROR] Cannot read version from package.json.
    pause
    exit /b 1
)

for /f %%v in ('node scripts\release-version.cjs next-patch') do set NEW_VERSION=%%v
if not defined NEW_VERSION (
    echo [ERROR] Cannot calculate next patch version.
    pause
    exit /b 1
)

set NOTES=Lite patch - UI and formula updates
set PATCH_ZIP=DBYPOS-PATCH-LITE-v!NEW_VERSION!.zip
set PATCH_ZIP_PATH=%CD%\!PATCH_ZIP!
set PATCH_TEMP=%CD%\_patch_lite_temp

echo Version: v!CURRENT_VERSION! -^> v!NEW_VERSION!
echo.

echo [1/4] Update package.json...
node scripts\release-version.cjs set !NEW_VERSION! >nul
if errorlevel 1 (
    echo [ERROR] package.json update failed.
    pause
    exit /b 1
)
echo [OK] Version updated.
echo.

echo [2/4] Build Vite...
call npx vite build
if errorlevel 1 (
    echo [ERROR] Vite build failed.
    node scripts\release-version.cjs set !CURRENT_VERSION! >nul
    echo [OK] Restored package.json to v!CURRENT_VERSION!.
    pause
    exit /b 1
)
echo [OK] Vite build completed.
echo.

echo [3/4] Create lite patch...
if exist "!PATCH_ZIP_PATH!" del /Q "!PATCH_ZIP_PATH!"
if exist "!PATCH_TEMP!" rmdir /S /Q "!PATCH_TEMP!"

mkdir "!PATCH_TEMP!\resources\app\dist"
xcopy "dist\*" "!PATCH_TEMP!\resources\app\dist\" /E /I /Y /Q >nul 2>&1
copy /Y "package.json" "!PATCH_TEMP!\resources\app\package.json" >nul 2>&1

powershell -NoProfile -Command "Compress-Archive -Path '!PATCH_TEMP!\*' -DestinationPath '!PATCH_ZIP_PATH!' -Force"
set ZIP_EXIT=!errorlevel!
rmdir /S /Q "!PATCH_TEMP!" 2>nul

if !ZIP_EXIT! neq 0 (
    echo [ERROR] Patch zip creation failed.
    node scripts\release-version.cjs set !CURRENT_VERSION! >nul
    pause
    exit /b 1
)

for %%F in ("!PATCH_ZIP_PATH!") do (
    set FILE_SIZE=%%~zF
    set /a FILE_SIZE_MB=!FILE_SIZE! / 1048576
)
echo [OK] Created !PATCH_ZIP! (~!FILE_SIZE_MB! MB)
set CHECKSUM_FILE=!PATCH_ZIP_PATH!.sha256
powershell -NoProfile -Command "$zip='!PATCH_ZIP_PATH!'; $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower(); Set-Content -NoNewline -LiteralPath '!CHECKSUM_FILE!' -Value ($hash + '  ' + [IO.Path]::GetFileName($zip))"
if errorlevel 1 (
    echo [ERROR] Cannot create SHA256 checksum.
    pause
    exit /b 1
)
if not exist "!CHECKSUM_FILE!" (
    echo [ERROR] SHA256 checksum is missing.
    pause
    exit /b 1
)
echo [OK] Created !CHECKSUM_FILE!
echo.

echo [4/4] Git and GitHub release...
git add -A
git commit -m "v!NEW_VERSION! - !NOTES!"
if errorlevel 1 (
    echo [WARN] Git commit failed or there is nothing new to commit.
) else (
    git push origin master
    if errorlevel 1 (
        echo [ERROR] Git push failed. Patch zip was kept locally.
        pause
        exit /b 1
    )
)

gh release create v!NEW_VERSION! "!PATCH_ZIP_PATH!" "!CHECKSUM_FILE!" --title "DBY POS v!NEW_VERSION! (LITE PATCH)" --notes "!NOTES!"
if errorlevel 1 (
    echo [ERROR] GitHub release creation failed. Patch zip was kept locally.
    pause
    exit /b 1
)

del /Q "!PATCH_ZIP_PATH!" 2>nul
del /Q "!CHECKSUM_FILE!" 2>nul

echo.
echo ============================================
echo   SUPPER LITE PATCH COMPLETED
echo ============================================
echo Version : v!NEW_VERSION!
echo Patch   : !PATCH_ZIP! (~!FILE_SIZE_MB! MB)
echo.
pause
