# Active Screen Time

<div align="center">

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-2021-DEA584?logo=rust&logoColor=black)
![Windows](https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011-0078D6?logo=windows&logoColor=white)

A native, ultra-lightweight, privacy-first screen time and productivity tracker for Windows.

</div>

---

## Features

- **Ultra Lightweight and Native Performance**  
  Built with **Rust** and **Tauri v2**. Consumes minimal CPU and memory overhead compared to traditional Electron apps.

- **Intelligent Activity Tracking**  
  - Win32 foreground window and idle time detection.
  - Media-aware tracking: respects active media playback (WinRT Media Control) and fullscreen apps based on your preferences.
  - Configurable regex ignore rules and custom JavaScript rule evaluation (via embedded Boa JS engine).

- **Break Reminders and Screen Time Goals**  
  - Timely break prompts with system-modal alerts (`MB_SYSTEMMODAL`) designed to stay visible even during fullscreen games or media playback.
  - Daily screen time targets with custom limits and instant popup notifications when reached.

- **Detailed Analytics and History**  
  - Per-day usage graphs, application breakdown, and app icon extraction.
  - Weekly and monthly summaries.
  - One-click CSV export and local backup.

- **Privacy-First and 100% Offline**  
  All metrics and timestamps are stored exclusively in your local SQLite database (`%AppData%/ActiveScreenTime/`). No telemetry, no cloud servers, and no tracking.

---

## Tech Stack

- **Desktop Framework**: [Tauri v2](https://v2.tauri.app/)
- **Backend**: Rust (`windows-rs`, `rusqlite`, `winreg`, `boa_engine`)
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS
- **UI Components**: Material Web 3 (`@material/web`), Material Color Utilities
- **Visuals & Charts**: Framer Motion, Recharts, NumberFlow, Lucide Icons

---

## Prerequisites

Before building or running the project, make sure you have installed:

1. **Node.js** (v18 or higher): [nodejs.org](https://nodejs.org/)
2. **pnpm** (recommended package manager):
   ```powershell
   npm install -g pnpm
   ```
3. **Rust & Cargo**: [rustup.rs](https://rustup.rs/)  
   Ensure the `x86_64-pc-windows-msvc` toolchain is installed.
4. **C++ Build Tools**: Microsoft C++ Build Tools (included in Visual Studio 2022 / Community with the *"Desktop development with C++"* workload).

---

## Getting Started

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/active-screen-time.git
cd active-screen-time
```

### 2. Install Frontend Dependencies
```powershell
pnpm install
```

### 3. Run in Development Mode
Start the live development environment (hot-reloads both frontend and backend):
```powershell
pnpm tauri:dev
```

---

## Building for Production

### Option A: Using the Automated Build Script
Run the automated script in the project root:

- **Command Prompt / Windows Explorer**: Double-click `build.bat`
- **PowerShell**:
  ```powershell
  .\build.ps1
  ```

### Option B: Using pnpm / Tauri CLI
```powershell
pnpm tauri:build
```

### Output Binaries
Upon build completion, your production-ready installers will be generated under:
- **NSIS Setup Installer**: `src-tauri/target/release/bundle/nsis/`
- **MSI Installer**: `src-tauri/target/release/bundle/msi/`
- **Standalone Executable**: `src-tauri/target/release/activescreentime_tauri.exe`

---

## Configuration & Storage

| Resource | Path |
| :--- | :--- |
| **Local Database** | `%LocalAppData%\Flunty\ActiveScreenTime\data.db` |
| **Settings Storage** | SQLite `settings` table |

---

## License

This project is open-source and licensed under the [MIT License](LICENSE).

---

## Warning

yes, this was vibe-coded, but with pure heart lmaoo