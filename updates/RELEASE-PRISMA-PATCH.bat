@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0.."

echo ============================================
echo   DBY POS - PRISMA PATCH
echo   Code + generated Prisma Client, no Python EXE
echo ============================================
echo.
echo [RULE] Use this file when schema, migration, Prisma delegate or Prisma field changes.
echo [RULE] Use updates\RELEASE-ver2.bat instead when the Python service also changes.
echo.

call node scripts\release-preflight.cjs prisma
if errorlevel 1 goto release_failed_before_version

for /f %%v in ('node scripts\release-version.cjs current') do set CURRENT_VERSION=%%v
if not defined CURRENT_VERSION (
    echo [ERROR] Cannot read version from package.json.
    goto release_failed_before_version
)
for /f %%v in ('node scripts\release-version.cjs next-patch') do set NEW_VERSION=%%v
if not defined NEW_VERSION (
    echo [ERROR] Cannot calculate next patch version.
    goto release_failed_before_version
)

set NOTES=Prisma patch - database client and application update
set PATCH_ZIP=DBYPOS-PATCH-v!NEW_VERSION!.zip
set PATCH_ZIP_PATH=%CD%\!PATCH_ZIP!
set CHECKSUM_FILE=!PATCH_ZIP_PATH!.sha256
set PATCH_TEMP=%CD%\_patch_prisma_temp
set VERSION_CHANGED=0

echo Version: v!CURRENT_VERSION! -^> v!NEW_VERSION!
echo.

echo [1/8] Update package version...
call node scripts\release-version.cjs set !NEW_VERSION! >nul
if errorlevel 1 goto release_failed
set VERSION_CHANGED=1

echo [2/8] Stop local app and regenerate Prisma Client...
powershell -NoProfile -Command "$root=(Resolve-Path '.').Path; Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe','electron.exe') -and $_.CommandLine -like ('*'+$root+'*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
taskkill /F /IM "DBY POS.exe" >nul 2>&1
timeout /t 2 /nobreak >nul
del /Q "node_modules\.prisma\client\query_engine-windows.dll.node.tmp*" 2>nul
call npx prisma generate
if errorlevel 1 goto release_failed

echo [3/8] Run mandatory source checks...
call npm run build
if errorlevel 1 goto release_failed
call node --check electron\ipc-handlers.js
if errorlevel 1 goto release_failed
call node scripts\verify-data-safety.js
if errorlevel 1 goto release_failed

echo [4/8] Prepare production configuration...
call node scripts\prepare-google-oauth-config.js
if errorlevel 1 goto release_failed
call node scripts\embed-wms-token.js
if errorlevel 1 goto release_failed

echo [5/8] Stage patch contents...
if exist "!PATCH_TEMP!" rmdir /S /Q "!PATCH_TEMP!"
if exist "!PATCH_ZIP_PATH!" del /Q "!PATCH_ZIP_PATH!"
if exist "!CHECKSUM_FILE!" del /Q "!CHECKSUM_FILE!"

mkdir "!PATCH_TEMP!\resources\app\dist"
mkdir "!PATCH_TEMP!\resources\app\electron"
mkdir "!PATCH_TEMP!\resources\app\python"
mkdir "!PATCH_TEMP!\resources\app\node_modules\@prisma\client"
mkdir "!PATCH_TEMP!\resources\app\node_modules\.prisma\client"
mkdir "!PATCH_TEMP!\resources\app\node_modules\@supabase"
mkdir "!PATCH_TEMP!\resources\app\node_modules\@zxing"
mkdir "!PATCH_TEMP!\resources\app\node_modules\cloudflared"
mkdir "!PATCH_TEMP!\resources\app\node_modules\iceberg-js"
mkdir "!PATCH_TEMP!\resources\app\node_modules\tslib"
mkdir "!PATCH_TEMP!\resources\app\node_modules\ws"

xcopy "dist\*" "!PATCH_TEMP!\resources\app\dist\" /E /I /Y /Q >nul 2>&1
xcopy "electron\*" "!PATCH_TEMP!\resources\app\electron\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\@prisma\client\*" "!PATCH_TEMP!\resources\app\node_modules\@prisma\client\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\.prisma\client\*" "!PATCH_TEMP!\resources\app\node_modules\.prisma\client\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\@supabase\*" "!PATCH_TEMP!\resources\app\node_modules\@supabase\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\@zxing\*" "!PATCH_TEMP!\resources\app\node_modules\@zxing\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\cloudflared\*" "!PATCH_TEMP!\resources\app\node_modules\cloudflared\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\iceberg-js\*" "!PATCH_TEMP!\resources\app\node_modules\iceberg-js\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\tslib\*" "!PATCH_TEMP!\resources\app\node_modules\tslib\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\ws\*" "!PATCH_TEMP!\resources\app\node_modules\ws\" /E /I /Y /Q >nul 2>&1
copy /Y "python\attendance_service.py" "!PATCH_TEMP!\resources\app\python\" >nul 2>&1
copy /Y "python\requirements.txt" "!PATCH_TEMP!\resources\app\python\" >nul 2>&1
copy /Y "package.json" "!PATCH_TEMP!\resources\app\package.json" >nul 2>&1

call node scripts\prepare-r2-daily-evidence-config.js "!PATCH_TEMP!\resources\app\electron\r2-daily-evidence-bootstrap.json"
if errorlevel 1 goto release_failed

rem Never publish development database/service credentials in a patch.
del /Q "!PATCH_TEMP!\resources\app\electron\config.js" 2>nul
del /Q "!PATCH_TEMP!\resources\app\electron\supabase-storage.json" 2>nul
del /Q "!PATCH_TEMP!\resources\app\electron\gdrive-credentials.json" 2>nul
del /Q "!PATCH_TEMP!\resources\app\electron\gdrive-token.json" 2>nul

echo [6/8] Validate staged Prisma runtime...
call node scripts\patch-runtime-smoke.cjs "!PATCH_TEMP!\resources\app"
if errorlevel 1 goto release_failed

echo [7/8] Create ZIP and SHA-256...
powershell -NoProfile -Command "Compress-Archive -Path '!PATCH_TEMP!\*' -DestinationPath '!PATCH_ZIP_PATH!' -Force"
if errorlevel 1 goto release_failed
if not exist "!PATCH_ZIP_PATH!" goto release_failed

powershell -NoProfile -Command "$zip='!PATCH_ZIP_PATH!'; $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower(); Set-Content -NoNewline -LiteralPath '!CHECKSUM_FILE!' -Value ($hash + '  ' + [IO.Path]::GetFileName($zip))"
if errorlevel 1 goto release_failed
if not exist "!CHECKSUM_FILE!" goto release_failed

powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('!PATCH_ZIP_PATH!'); try { $n=$z.Entries.FullName -replace '\\','/'; if (-not ($n -match 'resources/app/node_modules/@prisma/client/')) { exit 2 }; if (-not ($n -match 'resources/app/node_modules/.prisma/client/')) { exit 3 } } finally { $z.Dispose() }"
if errorlevel 1 goto release_failed

for %%F in ("!PATCH_ZIP_PATH!") do (
    set FILE_SIZE=%%~zF
    set /a FILE_SIZE_MB=!FILE_SIZE! / 1048576
)

echo [8/8] Publish release...
echo.
rem Stage only application and release sources. Never include tmp, qa or generated design files.
git add -A -- AGENTS.md updates package.json package-lock.json prisma electron scripts src public index.html vite.config.ts tsconfig.json tsconfig.node.json START.bat START-DEV.bat RESTORE.bat reauth-gdrive.js python\BUILD_FACE_SERVICE.md "Tai lieu\NHAT_KY_AUDIT_HIEU_NANG.md" BUILD-INSTALLER.bat RELEASE-SUPPERLITE.bat RELEASE-ver2.bat RELEASE-ver3.bat RELEASE.bat SECURITY-DEPLOYMENT.md
if errorlevel 1 goto release_failed
git commit -m "v!NEW_VERSION! - !NOTES!"
if errorlevel 1 goto release_failed
git push origin master
if errorlevel 1 goto release_failed
gh release create v!NEW_VERSION! "!PATCH_ZIP_PATH!" "!CHECKSUM_FILE!" --title "DBY POS v!NEW_VERSION! (PRISMA PATCH)" --notes "!NOTES!"
if errorlevel 1 goto release_failed

rmdir /S /Q "!PATCH_TEMP!" 2>nul
del /Q "!PATCH_ZIP_PATH!" 2>nul
del /Q "!CHECKSUM_FILE!" 2>nul
echo.
echo PRISMA PATCH COMPLETED: v!NEW_VERSION! (~!FILE_SIZE_MB! MB)
pause
exit /b 0

:release_failed
echo.
echo [ERROR] Prisma patch release failed. Nothing else will be published.
rmdir /S /Q "!PATCH_TEMP!" 2>nul
if "!VERSION_CHANGED!"=="1" call node scripts\release-version.cjs set !CURRENT_VERSION! >nul
pause
exit /b 1

:release_failed_before_version
echo.
echo [ERROR] Release preflight failed.
pause
exit /b 1
