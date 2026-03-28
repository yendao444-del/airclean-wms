@echo off
chcp 65001 >nul
title AIRCLEAN WMS - RESTORE DATABASE

echo =========================================
echo    AIRCLEAN WMS - PHỤC HỒI DATABASE
echo =========================================
echo.

:: Kiểm tra Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo ❌ LỖI: Không tìm thấy Node.js!
    echo    Cài Node.js tại: https://nodejs.org
    pause
    exit /b 1
)

:: Kiểm tra file restore script
if not exist "_restore_db.js" (
    echo ❌ LỖI: Không tìm thấy _restore_db.js!
    echo    Đảm bảo file này nằm cùng thư mục với RESTORE_DATABASE.bat
    pause
    exit /b 1
)

:: Kiểm tra có file backup không
dir /b DB-BACKUP-*.json >nul 2>&1
if errorlevel 1 (
    echo ❌ Không tìm thấy file DB-BACKUP-*.json nào trong thư mục này!
    echo.
    echo    Cần có ít nhất 1 file backup. Copy file DB-BACKUP-...json
    echo    từ Google Drive về thư mục này rồi chạy lại.
    echo.
    pause
    exit /b 1
)

echo    Các file backup tìm thấy:
for %%F in (DB-BACKUP-*.json) do echo       %%F
echo.

:: Cho phép truyền tên file cụ thể vào (tùy chọn)
if not "%1"=="" (
    echo    Sẽ restore từ file: %1
    node _restore_db.js "%1"
) else (
    echo    Sẽ dùng file backup MỚI NHẤT (tự động).
    node _restore_db.js
)

if errorlevel 1 (
    echo.
    echo ❌ Restore THẤT BẠI! Xem lỗi phía trên.
) else (
    echo.
    echo ✅ Restore thành công!
)

echo.
pause
