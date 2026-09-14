# Changelog

All notable changes to SystemInfo are documented here.

## [Unreleased]

### Added

### Changed

### Fixed

### Known Issues



## [1.0.4.2] - 2026-09-14

### Added

* Added proper Windows battery monitoring using the Win32 `GetSystemPowerStatus()` API for reliable battery percentage, AC power state, charging, discharging, and fully-charged status detection.
* Added detailed Windows battery information through the Windows battery class driver using `IOCTL_BATTERY_QUERY_INFORMATION` and `IOCTL_BATTERY_QUERY_STATUS` where supported.
* Added Windows battery capacity, health, voltage, power usage, and cycle-count reporting when the installed battery and Windows driver expose the required information.
* Added support for aggregating battery capacity information when multiple battery devices are detected.

### Changed

* Updated `WindowsSystemInfoProvider.GetBattery()` to use real Windows battery and power-state information instead of the previous Windows battery placeholder/stub.
* Windows battery values reported by the battery class driver are handled using `mWh` capacity units, while Linux battery reporting continues using its existing `mAh` unit.
* Battery status detection now distinguishes between `Charging`, `Discharging`, `Fully Charged`, `Not Charging`, and `Unknown` states.
* Windows battery reporting now gracefully falls back to the basic Windows power API when detailed battery-driver information is unavailable.
* Battery cycle count is treated as a per-battery value and is no longer incorrectly aggregated across multiple batteries.
* Battery health is calculated from designed capacity versus full-charge capacity when both values are available.
* Cleaned up duplicate Windows system-provider and system-information model/interface definitions that caused .NET compilation conflicts during the hotfix build.

### Fixed

* Fixed Windows battery reporting always returning the previous `"Battery reporting not yet implemented on Windows"` placeholder.
* Fixed Windows battery percentage and charging status not being reported from the actual Windows power subsystem.
* Fixed Windows battery monitoring failing to compile because of duplicate `WindowsSystemInfoProvider` definitions.
* Fixed duplicate `ISystemInfoProvider`, `BatteryInfo`, `RamInfo`, `CpuInfo`, `ProcessInfo`, `DiskInfo`, and `NetworkInfo` definitions causing `CS0101`, `CS0111`, `CS0229`, `CS0121`, and related compilation errors.
* Fixed the Windows battery implementation so unavailable hardware information is returned as `null` with an explanatory note instead of fabricated values.
* Fixed the Windows backend build so the `SystemMonitor.Api` project successfully compiles after the battery-monitoring changes.

### Known Issues

* Detailed battery information such as cycle count, voltage, capacity, and health depends on the battery hardware and Windows battery driver exposing the corresponding information. Some systems may therefore report only battery percentage and power status.
* Windows installer and end-to-end Windows hardware verification still require validation on an actual Windows machine.


## [1.0.4.1] - 2026-09-14

### Added

### Changed

- `backend/SystemMonitor.Api/Endpoints/AnalyticsEndpoints.cs` no longer builds a `?file=...` query parameter when proxying to the analytics service. That was leftover from before the project moved to MongoDB (Phase 8) — `analytics_service.py` hasn't accepted or used a file path in a long time, so this was silently-ignored dead code computing a nonsense path in production (`AppContext.BaseDirectory\..\..\..\data\snapshots.jsonl`, which only made sense inside a dev `bin/Debug/...` folder).
- `analytics/run_analytics.py` and the PyInstaller build step in `release.yml` now pin uvicorn's HTTP/loop implementation explicitly (`http="h11"`, `loop="asyncio"`) and explicitly collect uvicorn's submodules (`--collect-submodules uvicorn`) instead of relying on its "auto" runtime resolution. Not confirmed to have caused a real failure, but uvicorn resolves some internals dynamically by string name at startup, which PyInstaller's static analysis can silently miss — this closes that gap defensively.

### Fixed

- `WindowsSystemInfoProvider.cs`'s `GetBattery()` was a hardcoded stub (`Note: "Battery reporting not yet implemented on Windows"`) that never read real data. It now reads actual charge percentage and charging/discharging/fully-charged status via the Win32 `GetSystemPowerStatus()` API (the same source Windows' own taskbar battery icon uses). Capacity (mAh), health %, cycle count, model, and manufacturer are still not implemented — those need WMI's `Win32_Battery`/`Win32_PortableBattery`, which are unreliable across vendors — and are left honestly `null` with an explanatory note rather than guessed.
- CI version detection (`release.yml`) only matched a strict 3-segment `X.Y.Z` version in `CHANGELOG.md`. Widened to accept 3 or 4 segments (`X.Y.Z` or `X.Y.Z.W`) so a hotfix version like this one doesn't silently fail version detection.

### Known Issues

- Analytics (`/api/analytics/stats`, `/trend`, `/bottlenecks`) returns `500` with "MONGO_URI not set" unless a MongoDB connection string is placed at `%LOCALAPPDATA%\SystemInfo\config\mongo_uri.txt` on the machine running it. This is expected, not a bug — analytics has no other data source. Live dashboard metrics (CPU/RAM/disk/network/battery) work with no MongoDB setup at all. That config file lives outside the install directory, so it survives reinstalls/updates once set.


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
