@echo off
chcp 65001 >nul
echo ============================================
echo   🔍 QUICK DEBUG - Kiểm tra dữ liệu
echo ============================================
echo.

echo Đang mở app với DevTools...
echo.
echo 💡 Sau khi app mở:
echo    1. Console sẽ tự động hiện ra
echo    2. Vào trang "Nhập hàng"
echo    3. Kiểm tra log:
echo       - "🏢 Loaded suppliers: X items"
echo       - "📦 Loaded products: X items"
echo.
echo 📸 Chụp màn hình Console gửi tôi nhé!
echo.

cd /d "%~dp0"
npm run dev

pause
