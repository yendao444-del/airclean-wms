@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0.."

for /f "tokens=*" %%t in ('gh auth token 2^>nul') do set GH_TOKEN=%%t

:: Dọn file rác từ lần chạy trước
del /Q "DBYPOS-PATCH-*.zip" 2>nul
del /Q "v" 2>nul
for /f "delims=" %%f in ('dir /b "v[0-9]*" 2^>nul') do del /Q "%%f" 2>nul

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

for /f %%v in ('node scripts\\release-version.cjs current') do set CURRENT_VERSION=%%v
if not defined CURRENT_VERSION (
    echo [ERROR] Cannot read version from package.json
    pause
    exit /b 1
)
echo Current version: v!CURRENT_VERSION!
echo.

for /f %%v in ('node scripts\\release-version.cjs next-patch') do set NEW_VERSION=%%v
if not defined NEW_VERSION (
    echo [ERROR] Cannot calculate next patch version
    pause
    exit /b 1
)
set NOTES=Patch update - Bug fixes and improvements
set BUILD_DIST=%CD%\_release_dist

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
    pause
    exit /b 1
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

call node scripts\prepare-google-oauth-config.js
if errorlevel 1 (
    echo    [ERROR] Khong tao duoc google-oauth-config.json cho ban production.
    echo            Kiem tra OAUTH_CLIENT_ID/OAUTH_CLIENT_SECRET roi chay lai.
    pause
    exit /b 1
)

call node scripts\embed-wms-token.js
if errorlevel 1 (
    echo    [ERROR] Khong dong goi duoc Telegram WMS bot token.
    echo            Kiem tra TELEGRAM_WMS_BOT_TOKEN trong .env roi chay lai.
    pause
    exit /b 1
)

if exist "%APPDATA%\quan-ly-ban-hang-desktop\gdrive-token.json" (
    copy /Y "%APPDATA%\quan-ly-ban-hang-desktop\gdrive-token.json" "electron\gdrive-token.json" >nul 2>&1
    echo    [OK] Auto-copy gdrive-token.json moi nhat tu AppData vao electron/
) else (
    if not exist "electron\gdrive-token.json" (
        echo    [!] CANH BAO: Khong co gdrive-token.json - Google Drive upload se THAT BAI tren production!
        echo        Chay reauth-gdrive.bat truoc khi build.
    )
)
call node scripts\verify-gdrive-release-token.cjs "electron\gdrive-token.json"
if errorlevel 1 (
    rmdir /S /Q "!PATCH_TEMP!" 2>nul
    rmdir /S /Q "!BUILD_DIST!" 2>nul
    pause
    exit /b 1
)
xcopy "!BUILD_DIST!\*" "!PATCH_TEMP!\resources\app\dist\" /E /I /Y /Q >nul 2>&1
xcopy "electron\*" "!PATCH_TEMP!\resources\app\electron\" /E /I /Y /Q >nul 2>&1
call node scripts\prepare-r2-daily-evidence-config.js "!PATCH_TEMP!\resources\app\electron\r2-daily-evidence-bootstrap.json"
if errorlevel 1 (
    echo    [ERROR] Khong tao duoc cau hinh R2 cho Cong viec hang ngay.
    pause
    exit /b 1
)
:: Patch desktop chi can google-oauth-config.json da tao o tren. Khong phat
:: hanh config dev co database/service credentials cho may nhan vien.
del /Q "!PATCH_TEMP!\resources\app\electron\config.js" 2>nul
del /Q "!PATCH_TEMP!\resources\app\electron\supabase-storage.json" 2>nul
del /Q "!PATCH_TEMP!\resources\app\electron\gdrive-credentials.json" 2>nul
call node scripts\verify-gdrive-release-token.cjs "!PATCH_TEMP!\resources\app\electron\gdrive-token.json"
if errorlevel 1 (
    rmdir /S /Q "!PATCH_TEMP!" 2>nul
    rmdir /S /Q "!BUILD_DIST!" 2>nul
    pause
    exit /b 1
)
xcopy "node_modules\@supabase\*" "!PATCH_TEMP!\resources\app\node_modules\@supabase\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\@zxing\*" "!PATCH_TEMP!\resources\app\node_modules\@zxing\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\cloudflared\*" "!PATCH_TEMP!\resources\app\node_modules\cloudflared\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\iceberg-js\*" "!PATCH_TEMP!\resources\app\node_modules\iceberg-js\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\tslib\*" "!PATCH_TEMP!\resources\app\node_modules\tslib\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\ws\*" "!PATCH_TEMP!\resources\app\node_modules\ws\" /E /I /Y /Q >nul 2>&1

if not exist "!PATCH_TEMP!\resources\app\node_modules\ws\index.js" (
    echo    [ERROR] Thieu node_modules\ws trong patch. Khong tao goi update khong day du.
    rmdir /S /Q "!PATCH_TEMP!" 2>nul
    rmdir /S /Q "!BUILD_DIST!" 2>nul
    pause
    exit /b 1
)
if not exist "!PATCH_TEMP!\resources\app\node_modules\@zxing\browser\umd\zxing-browser.min.js" (
    echo    [ERROR] Thieu node_modules\@zxing trong patch. Khong tao goi update khong day du.
    rmdir /S /Q "!PATCH_TEMP!" 2>nul
    rmdir /S /Q "!BUILD_DIST!" 2>nul
    pause
    exit /b 1
)
if not exist "!PATCH_TEMP!\resources\app\node_modules\cloudflared\bin\cloudflared.exe" (
    echo    [ERROR] Thieu node_modules\cloudflared trong patch. Khong tao goi update khong day du.
    rmdir /S /Q "!PATCH_TEMP!" 2>nul
    rmdir /S /Q "!BUILD_DIST!" 2>nul
    pause
    exit /b 1
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
    pause
    exit /b 1
)

if not exist "!PATCH_ZIP_PATH!" (
    echo [ERROR] Patch zip not found after compression.
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
if errorlevel 1 ( echo [ERROR] Cannot create SHA256 checksum. & pause & exit /b 1 )
if not exist "!CHECKSUM_FILE!" ( echo [ERROR] SHA256 checksum is missing. & pause & exit /b 1 )
echo.

echo [4/4] Git and GitHub release...
echo ----------------------------------------
git add -A -- AGENTS.md updates package.json package-lock.json electron scripts src public index.html vite.config.ts tsconfig.json tsconfig.node.json START.bat START-DEV.bat RESTORE.bat reauth-gdrive.js
git commit -m "v!NEW_VERSION! - !NOTES!"
if errorlevel 1 (
    echo [ERROR] Git commit failed. Stop before push and GitHub release.
    node scripts\release-version.cjs set !CURRENT_VERSION! >nul
    git add -- package.json
    if exist "!PATCH_ZIP_PATH!" del /Q "!PATCH_ZIP_PATH!"
    if exist "!CHECKSUM_FILE!" del /Q "!CHECKSUM_FILE!"
    pause
    exit /b 1
)
echo [OK] Git commit completed.

git push origin master > _gh_out.txt 2>&1
set PUSH_EXIT=!errorlevel!
type _gh_out.txt
del _gh_out.txt >nul 2>&1
if !PUSH_EXIT! neq 0 (
    echo [WARN] Git push failed. Stop before GitHub release.
    pause
    exit /b 1
)
echo [OK] Git push completed.

echo Dang upload !PATCH_ZIP! len GitHub... (file ~!FILE_SIZE_MB! MB, co the mat 2-5 phut)
gh release create v!NEW_VERSION! "!PATCH_ZIP_PATH!" "!CHECKSUM_FILE!" --title "DBY POS v!NEW_VERSION! (PATCH)" --notes "!NOTES!"
set GH_EXIT=!errorlevel!
if !GH_EXIT! neq 0 (
    echo [ERROR] GitHub release creation failed.
    pause
    exit /b 1
)
echo [OK] GitHub release created.

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
