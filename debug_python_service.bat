@echo off
chcp 65001 > nul
title DEBUG - Python Face Service

echo =============================================
echo  DEBUG: PYTHON FACE ATTENDANCE SERVICE
echo =============================================
echo.

REM ---- 1. Kiểm tra Python ----
echo [1] Tim kiem Python...
where python >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo    [LOI] Khong tim thay 'python' trong PATH!
    echo    Thu 'py'...
    where py >nul 2>&1
    IF %ERRORLEVEL% NEQ 0 (
        echo    [LOI] Khong tim thay 'py' trong PATH!
        echo    Ban can cai Python 3.10 va them vao PATH.
        goto :end
    ) ELSE (
        echo    [OK] Tim thay 'py'
        SET PYTHON_CMD=py
    )
) ELSE (
    echo    [OK] Tim thay 'python'
    SET PYTHON_CMD=python
)

REM ---- 2. Phiên bản Python ----
echo.
echo [2] Phien ban Python:
%PYTHON_CMD% --version

REM ---- 3. Test từng thư viện ----
echo.
echo [3] Kiem tra thu vien...

echo    - face_recognition:
%PYTHON_CMD% -c "import face_recognition; print('       [OK] face_recognition', face_recognition.__version__ if hasattr(face_recognition,'__version__') else 'installed')" 2>&1
IF %ERRORLEVEL% NEQ 0 echo    [LOI] face_recognition CHUA DUOC CAI!

echo    - cv2 (opencv):
%PYTHON_CMD% -c "import cv2; print('       [OK] cv2', cv2.__version__)" 2>&1
IF %ERRORLEVEL% NEQ 0 echo    [LOI] opencv-python CHUA DUOC CAI!

echo    - fastapi:
%PYTHON_CMD% -c "import fastapi; print('       [OK] fastapi', fastapi.__version__)" 2>&1
IF %ERRORLEVEL% NEQ 0 echo    [LOI] fastapi CHUA DUOC CAI!

echo    - uvicorn:
%PYTHON_CMD% -c "import uvicorn; print('       [OK] uvicorn', uvicorn.__version__)" 2>&1
IF %ERRORLEVEL% NEQ 0 echo    [LOI] uvicorn CHUA DUOC CAI!

echo    - numpy:
%PYTHON_CMD% -c "import numpy; print('       [OK] numpy', numpy.__version__)" 2>&1
IF %ERRORLEVEL% NEQ 0 echo    [LOI] numpy CHUA DUOC CAI!

echo    - Pillow:
%PYTHON_CMD% -c "import PIL; print('       [OK] Pillow', PIL.__version__)" 2>&1
IF %ERRORLEVEL% NEQ 0 echo    [LOI] Pillow CHUA DUOC CAI!

REM ---- 4. Thử chạy service trực tiếp ----
echo.
echo [4] Thu chay attendance_service.py truc tiep (bam Ctrl+C de dung)...
echo     Neu thay "[Face] Service ready on port 5001" thi Python OK.
echo     Neu bao loi thi xem thong bao loi bên duoi.
echo.
echo ---- STDOUT / STDERR ----
cd /d "%~dp0"
%PYTHON_CMD% python\attendance_service.py

:end
echo.
echo =============================================
echo  Xong. Bam phim bat ky de dong...
echo =============================================
pause
