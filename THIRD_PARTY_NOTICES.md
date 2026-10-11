# Third-party notices

**System Info** is Copyright (c) 2026 Vipul Sharma and is released under the [MIT License](./LICENSE).
That license covers the code written for this project. The components below were written by other people and stay under
their own licenses, which are listed here with their authors and sources. Licenses for direct dependencies were read from
the npm and crates.io registries and the projects' own pages on 2026-10-11; check them again before relying on them for
anything beyond normal use.

## Languages and technologies used in this project

| Language / format | Used for |
|---|---|
| TypeScript, TSX (React 19) | The dashboard UI (`frontend/src`) |
| CSS (Tailwind CSS 4) | Styling |
| C# (.NET 10, ASP.NET Core) | The backend service (`backend/`) |
| C++17 | The native monitoring engine (`native/`) |
| x86-64 Assembly (NASM, SSE2 and AVX2) | Vector and statistics kernels (`assembly/`) |
| Rust (Tauri 2) | The desktop shell, process supervision and updater (`frontend/src-tauri`) |
| JavaScript modules (`.mjs`, Node.js) | Build, version and release scripts (`scripts/`) |
| Bash and PowerShell | Setup and start scripts |
| CMake | Native build |
| YAML | GitHub Actions workflows |
| JSON | Configuration |

## Components shipped inside the installed app

| Component | License | Author / source |
|---|---|---|
| **PawnIO** installer, 2.2.0 (Windows only, unmodified; see below) | GPL-2.0-or-later with an additional exception | namazso, <https://github.com/namazso/PawnIO> |
| **LibreHardwareMonitorLib** 0.9.6 (Windows CPU temperature) | MPL-2.0 | LibreHardwareMonitor contributors, <https://github.com/LibreHardwareMonitor/LibreHardwareMonitor> |
| **.NET runtime and libraries** (self-contained backend) | MIT | Microsoft and the .NET Foundation, <https://github.com/dotnet/runtime> |
| Microsoft.AspNetCore.OpenApi, System.Management, System.Diagnostics.PerformanceCounter 10.0.11 | MIT | Microsoft |
| **Tauri** (`tauri`, `tauri-plugin-updater`, `tauri-plugin-process`, `@tauri-apps/api`, `@tauri-apps/plugin-*`) | Apache-2.0 OR MIT | Tauri Contributors, <https://github.com/tauri-apps/tauri> |
| `serde`, `serde_json` | MIT OR Apache-2.0 | The Rust serde developers |
| **React**, **React DOM** 19 | MIT | Meta Platforms and contributors |
| **lucide-react** (icons) | ISC | Lucide Contributors |
| **sweetalert2** | MIT | Tristan Edwards, Limon Monte and contributors |
| **Tailwind CSS** | MIT | Tailwind Labs |
| **Bricolage Grotesque** font (`@fontsource-variable/bricolage-grotesque`) | SIL Open Font License 1.1 | The Bricolage Grotesque Project Authors; packaged by Fontsource |

Each of these has its own dependencies (transitive packages), which carry their own licenses. The full list for a given
build can be generated with `npm ls --all` and `cargo tree` (add a license tool such as `cargo about`, or `dotnet list package`
for the .NET side).

### PawnIO (Windows CPU sensor driver)

The Windows installer ships the **unmodified, official PawnIO installer** (`PawnIO_setup.exe`, version 2.2.0, signed by its
author) next to the backend, as a separate program. System Info runs it once, silently, with administrator rights, so the
CPU temperature library can read processor sensors. System Info does not link PawnIO's code; it only starts that installer
and talks to the driver through the temperature library.

- Author: namazso · Home: <https://pawnio.eu> · Source: <https://github.com/namazso/PawnIO>
- License: GNU GPL v2 or later, with the author's additional exception for programs that communicate with PawnIO only through
  the device I/O control interface (full text in the project's `COPYING`). PawnIO is **not** covered by this project's MIT
  license; it keeps its own.
- The installer is downloaded from the project's own GitHub release by `scripts/fetch-pawnio.mjs` and is refused unless its
  SHA-256 matches `1F519A22E47187F70A1379A48CA604981C4FCF694F4E65B734AAA74A9FBA3032`.
- The driver stays installed if System Info is uninstalled (other programs may use it). Remove it from Windows
  "Installed apps" (PawnIO) if you do not want it.
- Set the environment variable `SYSTEMINFO_NO_DRIVER_INSTALL=1` to stop System Info installing it automatically.

### LibreHardwareMonitorLib

Used unmodified as a NuGet package. It is under the Mozilla Public License 2.0; its source is available at
<https://github.com/LibreHardwareMonitor/LibreHardwareMonitor>.

## Used only to build the app (not shipped)

| Tool | License |
|---|---|
| Vite 8, `@vitejs/plugin-react`, `@tailwindcss/vite`, oxlint, `@types/node`, `@types/react`, `@types/react-dom` | MIT |
| TypeScript 6 | Apache-2.0 |
| Tauri CLI (`@tauri-apps/cli`), `tauri-build` | Apache-2.0 OR MIT |
| NASM, CMake, the C++ and Rust toolchains, GitHub Actions | Their own licenses; nothing from them is included in the app |

## Used at run time but not distributed with the app

- **NVIDIA NVML** — loaded from the person's own NVIDIA driver when present; NVIDIA's license applies and no NVIDIA file is shipped.
- **Microsoft Edge WebView2 runtime** — downloaded by Microsoft's bootstrapper during install if missing; Microsoft's license applies.
- **Windows and Linux system interfaces** (WMI, PDH, DXGI, `/proc`, `/sys`) — part of the operating system.

## Trademarks

All product names, logos and brands mentioned (NVIDIA, Intel, AMD, Microsoft, Windows, Linux and others) belong to their
owners and are used only to describe the hardware and software System Info reads. No endorsement is implied.
