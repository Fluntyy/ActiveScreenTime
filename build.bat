@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo   Active Screen Time - Release Build Script
echo ========================================================
echo.

:: 1. Check prerequisites
where pnpm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] pnpm is not found in PATH!
    echo Please install pnpm via: npm install -g pnpm
    pause
    exit /b 1
)

where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] cargo (Rust) is not found in PATH!
    echo Please install Rust via: https://rustup.rs/
    pause
    exit /b 1
)

:: 2. Install frontend dependencies
echo [1/3] Installing dependencies...
call pnpm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies!
    pause
    exit /b %errorlevel%
)

:: 3. Build frontend and bundle Tauri application
echo.
echo [2/3] Building frontend and bundling native installer...
call pnpm tauri build
if %errorlevel% neq 0 (
    echo [ERROR] Tauri build failed!
    pause
    exit /b %errorlevel%
)

:: 4. Done
echo.
echo ========================================================
echo [3/3] Build completed successfully!
echo ========================================================
echo.
echo Output installers can be found at:
echo   src-tauri\target\release\bundle\nsis\
echo   src-tauri\target\release\bundle\msi\
echo.
pause
