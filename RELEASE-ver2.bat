@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

for /f "tokens=*" %%t in ('gh auth token 2^>nul') do set GH_TOKEN=%%t

:: Dọn file rác từ lần chạy trước
del /Q "DBYPOS-PATCH-*.zip" 2>nul
del /Q "v" 2>nul
for /f "delims=" %%f in ('dir /b "v[0-9]*" 2^>nul') do del /Q "%%f" 2>nul

echo ============================================
echo   DBY POS - PATCH Release
echo   Update code and face service artifact
echo ============================================
echo.

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

echo Bump version: v!CURRENT_VERSION! -^> v!NEW_VERSION!
echo.

if not "!NEW_VERSION!"=="!CURRENT_VERSION!" (
    echo [1/7] Update package.json...
    node scripts\release-version.cjs set !NEW_VERSION! >nul
    if errorlevel 1 (
        echo [ERROR] package.json update failed.
        pause
        exit /b 1
    )
    echo [OK] package.json updated to v!NEW_VERSION!
    echo.
)

echo [2/7] Regenerate Prisma Client...
echo ----------------------------------------
:: Stop watchers first; otherwise Nodemon can restart Electron after taskkill.
powershell -NoProfile -Command "$root=(Resolve-Path '.').Path; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and (($_.CommandLine -like ('*'+$root+'*') -and $_.CommandLine -match 'nodemon.+nodemon\.electron\.json') -or $_.CommandLine -match 'prisma.+db.+execute.+20260811090000_add_handling_units') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >nul
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM "DBY POS.exe" >nul 2>&1
timeout /t 3 /nobreak >nul
del /Q "node_modules\.prisma\client\query_engine-windows.dll.node.tmp*" 2>nul
call node_modules\.bin\prisma generate
if errorlevel 1 (
    node scripts\release-version.cjs set !CURRENT_VERSION! >nul
    echo [ROLLBACK] Restored package.json to v!CURRENT_VERSION! because release did not complete.
    echo [ERROR] Prisma generate failed.
    pause
    exit /b 1
)
echo [OK] Prisma Client regenerated.
echo.

echo [3/7] Build Vite...
echo ----------------------------------------
call npx vite build
if errorlevel 1 (
    echo.
    echo [ERROR] Vite build failed.
    pause
    exit /b 1
)
echo [OK] Vite build completed.
echo.

echo [4/7] Copy code into local release folder for quick verification...
echo ----------------------------------------
:: Kill Electron/app neu dang chay (tranh lock file DLL)
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM "DBY POS.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

if not exist "release4\win-unpacked\resources\app" (
    echo [WARN] release4\win-unpacked\resources\app not found. Skip local release sync.
    goto :skip_copy_local
)

echo    Copy dist\ ...
rmdir /S /Q "release4\win-unpacked\resources\app\dist" 2>nul
xcopy "dist\*" "release4\win-unpacked\resources\app\dist\" /E /I /Y /Q >nul 2>&1

echo    Copy electron\ ...
if not exist "electron\gdrive-token.json" (
    if exist "%APPDATA%\quan-ly-ban-hang-desktop\gdrive-token.json" (
        copy /Y "%APPDATA%\quan-ly-ban-hang-desktop\gdrive-token.json" "electron\gdrive-token.json" >nul 2>&1
        echo    [OK] Auto-copy gdrive-token.json tu AppData vao electron/
    ) else (
        echo    [!] CANH BAO: Khong co gdrive-token.json - Google Drive upload se THAT BAI tren production!
        echo        Chay reauth-gdrive.bat truoc khi build.
    )
)
rmdir /S /Q "release4\win-unpacked\resources\app\electron" 2>nul
xcopy "electron\*" "release4\win-unpacked\resources\app\electron\" /E /I /Y /Q >nul 2>&1

echo    Copy Prisma Client...
rmdir /S /Q "release4\win-unpacked\resources\app\node_modules\@prisma" 2>nul
rmdir /S /Q "release4\win-unpacked\resources\app\node_modules\.prisma" 2>nul
xcopy "node_modules\@prisma\*" "release4\win-unpacked\resources\app\node_modules\@prisma\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\.prisma\*" "release4\win-unpacked\resources\app\node_modules\.prisma\" /E /I /Y /Q >nul 2>&1

copy /Y "package.json" "release4\win-unpacked\resources\app\package.json" >nul 2>&1
echo [OK] Local release folder synced.

:skip_copy_local
echo.

echo [5/7] Build Python Face Service EXE...
echo ----------------------------------------
call "python\build_face_service.bat"
if errorlevel 1 (
    echo.
    echo [ERROR] Python face service EXE build failed. Stop patch release.
    pause
    exit /b 1
)
echo [OK] Face service EXE build completed.
echo.

echo [6/7] Create patch zip...
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
mkdir "!PATCH_TEMP!\resources\app\node_modules\@prisma"
mkdir "!PATCH_TEMP!\resources\app\node_modules\.prisma"
mkdir "!PATCH_TEMP!\resources\app\node_modules\@supabase"
mkdir "!PATCH_TEMP!\resources\app\node_modules\iceberg-js"
mkdir "!PATCH_TEMP!\resources\app\node_modules\tslib"

xcopy "dist\*" "!PATCH_TEMP!\resources\app\dist\" /E /I /Y /Q >nul 2>&1
xcopy "electron\*" "!PATCH_TEMP!\resources\app\electron\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\@prisma\*" "!PATCH_TEMP!\resources\app\node_modules\@prisma\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\.prisma\*" "!PATCH_TEMP!\resources\app\node_modules\.prisma\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\@supabase\*" "!PATCH_TEMP!\resources\app\node_modules\@supabase\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\iceberg-js\*" "!PATCH_TEMP!\resources\app\node_modules\iceberg-js\" /E /I /Y /Q >nul 2>&1
xcopy "node_modules\tslib\*" "!PATCH_TEMP!\resources\app\node_modules\tslib\" /E /I /Y /Q >nul 2>&1
copy /Y "python\attendance_service.py" "!PATCH_TEMP!\resources\app\python\" >nul 2>&1
copy /Y "python\requirements.txt" "!PATCH_TEMP!\resources\app\python\" >nul 2>&1

if exist "python\dist\attendance_service.exe" (
    mkdir "!PATCH_TEMP!\resources\app\python\dist" >nul 2>&1
    copy /Y "python\dist\attendance_service.exe" "!PATCH_TEMP!\resources\app\python\dist\" >nul 2>&1
    echo    [OK] Included attendance_service.exe
) else (
    echo    [ERROR] attendance_service.exe missing after successful build.
    rmdir /S /Q "!PATCH_TEMP!" 2>nul
    pause
    exit /b 1
)

copy /Y "package.json" "!PATCH_TEMP!\resources\app\package.json" >nul 2>&1

powershell -NoProfile -Command "Compress-Archive -Path '!PATCH_TEMP!\*' -DestinationPath '!PATCH_ZIP_PATH!' -Force"
set ZIP_EXIT=!errorlevel!

rmdir /S /Q "!PATCH_TEMP!" 2>nul

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

echo [7/7] Git and GitHub release...
echo ----------------------------------------
git add -A
git commit -m "v!NEW_VERSION! - !NOTES!"
if errorlevel 1 (
    echo [WARN] Git commit failed or there is nothing new to commit.
) else (
    echo [OK] Git commit completed.
)

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
echo   [BONUS] Dong bo Google Drive...
echo ============================================
if exist "_auto_backup_drive.js" (
    call node _auto_backup_drive.js
    if errorlevel 1 (
        echo [WARN] Google Drive Backup that bai - kiem tra credentials.
    ) else (
        echo [OK] Google Drive Backup thanh cong.
    )
) else (
    echo [WARN] Khong tim thay _auto_backup_drive.js - bo qua backup.
)
echo.

echo ============================================
echo   PATCH RELEASE COMPLETED
echo ============================================
echo Version : v!NEW_VERSION!
echo Patch   : !PATCH_ZIP! (~!FILE_SIZE_MB! MB)
echo.
pause
