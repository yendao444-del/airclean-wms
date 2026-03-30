@echo off
echo ========================================
echo  ZKBridge Build Script
echo ========================================

REM Tìm csc.exe (.NET Framework compiler)
set CSC=""
for %%f in (
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
) do (
    if exist %%f set CSC=%%f
)

if %CSC%=="" (
    echo [ERROR] Không tìm thấy .NET Framework 4.x
    echo Tải tại: https://dotnet.microsoft.com/download/dotnet-framework
    pause
    exit /b 1
)

echo [INFO] Dùng compiler: %CSC%
echo [INFO] Đang build ZKBridge.cs...

%CSC% /target:exe /out:ZKBridge.exe /platform:x86 ZKBridge.cs

if %ERRORLEVEL%==0 (
    echo.
    echo [OK] Build thành công: ZKBridge.exe
    echo.
    echo Bước tiếp theo:
    echo 1. Tìm zkemkeeper.dll trong thư mục MitaPro
    echo    VD: C:\Program Files ^(x86^)\MitaPro\zkemkeeper.dll
    echo 2. Đăng ký DLL: regsvr32 "đường dẫn\zkemkeeper.dll"
    echo 3. Test thử: ZKBridge.exe 192.168.0.225 4370
) else (
    echo [ERROR] Build thất bại!
)

pause
