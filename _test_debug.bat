@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
set NEW_VERSION=TEST-999
echo === TEST STARTS ===
echo DEBUG A
gh release view v1.0.140 >/dev/null 2>&1
echo DEBUG B
echo PATCH RELEASE HOAN TAT
echo DEBUG C
echo https://github.com/test
echo DEBUG D - DONE
pause
