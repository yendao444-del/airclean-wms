@echo off
cd /d "%~dp0"
:: Xoa ban copy cu trong Electron resources (neu co) de tranh conflict
if exist "node_modules\electron\dist\resources\app" (
    echo Cleaning stale Electron app cache...
    rmdir /s /q "node_modules\electron\dist\resources\app"
)
echo Starting dev server + Electron...
npm run electron:dev
