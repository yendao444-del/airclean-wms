@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

for /f "tokens=*" %%t in ('gh auth token 2^>nul') do set GH_TOKEN=%%t

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
    echo [1/6] Update package.json...
    node scripts\release-version.cjs set !NEW_VERSION! >nul
    if errorlevel 1 (
        echo [ERROR] package.json update failed.
        pause
        exit /b 1
    )
    echo [OK] package.json updated to v!NEW_VERSION!
    echo.
)

echo [2/6] Build Vite...
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

echo [3/6] Copy code into local release folder for quick verification...
echo ----------------------------------------
if not exist "release4\win-unpacked\resources\app" (
    echo [WARN] release4\win-unpacked\resources\app not found. Skip local release sync.
    goto :skip_copy_local
)

echo    Copy dist\ ...
rmdir /S /Q "release4\win-unpacked\resources\app\dist" 2>nul
xcopy "dist\*" "release4\win-unpacked\resources\app\dist\" /E /I /Y /Q >nul 2>&1

echo    Copy electron\ ...
rmdir /S /Q "release4\win-unpacked\resources\app\electron" 2>nul
xcopy "electron\*" "release4\win-unpacked\resources\app\electron\" /E /I /Y /Q >nul 2>&1

copy /Y "package.json" "release4\win-unpacked\resources\app\package.json" >nul 2>&1
echo [OK] Local release folder synced.

:skip_copy_local
echo.

echo [4/6] Build Python Face Service EXE...
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

echo [5/6] Create patch zip...
echo ----------------------------------------
set PATCH_ZIP=DBYPOS-PATCH-v!NEW_VERSION!.zip

if exist "!PATCH_ZIP!" (
    del "!PATCH_ZIP!"
)

if exist "_patch_temp" rmdir /S /Q "_patch_temp"
mkdir "_patch_temp\resources\app\dist"
mkdir "_patch_temp\resources\app\electron"
mkdir "_patch_temp\resources\app\python"

xcopy "dist\*" "_patch_temp\resources\app\dist\" /E /I /Y /Q >nul 2>&1
xcopy "electron\*" "_patch_temp\resources\app\electron\" /E /I /Y /Q >nul 2>&1
copy /Y "python\attendance_service.py" "_patch_temp\resources\app\python\" >nul 2>&1
copy /Y "python\requirements.txt" "_patch_temp\resources\app\python\" >nul 2>&1

if exist "python\dist\attendance_service.exe" (
    mkdir "_patch_temp\resources\app\python\dist" >nul 2>&1
    copy /Y "python\dist\attendance_service.exe" "_patch_temp\resources\app\python\dist\" >nul 2>&1
    echo    [OK] Included attendance_service.exe
) else (
    echo    [ERROR] attendance_service.exe missing after successful build.
    rmdir /S /Q "_patch_temp" 2>nul
    pause
    exit /b 1
)

copy /Y "package.json" "_patch_temp\resources\app\package.json" >nul 2>&1

pushd "_patch_temp"
powershell -Command "Compress-Archive -Path '*' -DestinationPath '..\!PATCH_ZIP!' -Force"
set ZIP_EXIT=!errorlevel!
popd

rmdir /S /Q "_patch_temp" 2>nul

if !ZIP_EXIT! neq 0 (
    echo [ERROR] Patch zip creation failed.
    pause
    exit /b 1
)

if not exist "!PATCH_ZIP!" (
    echo [ERROR] Patch zip not found after compression.
    pause
    exit /b 1
)

for %%F in ("!PATCH_ZIP!") do (
    set FILE_SIZE=%%~zF
    set /a FILE_SIZE_MB=!FILE_SIZE! / 1048576
)
echo [OK] Created !PATCH_ZIP! (~!FILE_SIZE_MB! MB)
echo.

echo [6/6] Git and GitHub release...
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

set CURRENT_DIR=%CD%
gh release create v!NEW_VERSION! "%CURRENT_DIR%\!PATCH_ZIP!" --title "DBY POS v!NEW_VERSION! (PATCH)" --notes "!NOTES!" > _gh_out.txt 2>&1
set GH_EXIT=!errorlevel!
type _gh_out.txt
del _gh_out.txt >nul 2>&1
if !GH_EXIT! neq 0 (
    echo [ERROR] GitHub release creation failed.
    pause
    exit /b 1
)
echo [OK] GitHub release created.
echo.

echo ============================================
echo   PATCH RELEASE COMPLETED
echo ============================================
echo Version : v!NEW_VERSION!
echo Patch   : !PATCH_ZIP! (~!FILE_SIZE_MB! MB)
echo.
exit /b 0
