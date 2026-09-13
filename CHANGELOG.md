# Changelog

All notable changes to SystemInfo are documented here.

## [Unreleased]

### Added

### Changed

### Fixed

### Known Issues


## [1.0.4] - 2026-09-13

### Added

- `launcher/` — a new self-contained .NET production launcher (`SystemInfo.exe`) that starts the already-built `backend/SystemMonitor.Api.exe` and `analytics/analytics.exe`, waits for readiness, and opens the browser. Replaces the old ps2exe-compiled `start-all.ps1`.
- `analytics/run_analytics.py` — PyInstaller entrypoint for freezing the analytics service into `analytics.exe` (the dev-only `uvicorn analytics_service:app` CLI invocation can't be frozen directly).
- `analytics/requirements.txt` and `analytics/requirements-build.txt`, separating runtime deps from build-only deps (PyInstaller).
- Production staging-directory validation step in `build-windows-installer.yml`: the build now fails loudly if any required file (backend exe, native DLL, wwwroot, analytics exe) is missing, or if any dev/source file (`.py`, `.csproj`, `package.json`, etc.) leaked into the package.

### Changed

- `backend/SystemMonitor.Api/Program.cs` now serves the React production build directly (`UseStaticFiles` + `MapFallbackToFile`) instead of relying on a separately running `npm run dev` server.
- `SystemMonitor.Api.csproj` publishes self-contained for `win-x64`, and copies `frontend/dist` into `wwwroot` at publish time so the backend embeds the frontend.
- `SystemInfo.iss` now packages only the production staging directory (`packaging/app/`) instead of the entire repository, and no longer runs `setup.ps1` as a post-install step.
- `build-windows-installer.yml` rewritten around a real build pipeline: build native engine → build frontend → `dotnet publish` backend self-contained (embeds frontend) → PyInstaller-package analytics → publish launcher → validate staging dir → compile installer.
- `native/CMakeLists.txt` now explicitly links `dxgi` on Windows instead of relying solely on the MSVC-only `#pragma comment(lib, "dxgi.lib")` in `windows_provider.cpp`.
- `setup.ps1` / `start-all.ps1` re-labeled as developer-only tooling (not used by the installer or the packaged app anymore).

### Fixed

- The packaged Windows application no longer requires Node.js, npm, Python, pip, or the .NET SDK on the end user's machine — the installer now ships fully self-contained executables instead of the raw source repository.
- The built frontend (`frontend/dist`) is no longer excluded from the installer — it's now embedded into the backend's `wwwroot` and served automatically.

### Known Issues

- Not yet verified on an actual Windows machine: full CI run of `build-windows-installer.yml`, clean-install/uninstall/update behavior, and end-to-end dashboard/API verification. Native Windows cross-compile (mingw-w64) was verified in isolation and produces a valid DLL with all expected exports, but the C# build itself could not be verified locally (no NuGet network access in the dev sandbox that made this change).
- Code signing not yet set up for either the installer or the binaries.


## [1.0.3] - 2026-09-13

### Added

- Linux packaging: AppImage and .deb builds via a new "Build Linux Installer" GitHub Actions workflow, producing installers alongside the existing Windows one.
- `start-all.sh` now supports a `SYSTEMINFO_LOG_DIR` environment override (defaults to the old behavior when unset) — required so logging works inside an AppImage's read-only runtime filesystem.

### Changed

### Fixed

- Fixed a PowerShell variable/colon parsing error in `start-all.ps1` (`Fail-WithLog`: `"$logfile:"` was being misread as a scope qualifier) that caused the packaged Windows application to crash immediately after a successful install.
- Fixed the AppImage build failing under GitHub Actions due to no working FUSE mount (`appimagetool` now runs with `--appimage-extract-and-run`).
- Fixed the AppImage build failing desktop-file validation (`Categories=System;Monitoring;` used an unregistered value — changed to the registered `System;Monitor;`).

### Known Issues


## [1.0.2] - 2026-09-20

### Purpose

- Windows test release to verify whether the packaged application works correctly on Windows.
- This release is primarily intended for testing the Windows installer and runtime behavior.

### Known Issues

- The installer successfully installs the application.
- After installation, the SystemInfo executable currently fails to start.
- Further investigation is required to determine why the packaged executable does not launch correctly on Windows.


## [1.0.1] - 2026-09-13

### Added

- Initial Windows installer release.
- SystemInfo Windows application.
- Native C++ monitoring engine.
- .NET backend.
- Frontend dashboard.
- Python analytics service.
- Automated Windows installer build.

### Changed

- Added GitHub Actions Windows build pipeline.
- Added automatic Inno Setup installer generation.

### Fixed

- Fixed Windows-specific project configuration.
- Removed leftover unconditional `.so` reference from the `.csproj`.
- Improved CMake Visual Studio generator detection.