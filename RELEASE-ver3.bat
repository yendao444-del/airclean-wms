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
echo   DBY POS - QUICK PATCH Release
echo   Chi update code (KHONG build lai EXE)
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

echo [1/4] Update package.json...
node scripts\release-version.cjs set !NEW_VERSION! >nul
if errorlevel 1 (
    echo [ERROR] package.json update failed.
    pause
    exit /b 1
)
echo [OK] package.json updated to v!NEW_VERSION!
echo.

echo [2/4] Build Vite...
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

if exist "%APPDATA%\quan-ly-ban-hang-desktop\gdrive-token.json" (
    copy /Y "%APPDATA%\quan-ly-ban-hang-desktop\gdrive-token.json" "electron\gdrive-token.json" >nul 2>&1
    echo    [OK] Auto-copy gdrive-token.json moi nhat tu AppData vao electron/
) else (
    if not exist "electron\gdrive-token.json" (
        echo    [!] CANH BAO: Khong co gdrive-token.json - Google Drive upload se THAT BAI tren production!
        echo        Chay reauth-gdrive.bat truoc khi build.
    )
)
xcopy "dist\*" "!PATCH_TEMP!\resources\app\dist\" /E /I /Y /Q >nul 2>&1
xcopy "electron\*" "!PATCH_TEMP!\resources\app\electron\" /E /I /Y /Q >nul 2>&1
copy /Y "python\attendance_service.py" "!PATCH_TEMP!\resources\app\python\" >nul 2>&1
copy /Y "python\requirements.txt" "!PATCH_TEMP!\resources\app\python\" >nul 2>&1
copy /Y "package.json" "!PATCH_TEMP!\resources\app\package.json" >nul 2>&1
echo    [OK] Khong kem EXE ^(dung RELEASE-ver2.bat neu can cap nhat Python service^)

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
echo.

echo [4/4] Git and GitHub release...
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
gh release create v!NEW_VERSION! "!PATCH_ZIP_PATH!" --title "DBY POS v!NEW_VERSION! (PATCH)" --notes "!NOTES!"
set GH_EXIT=!errorlevel!
if !GH_EXIT! neq 0 (
    echo [ERROR] GitHub release creation failed.
    pause
    exit /b 1
)
echo [OK] GitHub release created.

:: Xóa zip sau khi upload thành công
if exist "!PATCH_ZIP_PATH!" del /Q "!PATCH_ZIP_PATH!" && echo [OK] Da xoa zip sau khi upload.
echo.

echo ============================================
echo   QUICK PATCH COMPLETED
echo ============================================
echo Version : v!NEW_VERSION!
echo Patch   : !PATCH_ZIP! (~!FILE_SIZE_MB! MB)
echo.
pause
