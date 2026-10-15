@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0.."
set "CURRENT_VERSION="
set "NEW_VERSION="
set "VERSION_BUMPED="

:: Keep existing ZIP/checksum pairs so interrupted uploads can be resumed.
set "RESUME_VERSION="
if /I "%~1"=="--resume" (
    set "RESUME_VERSION=%~2"
    if not defined RESUME_VERSION (
        echo Usage: RELEASE-ver3.bat --resume 1.0.488
        exit /b 1
    )
)

echo ============================================
echo   DBY POS - QUICK PATCH Release
echo   Chi update code (KHONG build lai EXE)
echo ============================================
echo.
echo [RULE] Khong dung file nay neu schema, migration, Prisma delegate/field thay doi.
echo [RULE] Truong hop do phai dung updates\RELEASE-PRISMA-PATCH.bat.
echo [INFO] Neu preflight bao loi, hay chay dung file release duoc goi y trong thong bao.
echo.

call node scripts\release-preflight.cjs quick
if errorlevel 1 (
    pause
    exit /b 1
)

call node --check electron\ipc-handlers.js
if errorlevel 1 goto release_failed
call node scripts\verify-data-safety.js
if errorlevel 1 goto release_failed

set "NOTES=Patch update - Bug fixes and improvements"
set "PROJECT_DIR=%CD%"
set "BUILD_DIST=%CD%\_release_dist"

if defined RESUME_VERSION (
    set "NEW_VERSION=!RESUME_VERSION!"
    set "PATCH_ZIP=DBYPOS-PATCH-v!RESUME_VERSION!.zip"
    set "PATCH_ZIP_PATH=!PROJECT_DIR!\DBYPOS-PATCH-v!RESUME_VERSION!.zip"
    set "CHECKSUM_FILE=!PATCH_ZIP_PATH!.sha256"
    call node scripts\release-publish.cjs --verify-only "!NEW_VERSION!" "!PATCH_ZIP_PATH!"
    if errorlevel 1 goto release_failed
    call npm run build
    if errorlevel 1 goto release_failed
    echo [INFO] Resuming v!NEW_VERSION! without version bump, commit or push.
    goto publish_release
)

for /f %%v in ('node scripts\\release-version.cjs current') do set CURRENT_VERSION=%%v
if not defined CURRENT_VERSION (
    echo [ERROR] Cannot read version from package.json
    pause
    exit /b 1
)
echo Current version: v!CURRENT_VERSION!
echo.

call node scripts\release-publish.cjs --prepare-existing "!CURRENT_VERSION!"
if errorlevel 1 goto release_failed

for /f %%v in ('node scripts\\release-version.cjs next-patch') do set NEW_VERSION=%%v
if not defined NEW_VERSION (
    echo [ERROR] Cannot calculate next patch version
    pause
    exit /b 1
)
call node scripts\release-publish.cjs --prepare-existing "!NEW_VERSION!"
if errorlevel 1 goto release_failed

echo Bump version: v!CURRENT_VERSION! -^> v!NEW_VERSION!
echo.

echo [1/4] Update package.json...
node scripts\release-version.cjs set !NEW_VERSION! >nul
if errorlevel 1 (
    echo [ERROR] package.json update failed.
    pause
    exit /b 1
)
echo [OK] package.json updated to v!NEW_VERSION!
set "VERSION_BUMPED=1"
echo.

echo [2/4] Type-check and build renderer...
echo ----------------------------------------
if exist "!BUILD_DIST!" rmdir /S /Q "!BUILD_DIST!"
call npm run build -- --outDir "!BUILD_DIST!" --emptyOutDir
if errorlevel 1 (
    echo.
    echo [ERROR] TypeScript or Vite build failed.
    if exist "!BUILD_DIST!" rmdir /S /Q "!BUILD_DIST!"
    node scripts\release-version.cjs set !CURRENT_VERSION! >nul
    set "VERSION_BUMPED="
    goto release_failed
)
echo [OK] Renderer build completed.
echo.

echo [3/4] Create patch zip...
echo ----------------------------------------
set PROJECT_DIR=%CD%
set PATCH_ZIP=DBYPOS-PATCH-v!NEW_VERSION!.zip
set PATCH_ZIP_PATH=!PROJECT_DIR!\!PATCH_ZIP!
set PATCH_TEMP=!PROJECT_DIR!\_patch_temp

if exist "!PATCH_ZIP_PATH!" del "!PATCH_ZIP_PATH!"
if exist "!PATCH_TEMP!" rmdir /S /Q "!PATCH_TEMP!"

mkdir "!PATCH_TEMP!\resources\app\dist"
mkdir "!PATCH_TEMP!\resources\app\electron"
mkdir "!PATCH_TEMP!\resources\app\python"
mkdir "!PATCH_TEMP!\resources\app\node_modules\@supabase"
mkdir "!PATCH_TEMP!\resources\app\node_modules\@zxing"
mkdir "!PATCH_TEMP!\resources\app\node_modules\cloudflared"
mkdir "!PATCH_TEMP!\resources\app\node_modules\iceberg-js"
mkdir "!PATCH_TEMP!\resources\app\node_modules\tslib"
mkdir "!PATCH_TEMP!\resources\app\node_modules\ws"


:: Google authorization is held by the shared Cloudflare backend.
call node --check electron\drive-backend.js
if errorlevel 1 (
    rmdir /S /Q "!PATCH_TEMP!" 2>nul
    rmdir /S /Q "!BUILD_DIST!" 2>nul
    goto release_failed
)
xcopy "!BUILD_DIST!\*" "!PATCH_TEMP!\resources\app\dist\" /E /I /Y /Q >nul 2>&1
xcopy "electron\*" "!PATCH_TEMP!\resources\app\electron\" /E /I /Y /Q >nul 2>&1
:: Desktop uses the shared Drive backend; no Google credentials are shipped.
del /Q "!PATCH_TEMP!\resources\app\electron\config.js" 2>nul
del /Q "!PATCH_TEMP!\resources\app\electron\supabase-storage.json" 2>nul
del /Q "!PATCH_TEMP!\resources\app\electron\gdrive-credentials.json" 2>nul
call node scripts\prepare-drive-backend-stage.cjs "!PATCH_TEMP!\resources\app\electron"
if errorlevel 1 (
    rmdir /S /Q "!PATCH_TEMP!" 2>nul
    rmdir /S /Q "!BUILD_DIST!" 2>nul
    goto release_failed
)
for %%D in (@supabase @zxing cloudflared iceberg-js tslib ws) do (
    echo    Copying node_modules\%%D ...
    robocopy "node_modules\%%D" "!PATCH_TEMP!\resources\app\node_modules\%%D" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
    if errorlevel 8 (
        echo [ERROR] Failed to copy node_modules\%%D.
        rmdir /S /Q "!PATCH_TEMP!" 2>nul
        rmdir /S /Q "!BUILD_DIST!" 2>nul
        goto release_failed
    )
)

if not exist "!PATCH_TEMP!\resources\app\node_modules\ws\index.js" (
    echo    [ERROR] Thieu node_modules\ws trong patch. Khong tao goi update khong day du.
    rmdir /S /Q "!PATCH_TEMP!" 2>nul
    rmdir /S /Q "!BUILD_DIST!" 2>nul
    goto release_failed
)
if not exist "!PATCH_TEMP!\resources\app\node_modules\@zxing\browser\umd\zxing-browser.min.js" (
    echo    [ERROR] Thieu node_modules\@zxing trong patch. Khong tao goi update khong day du.
    rmdir /S /Q "!PATCH_TEMP!" 2>nul
    rmdir /S /Q "!BUILD_DIST!" 2>nul
    goto release_failed
)
if not exist "!PATCH_TEMP!\resources\app\node_modules\cloudflared\bin\cloudflared.exe" (
    echo    [ERROR] Thieu node_modules\cloudflared trong patch. Khong tao goi update khong day du.
    rmdir /S /Q "!PATCH_TEMP!" 2>nul
    rmdir /S /Q "!BUILD_DIST!" 2>nul
    goto release_failed
)
copy /Y "python\attendance_service.py" "!PATCH_TEMP!\resources\app\python\" >nul 2>&1
copy /Y "python\requirements.txt" "!PATCH_TEMP!\resources\app\python\" >nul 2>&1
copy /Y "package.json" "!PATCH_TEMP!\resources\app\package.json" >nul 2>&1
echo    [OK] Khong kem EXE ^(dung updates\RELEASE-ver2.bat neu can cap nhat Python service^)

powershell -NoProfile -Command "Compress-Archive -Path '!PATCH_TEMP!\*' -DestinationPath '!PATCH_ZIP_PATH!' -Force"
set ZIP_EXIT=!errorlevel!

rmdir /S /Q "!PATCH_TEMP!" 2>nul
rmdir /S /Q "!BUILD_DIST!" 2>nul

if !ZIP_EXIT! neq 0 (
    echo [ERROR] Patch zip creation failed.
    goto release_failed
)

if not exist "!PATCH_ZIP_PATH!" (
    echo [ERROR] Patch zip not found after compression.
    goto release_failed
)

for %%F in ("!PATCH_ZIP_PATH!") do (
    set FILE_SIZE=%%~zF
    set /a FILE_SIZE_MB=!FILE_SIZE! / 1048576
)
echo [OK] Created !PATCH_ZIP! (~!FILE_SIZE_MB! MB)
set CHECKSUM_FILE=!PATCH_ZIP_PATH!.sha256
powershell -NoProfile -Command "$zip='!PATCH_ZIP_PATH!'; $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower(); Set-Content -NoNewline -LiteralPath '!CHECKSUM_FILE!' -Value ($hash + '  ' + [IO.Path]::GetFileName($zip))"
if errorlevel 1 goto release_failed
if not exist "!CHECKSUM_FILE!" goto release_failed
node scripts\release-publish.cjs --verify-only "!NEW_VERSION!" "!PATCH_ZIP_PATH!"
if errorlevel 1 (
    echo [ERROR] Release archive verification failed. Upload blocked.
    goto release_failed
)
echo.

echo [4/4] Git and GitHub release...
echo ----------------------------------------
git add -A -- AGENTS.md updates package.json package-lock.json electron scripts src public index.html vite.config.ts tsconfig.json tsconfig.node.json START.bat START-DEV.bat RESTORE.bat reauth-gdrive.js
git commit -m "v!NEW_VERSION! - !NOTES!"
if errorlevel 1 (
    echo [ERROR] Git commit failed. Stop before push and GitHub release.
    goto release_failed
)
echo [OK] Git commit completed.

git push origin master > _gh_out.txt 2>&1
set PUSH_EXIT=!errorlevel!
type _gh_out.txt
del _gh_out.txt >nul 2>&1
if !PUSH_EXIT! neq 0 (
    echo [WARN] Git push failed. Stop before GitHub release.
    goto release_failed
)
echo [OK] Git push completed.

:publish_release
echo Dang upload !PATCH_ZIP! len GitHub... ^(co the mat 2-5 phut^)
node scripts\release-publish.cjs "!NEW_VERSION!" "!PATCH_ZIP_PATH!"
if errorlevel 1 goto release_failed

:: A failed normal release restores the old local version. After a successful
:: resume, advance only that previous patch version; never downgrade a newer one.
if defined RESUME_VERSION (
    set "LOCAL_NEXT_VERSION="
    for /f %%v in ('node scripts\release-version.cjs next-patch') do set "LOCAL_NEXT_VERSION=%%v"
    if "!LOCAL_NEXT_VERSION!"=="!NEW_VERSION!" node scripts\release-version.cjs set !NEW_VERSION! >nul
)

:: Xóa zip sau khi upload thành công
if exist "!PATCH_ZIP_PATH!" del /Q "!PATCH_ZIP_PATH!" && echo [OK] Da xoa zip sau khi upload.
if exist "!CHECKSUM_FILE!" del /Q "!CHECKSUM_FILE!"
echo.

echo ============================================
echo   QUICK PATCH COMPLETED
echo ============================================
echo Version : v!NEW_VERSION!
echo Patch   : !PATCH_ZIP! (~!FILE_SIZE_MB! MB)
echo.
pause
exit /b 0

:release_failed
if defined VERSION_BUMPED node scripts\release-version.cjs set !CURRENT_VERSION! >nul
echo [ERROR] Release stopped. Local ZIP and checksum are kept for recovery.
if defined NEW_VERSION echo [INFO] Retry: updates\RELEASE-ver3.bat --resume !NEW_VERSION!
pause
exit /b 1
