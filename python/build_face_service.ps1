param(
    [string]$PythonExe = "",
    [string]$VenvDir = ".build-venv"
)

$ErrorActionPreference = "Stop"

function Resolve-BuildPython {
    param(
        [string]$PreferredPythonExe,
        [string]$ConfigPath
    )

    if ($PreferredPythonExe -and $PreferredPythonExe.Trim()) {
        if (-not (Test-Path $PreferredPythonExe)) {
            throw "FACE_BUILD_PYTHON does not exist: $PreferredPythonExe"
        }
        return (Resolve-Path $PreferredPythonExe).Path
    }

    if (Test-Path $ConfigPath) {
        $configPython = (Get-Content $ConfigPath -TotalCount 1).Trim()
        if ($configPython) {
            if (-not (Test-Path $configPython)) {
                throw "Configured build Python does not exist: $configPython"
            }
            return (Resolve-Path $configPython).Path
        }
    }

    $candidates = @(
        "C:\Users\$env:USERNAME\AppData\Local\Programs\Python\Python311\python.exe",
        "C:\Program Files\Python311\python.exe",
        "C:\Users\$env:USERNAME\AppData\Local\Programs\Python\Python310\python.exe",
        "C:\Program Files\Python310\python.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return (Resolve-Path $candidate).Path
        }
    }

    throw "No supported build Python found. Install Python 3.11.x or 3.10.11+ and set FACE_BUILD_PYTHON if needed."
}

function Assert-BuildPythonVersion {
    param([string]$ResolvedPythonExe)

    $versionText = & $ResolvedPythonExe -c 'import sys; print(sys.version_info[0], sys.version_info[1], sys.version_info[2], sep=chr(46))'
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to read build Python version: $ResolvedPythonExe"
    }

    $version = [Version]$versionText.Trim()
    $isSupported310 = ($version.Major -eq 3 -and $version.Minor -eq 10 -and $version.Build -ge 11)
    $isSupported311 = ($version.Major -eq 3 -and $version.Minor -eq 11)

    if (-not ($isSupported310 -or $isSupported311)) {
        throw "Unsupported build Python version $version. Require Python 3.11.x or 3.10.11+."
    }

    return $version
}

function Test-CommandExists {
    param([string]$CommandName)

    $null -ne (Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Assert-NativeBuildToolchain {
    if (-not (Test-CommandExists -CommandName "cmake")) {
        throw "Missing native build dependency: cmake. Install CMake and add it to PATH."
    }

    if (-not (Test-CommandExists -CommandName "cl")) {
        throw "Missing native build dependency: cl.exe. Install Visual Studio C++ Build Tools and open a shell with MSVC in PATH."
    }
}

function Assert-ExeArtifact {
    param(
        [string]$ExePath,
        [string]$ServiceDataDir
    )

    if (-not (Test-Path $ExePath)) {
        throw "EXE not found after build: $ExePath"
    }

    $exeItem = Get-Item $ExePath
    if ($exeItem.Length -le 0) {
        throw "EXE was created with size 0: $ExePath"
    }

    $stdoutLog = Join-Path $env:TEMP "attendance_service_build_stdout.log"
    $stderrLog = Join-Path $env:TEMP "attendance_service_build_stderr.log"
    Remove-Item $stdoutLog, $stderrLog -ErrorAction SilentlyContinue

    $oldFaceDataDir = $env:FACE_DATA_DIR
    $oldPythonIoEncoding = $env:PYTHONIOENCODING
    $env:FACE_DATA_DIR = $ServiceDataDir
    $env:PYTHONIOENCODING = "utf-8"

    $proc = $null
    try {
        $proc = Start-Process -FilePath $ExePath `
            -WorkingDirectory (Split-Path $ExePath -Parent) `
            -RedirectStandardOutput $stdoutLog `
            -RedirectStandardError $stderrLog `
            -PassThru `
            -WindowStyle Hidden

        Start-Sleep -Seconds 4
        if ($proc.HasExited) {
            $stderr = if (Test-Path $stderrLog) { (Get-Content $stderrLog -Raw) } else { "" }
            throw "EXE crashed during smoke test. ExitCode=$($proc.ExitCode). STDERR: $stderr"
        }
    }
    finally {
        if ($proc -and -not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
        $env:FACE_DATA_DIR = $oldFaceDataDir
        $env:PYTHONIOENCODING = $oldPythonIoEncoding
    }
}

function Stop-ExistingFaceServiceProcess {
    param([string]$ExePath)

    $normalizedExePath = [System.IO.Path]::GetFullPath($ExePath)
    $running = Get-Process -Name "attendance_service" -ErrorAction SilentlyContinue | Where-Object {
        try {
            $_.Path -and ([System.IO.Path]::GetFullPath($_.Path) -eq $normalizedExePath)
        }
        catch {
            $false
        }
    }

    foreach ($proc in $running) {
        Write-Host ("Stopping running face service before rebuild: PID {0}" -f $proc.Id) -ForegroundColor Yellow
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }

    if ($running) {
        Start-Sleep -Seconds 1
    }
}

$preferredPython = $PythonExe
if (-not $preferredPython) {
    $preferredPython = $env:FACE_BUILD_PYTHON
}

$configPath = Join-Path $PSScriptRoot ".face-build-python.txt"
$resolvedPython = Resolve-BuildPython -PreferredPythonExe $preferredPython -ConfigPath $configPath
$pythonVersion = Assert-BuildPythonVersion -ResolvedPythonExe $resolvedPython
Assert-NativeBuildToolchain
$venvPath = Join-Path $PSScriptRoot $VenvDir
$venvPython = Join-Path $venvPath "Scripts\python.exe"
$requirementsPath = Join-Path $PSScriptRoot "requirements-build.txt"
$specPath = Join-Path $PSScriptRoot "attendance_service.spec"
$distExePath = Join-Path $PSScriptRoot "dist\attendance_service.exe"
$serviceDataDir = Join-Path $env:TEMP "attendance-build-smoke"

Write-Host "== Face Service Build ==" -ForegroundColor Cyan
Write-Host "Build Python :" $resolvedPython
Write-Host "Version      :" $pythonVersion
Write-Host "Venv         :" $venvPath

if (Test-Path $venvPath) {
    Remove-Item $venvPath -Recurse -Force
}

& $resolvedPython -m venv $venvPath
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create build venv."
}

& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
    throw "Failed to upgrade pip in build venv."
}

& $venvPython -m pip install -r $requirementsPath
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install requirements-build.txt."
}

$buildDir = Join-Path $PSScriptRoot "build"
if (Test-Path $buildDir) {
    Remove-Item $buildDir -Recurse -Force
}
Stop-ExistingFaceServiceProcess -ExePath $distExePath
if (Test-Path $distExePath) {
    Remove-Item $distExePath -Force
}

Push-Location $PSScriptRoot
try {
    & $venvPython -m PyInstaller $specPath --noconfirm --clean
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller build failed."
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path $serviceDataDir)) {
    New-Item -ItemType Directory -Path $serviceDataDir | Out-Null
}

Assert-ExeArtifact -ExePath $distExePath -ServiceDataDir $serviceDataDir

$exeItem = Get-Item $distExePath
Write-Host ("EXE OK       : {0} ({1:N0} bytes)" -f $exeItem.FullName, $exeItem.Length) -ForegroundColor Green
