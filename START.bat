@echo off
chcp 65001 >nul
cls
echo.
echo ╔════════════════════════════════════════╗
echo ║   🚀 QUAN LY POS - DESKTOP APP        ║
echo ╚════════════════════════════════════════╝
echo.
echo [+] Đang khởi động Electron App...
echo [+] Vite: http://localhost:5173
echo [+] Electron window sẽ tự động mở
echo.
echo ⏳ Vui lòng đợi 5-10 giây...
echo.
echo 💡 Để dừng: Nhấn Ctrl+C hoặc đóng cửa sổ Electron
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.

cd /d "%~dp0"
call npm run electron:dev
