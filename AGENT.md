<div align="center">

# 🤖 System Info — Agent Guide

**Fast-load technical reference for AI coding agents — stack, structure, endpoints, known traps, and behavioral contracts, so you don't have to scan every folder before making a change**

`React 19` · `TypeScript` · `.NET 10` · `Tauri 2 / Rust` · `C++17` · `x86-64 Assembly` · `Python / FastAPI` · `Local JSON Lines`

</div>

---

Read this before making changes — it's written to be scanned instead of exploring the whole repo cold. If this file and the code disagree, trust the code and update this file. `README.md` (fuller feature/architecture writeup + mermaid diagram) and `PROJECT_STATUS.md` (verification status, full history) go deeper if you need it.

**Repo:** github.com/VipulSharma143/System-Info · **Current version:** 2.2.2 · **License:** none — no `LICENSE` file exists in the repo.

## 📖 What it is

Real-time hardware telemetry (CPU/RAM/disk/network/processes/battery/GPU/system identity) + local historical trend/bottleneck analysis, packaged as a native desktop app on Windows and Linux via Tauri 2. No cloud, no account, no database — fully local/offline, single user. Also a deliberate learning project spanning 6 languages, built in stages (React → .NET → C++ → Assembly → Python → packaging), each stage solid before the next was added.

**Hard rule, applies everywhere:** if the OS can't prove a value, show `Unavailable`. Never default to 0, guess, or silently omit.

## ✨ Features (what actually exists today)

- Live dashboard: CPU/RAM/disk/network/process metrics, server-cached, with a `Live · updated Ns ago` freshness indicator degrading `Reconnecting` → `Offline`.
- System identity: computer name, manufacturer, model, BIOS version, OS edition/build, uptime.
- GPU: every adapter detected (multi-GPU laptops included) with live per-engine utilization on Windows, not one fabricated "GPU usage" number.
- Real Windows battery telemetry via the battery-class-driver IOCTL interface (same one `powercfg /batteryreport` uses).
- Historical analytics: CPU/network trend charts, bottleneck-episode detection, stats over 1h/6h/24h/7d windows.
- Client-side network speed test against Cloudflare.
- Native desktop app on both platforms (not a browser tab), with Start/Stop/Exit and orphan-process hardening.
- In-app self-update via GitHub Releases (since 2.2.0).

## 🧰 Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, Tailwind 4, sweetalert2 (alerts), lucide-react (icons) — no router, no Redux, state lives in custom hooks |
| Desktop shell | Tauri 2 (Rust, `win32job` on Windows) — native window, spawns/supervises backend+analytics as child processes |
| Backend | C#, .NET 10 Minimal API. No auth (loopback-only, single user). No ORM. |
| Native engine | C++17 (CMake), called via P/Invoke — CPU benchmark, GPU vendor detect, diagnostics |
| Perf demo | x86-64 NASM (scalar + SIMD/SSE2) CPU benchmark, called from C++ |
| Analytics | Python 3.10+/FastAPI + uvicorn (port 8001) — trend/bottleneck/stats over local snapshot files |
| Storage | **No database.** Append-only local JSON Lines: `data/snapshots/{yyyy}/{MM}/{dd}.jsonl`. (Previously MongoDB Atlas, before that PostgreSQL was the original target — both replaced deliberately for offline capability. Don't reintroduce a DB without discussion.) |
| CI/CD | One workflow, `.github/workflows/release.yml`: `version → build-windows + build-linux (parallel) → release`. Triggered by a new top `CHANGELOG.md` entry. |

**Prerequisites for local dev:** .NET SDK 10.0+, Node.js 20.x+, Python 3.10+, CMake 3.10+, NASM, Rust (stable) + Tauri 2 CLI (only needed for the desktop shell itself).

## 📁 Structure

```
frontend/src/          React app: components/{views,common,layout}, hooks/, lib/ (apiConfig.ts!), types/
  views/                OverviewView, AnalyticsView, ProcessesView, StorageView, NetworkView, BatteryView, SystemView, UpdatesView
  common/                Shared design-system primitives: Panel, MetricCard, Sparkline, UsageBar, States, Table, Segmented, StatusIndicator
  hooks/                 useSystemMetrics, useSystemInfo, useSystemGpu, useAnalytics, useSpeedTest, useServiceControl, useUpdater, useTheme
frontend/src-tauri/     Rust shell: process.rs (spawn/supervise), commands.rs (start_services/stop_services/get_service_status/exit_app —
                        ONLY 4 IPC commands, deliberately no tauri-plugin-shell / no generic command execution)
backend/SystemMonitor.Api/
  Endpoints/            SystemEndpoints, AnalyticsEndpoints, NativeEndpoints, SpeedTestEndpoints
  services/             WindowsSystemInfoProvider / LinuxSystemInfoProvider, SystemMonitorBackgroundService,
                         LocalJsonSnapshotStore, SnapshotLogger, WindowsBatteryInterop, AppDataPath
  interface/             ISystemInfoProvider, ISnapshotStore
  Native/                 NativeInterop.cs (P/Invoke bridge)
native/                  C++ engine: include/native_engine.h (C ABI), src/{windows,linux}_provider.cpp, src/common.cpp
assembly/                NASM benchmarks: benchmark_loop.asm, simd_loop.asm, get_constant.asm
analytics/               analytics_service.py (FastAPI: /health,/stats,/trend,/bottlenecks), trend_analysis.py,
                         bottleneck_detection.py, analyze_snapshots.py, run_analytics.py (PyInstaller entry)
scripts/                 sync-version.mjs, check-version.mjs, archive-changelog.mjs, make-update-manifest.mjs
launcher/, packaging/linux/, SystemInfo.iss, README-WINDOWS-INSTALLER.md, GITHUB-ACTIONS-SETUP.md
                         DEPRECATED — pre-Tauri approach, kept only as rollback reference. Don't build on these.
database/, docs/, tests/  Empty placeholders. No test suite exists yet.
```

## 🏗️ Architecture

Two independent hardware-reading paths — intentional, not duplication:
1. `/api/system/*` → `ISystemInfoProvider` (C#) → WMI/PerformanceCounter+Battery IOCTL (Windows) or `/proc`,`/sys`,DMI sysfs,`/etc/os-release` (Linux). **This is what the dashboard actually displays** (GPU panel, CPU/RAM/battery cards).
2. `/api/native/*` → C++ engine → Assembly. Used for CPU benchmarking, GPU vendor/AMD-usage detect (Linux's only GPU source), diagnostics.

Live metrics: frontend polls `GET /api/system/all` → `SystemMonitorBackgroundService` (cached CPU/network) + `ISystemInfoProvider` (RAM/disk/battery on demand).
History: background service appends every sample to `.jsonl` → frontend Analytics tab → .NET proxies to Python analytics (graceful 503 if down) → Python reads `.jsonl` directly, skipping malformed lines rather than failing.

### 📊 Metrics: Windows source vs Linux source

| Metric | Windows | Linux |
|---|---|---|
| CPU | `PerformanceCounter` + native read | `/proc/stat`, `/proc/cpuinfo` |
| RAM | `Win32_OperatingSystem` | `/proc/meminfo` |
| Disk | `DriveInfo` (.NET, both platforms) — capacity/usage only, no SMART health (needs root, not implemented) |
| Network | Windows network counters | `/proc/net/dev` |
| Processes | .NET `Process` APIs | `/proc/[pid]/status` |
| Battery | Battery-class-driver IOCTL | sysfs `BAT*`, dynamic discovery |
| GPU | `Win32_VideoController` + `GPU Engine` perf counters (every adapter, live per-engine) | native engine `get_gpu_vendor()`/`get_amd_gpu_usage_percent()` (sysfs) — narrower than Windows |
| System identity | `Win32_ComputerSystem`/`Win32_BIOS`/`Win32_OperatingSystem` | DMI sysfs, `/etc/os-release`, `/proc/uptime` |
| CPU temp / fan RPM | Native engine, `Unavailable` if no trustworthy sensor | Native engine + sysfs thermal zones, same rule |

## 🪟 Desktop shell (Tauri 2) details

Window: 1280×820 default, 980×650 minimum, both platforms. `process.rs` spawns backend (`:5132`) and analytics (`:8001`) as managed child processes, polling each `/health` (400ms interval, 30s timeout) before reporting ready — same platform-agnostic code path on both OSes, no per-platform launcher. Data dir resolution: `%LOCALAPPDATA%\SystemInfo` (Win) / `~/.local/share/SystemInfo` (Linux). `ServiceControls.tsx` (Tauri-only, not shown under plain `npm run dev`) exposes Stop (halt services, keep window) and Exit (stop + close); the native window's `X` button does the same full shutdown as Exit. Orphan hardening: Windows uses `win32job` Job Objects (`KILL_ON_JOB_CLOSE`) so a PyInstaller-extracted interpreter process dies even on an app crash; Linux collapses to plain `Child::kill()` (no onefile-extraction indirection to guard against there).

## 🔄 In-app updates (since 2.2.0)

Checks GitHub Releases a few seconds after load and every 6h while open; `Updates` tab shows current/new release notes, a manual check button, download progress, and an "install automatically at startup" toggle (off by default). Install sequence: download (services keep running) → stop backend+analytics → install → relaunch → services start fresh; a cancelled/failed install restarts services instead. Reads `github.com/VipulSharma143/System-Info/releases/latest/download/latest.json`, built by `scripts/make-update-manifest.mjs` in the `release` job. Signing: public key lives in `tauri.conf.json` (`plugins.updater.pubkey`); private key only as GitHub secrets `TAURI_SIGNING_PRIVATE_KEY`(`_PASSWORD`) — `release.yml` refuses to run if the public key is still a placeholder or the secret is missing. Versions before 2.2.0 have no updater and need one manual install.

## 🔌 API (backend on :5132, or whatever `apiConfig.ts` resolves)

`GET /health` · `/api/system/{all,cpu,ram,disk,network,processes,battery,info,gpu}` · `/api/analytics/{stats,trend,bottlenecks}?minutes=` · `/api/speed-test` (implemented, unused — frontend does it client-side against Cloudflare) · `/api/native/{cpuinfo,cpu,cputemp,gpu,battery,fan,test,benchmark,asmtest,simd-benchmark}`

CORS locked to `localhost:5173` (Vite dev), `tauri.localhost` (Win WebView2), `tauri://localhost` (Linux Tauri). No auth token — CORS is the only real boundary.

## 🚀 Dev commands

```bash
./setup.sh                                  # first-time (Linux full / Windows dev-only via setup.ps1)
./start-all.sh                              # dev: backend+analytics+frontend together (start-all.ps1 on Windows)
cd backend/SystemMonitor.Api && dotnet run  # :5132
cd analytics && python -m uvicorn analytics_service:app --port 8001
cd frontend && npm run dev                  # :5173
cd frontend && npm run tauri dev            # actual desktop shell, dev mode
./build.sh                                  # fail-fast full validation build (native → backend → frontend)
./clean.sh                                  # strip build artifacts (node_modules/dist/bin/obj/caches) before archiving/sharing
```
Data dir: `./data` (dev) · `%LOCALAPPDATA%\SystemInfo\data` (Win packaged) · `~/.local/share/SystemInfo/data` (Linux packaged) — resolved by `AppDataPath.cs`, never hardcode.

## 🔢 Versioning & release

Single source: top `## [x.y.z]` entry in `CHANGELOG.md`. Synced to 5 files: `frontend/package.json`, `frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/Cargo.toml`, `Directory.Build.props`, `SystemInfo.iss`.
```bash
node scripts/sync-version.mjs   # propagate CHANGELOG.md top version → all 5 files
node scripts/check-version.mjs  # verify sync (CI runs this)
node scripts/archive-changelog.mjs [--keep N]  # manual, post-release: move old entries to CHANGELOG_ARCHIVE.md (default keeps 2 newest); never affects release detection, which only reads the top entry
```
Release = push a new top `CHANGELOG.md` entry to `main`. Pipeline: `version` job parses it and checks the tag doesn't already exist → `build-windows` + `build-linux` (parallel, each builds native engine → self-contained backend publish → embeds frontend into `wwwroot` → PyInstaller-freezes analytics → `tauri build`) → `release` (only if both succeed) creates the git tag + GitHub Release atomically, attaches installers + `latest.json`. **Never hand-create a git tag** — see traps below.

## 🐛 Known traps (don't repeat these)

- **Never hardcode an API host/port** outside `frontend/src/lib/apiConfig.ts`. Packaged builds get an OS-assigned/non-fixed backend port — a hardcoded `localhost:5132` broke the shipped app once already. Prod uses same-origin relative URLs (`import.meta.env.DEV ? 'http://localhost:5132' : ''`).
- **`wwwroot` copy must happen as a CI shell step before `dotnet publish`**, not an MSBuild `BeforeTargets="Publish"` target — the SDK decides publishable `wwwroot` content at project-evaluation time, before any target runs, so a target-based copy silently ships an empty `wwwroot`.
- **Never manually create a release git tag.** A broken/premature tag permanently blocked a version once under the old multi-workflow (`workflow_run`-linked) chain, which had no atomic tag+release guarantee; the current single `release.yml` with job-level `needs:` fixes this, but don't defeat it by tagging by hand.
- Windows DXGI/system-lib links need an explicit `target_link_libraries(...)` in `CMakeLists.txt` — an MSVC-only `#pragma comment(lib,...)` silently no-ops on other toolchains (e.g. mingw).
- Don't add a generic Tauri command/shell-execution bridge. `commands.rs` intentionally exposes exactly 4 named commands and nothing else.

## ⚠️ Unverified / known-limited (check `PROJECT_STATUS.md` before assuming these work)

Windows battery IOCTL detail + DXGI-linked GPU reads — implemented, not hardware-verified (no Windows/dotnet toolchain in the environment that most recently extended them; Windows cross-compilation via mingw-w64 was verified in isolation only). GPU detection is split across two unreconciled code paths (Windows structured provider vs. Linux native-engine path — see Architecture above). Multi-GPU engine-to-adapter attribution on Windows (parses `_phys_N_` from perf-counter instance names) is unverified against real dual-GPU hardware. No retention/TTL on snapshot storage (grows unbounded — accepted tradeoff, not a bug to silently fix). No automated test suite; `tests/`, `docs/`, `database/` are empty placeholders. No `LICENSE` file.

## 📜 Behavioral contracts (do not break)

- No fabricated hardware values, ever — `Unavailable` is always correct over a guess.
- Fully offline: no account, no cloud backend, no database.
- Windows Job Object hardening must keep guaranteeing no orphaned backend/analytics processes survive a crash.
- Update install must cleanly stop all services first, restart fresh after (or restart again if cancelled/failed) — never straddle services across an update.
- CORS stays restricted to the known Tauri/Vite-dev origins listed above — it's the only real access boundary this API has.

---

<div align="center">

See [`README.md`](./README.md) for the project overview and [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) for full engineering history and verification status.

</div>
