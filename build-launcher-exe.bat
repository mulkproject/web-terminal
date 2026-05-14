@echo off
REM =============================================================================
REM   Web Terminal — Build Launcher Executable
REM   Converts launcher.py -> Web-Terminal-Launcher.exe with icon.ico
REM =============================================================================
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║   Web Terminal — Launcher EXE Builder                   ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

:: ---- Check Python (try portable embed first, then system) ----
set PYTHON_EXE=
if exist "python-embed\python.exe" (
    set "PYTHON_EXE=python-embed\python.exe"
    echo [1/4] Using portable Python: python-embed\python.exe
) else (
    python --version >nul 2>&1
    if errorlevel 1 (
        echo ❌ Python not found. Install system Python or use the portable embed.
        pause & exit /b 1
    )
    set "PYTHON_EXE=python"
    echo [1/4] Using system Python
)

:: ---- Ensure PyInstaller is available ----
echo [2/4] Checking PyInstaller...
%PYTHON_EXE% -c "import PyInstaller" 2>nul
if errorlevel 1 (
    echo  ↳ PyInstaller not found. Installing...
    %PYTHON_EXE% -m pip install pyinstaller --quiet
    if errorlevel 1 (
        echo ❌ Failed to install PyInstaller.
        pause & exit /b 1
    )
    echo  ↳ PyInstaller installed.
) else (
    echo  ↳ PyInstaller already present.
)

:: ---- Verify icon exists ----
if not exist "icon.ico" (
    echo ❌ icon.ico not found in current directory: %cd%
    pause & exit /b 1
)
echo  ↳ icon.ico found.

:: ---- Build the executable ----
echo [3/4] Building EXE (this may take a minute)...

%PYTHON_EXE% -m PyInstaller ^
    --onefile ^
    --windowed ^
    --name "Web-Terminal-Launcher" ^
    --icon="icon.ico" ^
    --add-data "icon.ico;." ^
    --hidden-import queue ^
    --hidden-import tkinter ^
    --clean ^
    --noconfirm ^
    launcher.py

if errorlevel 1 (
    echo ❌ PyInstaller build failed.
    pause & exit /b 1
)

echo [4/4] Copying output...
if exist "dist\Web-Terminal-Launcher.exe" (
    copy /Y "dist\Web-Terminal-Launcher.exe" "Web-Terminal-Launcher.exe" >nul
    echo.
    echo  ╔══════════════════════════════════════════════════════════╗
    echo  ║   ✅  Build successful!                                ║
    echo  ║       Output: Web-Terminal-Launcher.exe                ║
    echo  ╚══════════════════════════════════════════════════════════╝
    echo.
) else (
    echo ❌ Output EXE not found.
    pause & exit /b 1
)

:: ---- Cleanup build artifacts ----
echo  Clean up build artifacts? (build/ dist/ .spec)
choice /c YN /n /m "  Remove them [Y/N]? "
if errorlevel 2 goto :skip_clean
if errorlevel 1 (
    rmdir /s /q build 2>nul
    rmdir /s /q dist 2>nul
    del /q "Web-Terminal-Launcher.spec" 2>nul
    echo  ↳ Cleaned.
)
:skip_clean

echo  Done.
endlocal
pause
