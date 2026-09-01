@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo   DBY POS - Build Windows Installer
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found in PATH.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm was not found in PATH.
    pause
    exit /b 1
)

for /f %%v in ('node scripts\release-version.cjs current') do set APP_VERSION=%%v
if not defined APP_VERSION (
    echo [ERROR] Cannot read the current version from package.json.
    pause
    exit /b 1
)

echo Version: v%APP_VERSION%
echo.

echo [1/5] Stopping DBY POS and development watchers...
powershell -NoProfile -Command "$root=(Resolve-Path '.').Path; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like ('*'+$root+'*') -and $_.CommandLine -match 'nodemon.+nodemon\.electron\.json' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM "DBY POS.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/5] Preparing production configuration and Prisma Client...
call npm run embed:wms-token
if errorlevel 1 goto build_failed
call npm run embed:google-oauth
if errorlevel 1 goto build_failed
call npm run prepare:r2-daily-evidence
if errorlevel 1 goto build_failed
call npm run prepare:runtime-db
if errorlevel 1 goto build_failed
call npx prisma generate
if errorlevel 1 goto build_failed

echo [3/5] Building the desktop application...
call npm run build
if errorlevel 1 goto build_failed

echo [4/5] Building the standalone face attendance service...
call python\build_face_service.bat
if errorlevel 1 goto build_failed
if not exist "python\dist\attendance_service.exe" (
    echo [ERROR] python\dist\attendance_service.exe was not created.
    goto build_failed
)

echo [5/5] Packaging the NSIS setup wizard...
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npx electron-builder --win nsis --config.directories.output=release-installer
if errorlevel 1 goto build_failed

set INSTALLER=release-installer\DBYPOS-v%APP_VERSION%-setup.exe
if not exist "%INSTALLER%" (
    echo [ERROR] Installer was not found: %INSTALLER%
    goto build_failed
)

powershell -NoProfile -Command "$file='%INSTALLER%'; $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLower(); Set-Content -NoNewline -LiteralPath ($file + '.sha256') -Value ($hash + '  ' + [IO.Path]::GetFileName($file))"
if errorlevel 1 goto build_failed

echo.
echo ============================================
echo   INSTALLER READY
echo ============================================
echo File: %INSTALLER%
echo.
pause
exit /b 0

:build_failed
echo.
echo [ERROR] Installer build failed. Review the error above.
pause
exit /b 1
