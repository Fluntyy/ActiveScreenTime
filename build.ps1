<#
.SYNOPSIS
    Builds the Active Screen Time desktop application and installers for Windows.
#>

[CmdletBinding()]
param (
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Active Screen Time - Release Build Script (PowerShell)" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Error "pnpm is not found in PATH! Please install it with 'npm install -g pnpm'."
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "cargo (Rust) is not found in PATH! Please install Rust from https://rustup.rs/."
}

# 1. Install dependencies
if (-not $SkipInstall) {
    Write-Host "[1/3] Installing dependencies..." -ForegroundColor Green
    pnpm install
} else {
    Write-Host "[1/3] Skipping dependency install (-SkipInstall specified)..." -ForegroundColor Yellow
}

# 2. Build Tauri release
Write-Host ""
Write-Host "[2/3] Building frontend and bundling native installer..." -ForegroundColor Green
pnpm tauri build

# 3. Finished
Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "[3/3] Build completed successfully!" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Installers generated at:" -ForegroundColor Yellow
Get-ChildItem -Path "src-tauri\target\release\bundle" -Recurse -Include *.exe, *.msi | ForEach-Object {
    Write-Host "  - $($_.FullName)" -ForegroundColor White
}
