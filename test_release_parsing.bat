@echo off
setlocal enabledelayedexpansion
for /f "tokens=2 delims=:, " %%a in ('findstr /C:"\"version\"" package.json') do (
    set CURRENT_VERSION=%%a
)
echo raw CURRENT_VERSION=!CURRENT_VERSION!
set CURRENT_VERSION=!CURRENT_VERSION:"=!
echo processed CURRENT_VERSION=!CURRENT_VERSION!
for /f "tokens=1,2,3 delims=." %%a in ("!CURRENT_VERSION!") do (
    set MAJOR=%%a
    set MINOR=%%b
    set PATCH=%%c
)
set /a PATCH=!PATCH!+1
set NEW_VERSION=!MAJOR!.!MINOR!.!PATCH!
echo NEW_VERSION=!NEW_VERSION!
