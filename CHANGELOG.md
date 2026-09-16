# Changelog

All notable changes to SystemInfo are documented here.

## [Unreleased]

### Added

### Changed

### Fixed

### Known Issues


## [2.1.0] - 2026-09-15

### Added

- **Native Windows desktop shell (Tauri 2).** `frontend/src-tauri/` wraps the existing React frontend in a real desktop window — resizable, with working minimize/maximize/restore/close — and takes over starting, health-checking, and stopping the backend (`:5132`) and analytics (`:8001`) as managed child processes. No external browser (Firefox/Chrome/Edge) is opened at any point. See `frontend/src-tauri/src/process.rs` for the startup sequence and `src/lib.rs` for the window-close cleanup path.
- **Start / Stop / Exit controls** in the top bar (`ServiceControls.tsx`, only rendered inside the Tauri shell): Stop halts both services but keeps the window open; Exit stops them and closes the app; the native `X` button performs the same full shutdown as Exit. Minimizing or maximizing never touches the services.
- **Orphan-process hardening.** Each spawned child (backend, analytics) is assigned to its own Windows Job Object with `KILL_ON_JOB_CLOSE`, so a PyInstaller onefile bootstrap's extracted child process — which `Child::kill()` alone can miss — is guaranteed to die with it, including on an unexpected crash of SystemInfo itself.
- **Single authoritative application version.** `scripts/sync-version.mjs`/`scripts/check-version.mjs` propagate one version (sourced from this CHANGELOG, same as CI's release tag) to `frontend/package.json`, `frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/Cargo.toml`, the new root `Directory.Build.props` (fixes the backend's `appVersion` API field, and therefore the System page, permanently reporting `1.0.0.0`), and `SystemInfo.iss`. CI now fails the build if any of them drift instead of shipping a mismatched version silently.
- Centralized frontend API base-URL resolution (`src/lib/apiConfig.ts`) covering all three environments the bundle can run in (Vite dev server, Tauri desktop app, legacy browser-hosted launcher) — replaces three separate copies of the same `API_BASE` constant across `useSystemMetrics`/`useAnalytics`/`useSystemInfo`.
- `GET /health` on the backend, for the Tauri process manager's readiness checks — mirrors `analytics_service.py`'s existing `/health`.
- Real Windows battery data: `WindowsBatteryInterop.cs` queries the battery class driver directly via `IOCTL_BATTERY_QUERY_TAG`/`IOCTL_BATTERY_QUERY_INFORMATION`/`IOCTL_BATTERY_QUERY_STATUS` (the same interface `powercfg /batteryreport` uses) instead of relying solely on `GetSystemPowerStatus`. Cycle count, designed/full-charge capacity, voltage, and health % are now real values on Windows where the driver exposes them, aggregated across multiple batteries when present. **Not yet verified on real Windows hardware.**
- Local historical storage: `ISnapshotStore` / `LocalJsonSnapshotStore` write append-only `data/snapshots/{yyyy}/{MM}/{dd}.jsonl` files instead of MongoDB Atlas. `AppDataPath.cs` resolves the writable location (`%LOCALAPPDATA%\SystemInfo\data` on Windows, `~/.local/share/SystemInfo/data` on Linux, `./data` in dev), created automatically at startup.
- Full frontend redesign: new shared design-system primitives (`Primitives.tsx`), redesigned Overview / Analytics / Processes / Network / Battery, and two new pages — **Storage** and **System** — backed by a new `GET /api/system/info` endpoint (static host/CPU/OS identification, fetched once rather than polled).
- Analytics time-range selector (1 hour / 6 hours / 24 hours / 7 days), replacing the previously hardcoded 30-minute window.
- Live-freshness indicator: the header now shows `Live · updated 2s ago`, and degrades through `Reconnecting` to `Offline` so stale readings can never be mistaken for current ones.

### Changed

- CI's Windows release job now stages the backend/analytics build output into `frontend/src-tauri/resources/` and runs `tauri build`, which produces both the app and its NSIS installer in one step. Inno Setup (`SystemInfo.iss`) and the C# production launcher (`launcher/Program.cs`) are no longer part of the build — both are kept in the repo, clearly marked deprecated, as a rollback reference (see their file headers) rather than deleted outright.
- Backend CORS policy now also allows `http://tauri.localhost` (Tauri 2's default Windows WebView2 origin for the bundled production frontend), alongside the existing Vite dev origin.
- `SnapshotLogger.cs` writes to `ISnapshotStore` instead of MongoDB.
- `analytics_service.py` reads only the local `.jsonl` files covering the requested date range instead of querying Mongo — malformed lines are logged and skipped rather than crashing the request.
- `setup.sh`/`setup.ps1`/`build.sh`/`start-all.sh`/`start-all.ps1`/`launcher/Program.cs` no longer reference `MONGO_URI` — they check/create the local data directory instead.
- `MongoDB.Driver` removed from `SystemMonitor.Api.csproj`; `pymongo` removed from `analytics/requirements.txt`.

### Fixed

- **Fresh-install white screen.** `analytics_service.py` returns `{"message": ..., "count": 0}` when the requested window contains no history — with no `cpu_trend`, `network_trend_rx`, or episode arrays. `TrendSummary`/`StatsSummary`/`BottleneckTimeline` accessed those unconditionally, so `Object.entries(undefined)` threw during render and blanked the **entire dashboard**, not just the analytics panel. Now every one of those fields is optional in `types/analytics.ts` and guarded at each use, and the Analytics page shows an explicit "No history for this range yet" state. This became far more likely after the MongoDB removal, since local storage starts empty on every new install.
- **Unbounded sparklines rendered as solid blocks.** `Sparkline` hardcoded `max=100` (correct for percentages), so network throughput (~1,500 KB/s) clamped every point to the ceiling. Added `max="auto"` for unbounded series; the Network page's two series share one derived scale so up/down stay visually comparable.
- **Battery charge bar used inverted severity colours.** `UsageBar` assumes "high is bad", which painted a healthy 78%-charged battery amber. Added `lowIsBad` so status colour keeps a consistent meaning.
- **C# → Python timestamp incompatibility.** `DateTime.ToString("o")` emits seven fractional-second digits, which `datetime.fromisoformat` rejects before Python 3.11 — working on a dev machine and failing on an older interpreter. Timestamp parsing now truncates the fraction to six digits instead of assuming the runtime.

### Known Issues

- Windows battery IOCTL support has not been build-verified (no Windows/`dotnet` toolchain available in the environment that wrote it) or hardware-tested — needs a real Windows CI build and a real laptop test before Phase 9 can be marked fully done.
- Local storage has no retention/TTL policy yet — `data/snapshots/` grows unbounded over time (documented trade-off, not a bug).


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
