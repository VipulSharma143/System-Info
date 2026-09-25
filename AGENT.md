# AGENT.md — System Info

Cross-platform system-monitoring desktop app. Read this before making changes. If this file and the code disagree, trust the code and update this file. `README.md` and `PROJECT_STATUS.md` have more depth if you need it — this file is the fast-load summary.

**Repo:** github.com/VipulSharma143/System-Info · **Current version:** 2.2.2 (source of truth: top entry of `CHANGELOG.md`)

## What it is

Real-time hardware telemetry (CPU/RAM/disk/network/processes/battery/GPU/system identity) + local historical trend/bottleneck analysis, packaged as a native desktop app (Windows + Linux, via Tauri 2). No cloud, no account, no database — deliberately offline-only, single local user. Also a deliberate learning project spanning 6 languages, built in stages (React → .NET → C++ → Assembly → Python → packaging), each stage solid before the next was added.

**Hard rule, applies everywhere:** if the OS can't prove a value, show `Unavailable`. Never default to 0, guess, or fabricate a reading.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, Tailwind 4, sweetalert2 (alerts), lucide-react (icons) — no router, no Redux, state lives in custom hooks |
| Desktop shell | Tauri 2 (Rust) — native window, spawns/supervises backend+analytics as child processes |
| Backend | C#, .NET 10 Minimal API. No auth (loopback-only, single user). No ORM. |
| Native engine | C++17 (CMake), called via P/Invoke — CPU benchmark, GPU vendor detect, diagnostics |
| Perf demo | x86-64 NASM (scalar + SIMD) CPU benchmark, called from C++ |
| Analytics | Python 3.10+/FastAPI (port 8001) — trend/bottleneck/stats over local snapshot files |
| Storage | **No database.** Append-only local JSON Lines: `data/snapshots/{yyyy}/{MM}/{dd}.jsonl`. (Previously MongoDB Atlas — deliberately removed for offline capability. Don't reintroduce a DB without discussion.) |
| CI/CD | One workflow, `.github/workflows/release.yml`: `version → build-windows + build-linux (parallel) → release`. Triggered by a new top `CHANGELOG.md` entry. |

## Structure

```
frontend/src/          React app: components/{views,common,layout}, hooks/, lib/ (apiConfig.ts!), types/
frontend/src-tauri/    Rust shell: process.rs (spawn/supervise), commands.rs (start/stop/status/exit — ONLY 4 IPC commands, no shell plugin)
backend/SystemMonitor.Api/
  Endpoints/           SystemEndpoints, AnalyticsEndpoints, NativeEndpoints, SpeedTestEndpoints
  services/            WindowsSystemInfoProvider / LinuxSystemInfoProvider, SystemMonitorBackgroundService,
                        LocalJsonSnapshotStore, SnapshotLogger, WindowsBatteryInterop, AppDataPath
  interface/           ISystemInfoProvider, ISnapshotStore
  Native/               NativeInterop.cs (P/Invoke bridge)
native/                 C++ engine: include/native_engine.h (C ABI), src/{windows,linux}_provider.cpp
assembly/               NASM benchmarks
analytics/              analytics_service.py (FastAPI), trend_analysis.py, bottleneck_detection.py, run_analytics.py (PyInstaller entry)
scripts/                sync-version.mjs, check-version.mjs, archive-changelog.mjs, make-update-manifest.mjs
launcher/, packaging/linux/, SystemInfo.iss   DEPRECATED — pre-Tauri, kept only as rollback reference. Don't build on these.
database/, docs/, tests/                       Empty placeholders. No test suite exists yet.
```

## Architecture

Two independent hardware-reading paths — this is intentional, not duplication:
1. `/api/system/*` → `ISystemInfoProvider` (C#) → WMI/PerformanceCounter+Battery IOCTL (Windows) or `/proc`,`/sys` (Linux). **This is what the dashboard actually displays.**
2. `/api/native/*` → C++ engine → Assembly. Used for CPU benchmarking, GPU vendor/AMD-usage detect (Linux), diagnostics.

Live metrics: frontend polls `GET /api/system/all` → `SystemMonitorBackgroundService` (cached CPU/network) + `ISystemInfoProvider` (RAM/disk/battery on demand).
History: background service appends every sample to `.jsonl` → frontend Analytics tab → .NET proxies to Python analytics (graceful 503 if down) → Python reads `.jsonl` directly.

## API (backend on :5132, or whatever `apiConfig.ts` resolves)

`GET /health` · `/api/system/{all,cpu,ram,disk,network,processes,battery,info,gpu}` · `/api/analytics/{stats,trend,bottlenecks}?minutes=` · `/api/speed-test` (implemented, unused — frontend does it client-side against Cloudflare) · `/api/native/{cpuinfo,cpu,cputemp,gpu,battery,fan,test,benchmark,asmtest,simd-benchmark}`

CORS locked to `localhost:5173` (Vite dev), `tauri.localhost` (Win WebView2), `tauri://localhost` (Linux Tauri). No auth token — CORS is the only real boundary.

## Dev commands

```bash
./setup.sh                                  # first-time (Linux full / Windows dev-only via setup.ps1)
./start-all.sh                              # dev: backend+analytics+frontend together (start-all.ps1 on Windows)
cd backend/SystemMonitor.Api && dotnet run  # :5132
cd analytics && python -m uvicorn analytics_service:app --port 8001
cd frontend && npm run dev                  # :5173
cd frontend && npm run tauri dev            # actual desktop shell, dev mode
./build.sh                                  # fail-fast full validation build
```
Data dir: `./data` (dev) · `%LOCALAPPDATA%\SystemInfo\data` (Win packaged) · `~/.local/share/SystemInfo/data` (Linux packaged) — resolved by `AppDataPath.cs`, never hardcode.

## Versioning & release

Single source: top `## [x.y.z]` entry in `CHANGELOG.md`. Synced to 5 files: `frontend/package.json`, `frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/Cargo.toml`, `Directory.Build.props`, `SystemInfo.iss`.
```bash
node scripts/sync-version.mjs   # propagate CHANGELOG.md top version → all 5 files
node scripts/check-version.mjs  # verify sync (CI runs this)
```
Release = push a new top `CHANGELOG.md` entry to `main`. **Never hand-create a git tag** — `release.yml`'s `release` job creates tag+GitHub Release atomically, only after both platform builds succeed.

## Known traps (don't repeat these)

- **Never hardcode an API host/port** outside `frontend/src/lib/apiConfig.ts`. Packaged builds get an OS-assigned/non-fixed backend port — a hardcoded `localhost:5132` broke the shipped app once already. Prod uses same-origin relative URLs.
- **`wwwroot` copy must happen as a CI shell step before `dotnet publish`**, not an MSBuild `BeforeTargets="Publish"` target — the SDK decides publishable `wwwroot` content at project-evaluation time, before any target runs, so a target-based copy silently ships an empty `wwwroot`.
- **Never manually create a release git tag.** A broken/premature tag permanently blocks that version (this happened once — old multi-workflow chain had no atomic tag+release guarantee).
- Windows DXGI/system-lib links need an explicit `target_link_libraries(...)` in `CMakeLists.txt` — an MSVC-only `#pragma comment(lib,...)` silently no-ops on other toolchains (e.g. mingw).
- Don't add a generic Tauri command/shell-execution bridge. `commands.rs` intentionally exposes exactly 4 named commands (`start_services`, `stop_services`, `get_service_status`, `exit_app`) and nothing else.

## Unverified / known-limited (check `PROJECT_STATUS.md` before assuming these work)

Windows battery IOCTL detail + DXGI-linked GPU reads — implemented, not hardware-verified. GPU detection is split across two unreconciled code paths (Windows structured provider vs. Linux native-engine path). No retention/TTL on snapshot storage (grows unbounded — accepted tradeoff, not a bug to silently fix). No automated test suite. No `LICENSE` file.

## Behavioral contracts (do not break)

- No fabricated hardware values, ever — `Unavailable` is always correct over a guess.
- Fully offline: no account, no cloud backend, no database.
- Windows Job Object hardening must keep guaranteeing no orphaned backend/analytics processes survive a crash.
- Update install must cleanly stop all services first, restart fresh after (or restart again if cancelled/failed) — never straddle services across an update.
