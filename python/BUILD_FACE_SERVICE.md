Face service EXE build

Goal
- Build `python/dist/attendance_service.exe` from a dedicated build environment.
- Fail the release immediately if the EXE is missing or crashes during smoke test.

Required build Python
- Python `3.11.x`, or
- Python `3.10.11+`

Required native toolchain on the build machine
- `cmake` available in `PATH`
- `cl.exe` available in `PATH`
- In practice this means installing:
  - CMake
  - Visual Studio C++ Build Tools

Current repo rule
- Python `3.10.0` is rejected on purpose because PyInstaller proved unstable on this project.

Pinned build dependencies
- See `python/requirements-build.txt`
- Versions are pinned with `==`

Default build command
```bat
python\build_face_service.bat
```

Direct PowerShell command
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "python\build_face_service.ps1"
```

Optional custom interpreter
```powershell
$env:FACE_BUILD_PYTHON="C:\Users\YourUser\AppData\Local\Programs\Python\Python311\python.exe"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "python\build_face_service.ps1"
```

Optional local machine config
- Create `python/.face-build-python.txt`
- Put exactly one line with the absolute path to the approved build interpreter
- Example:
```text
C:\Users\BuildMachine\AppData\Local\Programs\Python\Python311\python.exe
```
- This file is ignored by git and is intended for the build machine only
- A starter template exists at `python/.face-build-python.example.txt`

What the script does
1. Resolve build Python from `FACE_BUILD_PYTHON` or known candidate paths.
2. Reject unsupported versions.
3. Fail fast if `cmake` or `cl.exe` is missing.
4. Recreate `python/.build-venv`.
5. Install `requirements-build.txt`.
6. Delete old `python/build` and old `python/dist/attendance_service.exe`.
7. Run PyInstaller with `attendance_service.spec`.
8. Verify the EXE exists and size > 0.
9. Smoke-test the EXE for a few seconds.

Release behavior
- `RELEASE.bat` and `RELEASE-ver2.bat` now call `python/build_face_service.ps1`.
- For convenience they call `python\build_face_service.bat`, which wraps the PowerShell script.
- If build or verify fails, release stops immediately.
- No ZIP should be created from a stale or broken EXE.
