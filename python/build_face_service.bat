@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "VS_DEV_CMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
set "VS_CMAKE_BIN=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin"

if exist "%VS_DEV_CMD%" (
    call "%VS_DEV_CMD%" -arch=x64 -host_arch=x64 >nul
)

if exist "%VS_CMAKE_BIN%\cmake.exe" (
    set "PATH=%VS_CMAKE_BIN%;%PATH%"
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%build_face_service.ps1" %*
exit /b %errorlevel%
