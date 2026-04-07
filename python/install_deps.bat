@echo off
chcp 65001 >nul
echo ============================================
echo   AIRCLEAN WMS - Cai dat Python dependencies
echo   Cho chuc nang cham cong khuon mat
echo ============================================
echo.

:: Tim Python
where python >nul 2>&1
if errorlevel 1 (
    echo [LOI] Khong tim thay Python! Vui long cai Python 3.10+ truoc.
    echo Download: https://www.python.org/downloads/
    pause
    exit /b 1
)

python --version
echo.

:: Cai dlib truoc (face_recognition phu thuoc vao no)
echo [1/4] Dang cai dlib (co the mat vai phut)...
pip install dlib==19.24.6
if errorlevel 1 (
    echo.
    echo [CANH BAO] dlib cai tu source that bai!
    echo Thu cai bang pre-built wheel...
    pip install dlib
    if errorlevel 1 (
        echo.
        echo [LOI] Khong the cai dlib!
        echo Ban can cai Visual Studio Build Tools truoc:
        echo https://visualstudio.microsoft.com/visual-cpp-build-tools/
        echo Chon "Desktop development with C++"
        pause
        exit /b 1
    )
)
echo [OK] dlib da cai xong!
echo.

:: Cai face_recognition (luc nay dlib da co san)
echo [2/4] Dang cai face_recognition...
pip install face_recognition==1.3.0
echo.

:: Cai cac thu vien con lai
echo [3/4] Dang cai opencv, fastapi, uvicorn...
pip install opencv-python==4.9.0.80 fastapi==0.111.0 uvicorn==0.29.0 Pillow==10.3.0 numpy==1.26.4
echo.

:: Kiem tra
echo [4/4] Kiem tra thu vien...
python -c "import dlib; import face_recognition; import fastapi; import uvicorn; import cv2; print('OK - Tat ca thu vien da cai thanh cong!')"
if errorlevel 1 (
    echo.
    echo [LOI] Mot so thu vien chua cai dung!
    echo Chay lai script hoac cai thu cong.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   HOAN TAT! Tat ca dependencies da san sang.
echo   Khoi dong lai app DBY POS de su dung.
echo ============================================
pause
