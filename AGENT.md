<div align="center">

# 🤖 System Info — Agent Guide

**Fast-load technical reference for AI coding agents — stack, structure, endpoints, known traps, and behavioral contracts, so you don't have to scan every folder before making a change**

`React 19` · `TypeScript` · `.NET 10` · `Tauri 2 / Rust` · `C++17` · `x86-64 Assembly` · `Local JSON Lines`

</div>

---

Read this before making changes — it's written to be scanned instead of exploring the whole repo cold. If this file and the code disagree, trust the code and update this file. `README.md` (fuller feature/architecture writeup + mermaid diagram) and `PROJECT_STATUS.md` (verification status, full history) go deeper if you need it.

**Repo:** github.com/VipulSharma143/System-Info · **Current version:** 2.7.3 · **License:** MIT, Copyright (c) 2026 Vipul Sharma (`LICENSE`); third-party licenses in `THIRD_PARTY_NOTICES.md` — update it when a dependency is added or removed.

## 📖 What it is

Real-time hardware telemetry (CPU/RAM/disk/network/processes/battery/GPU/system identity) + local historical trend/bottleneck analysis, packaged as a native desktop app on Windows and Linux via Tauri 2. No cloud, no account, no database — fully local/offline, single user. Also a deliberate learning project spanning 6 languages, built in stages (React → .NET → C++ → Assembly → analytics → packaging), each stage solid before the next was added. Analytics started life as a separate Python service and was moved into the .NET backend in 2.3.0 — see `PROJECT_STATUS.md` → *Why analytics moved from Python to C#* before proposing a second runtime or process again.

**Hard rule, applies everywhere:** if the OS can't prove a value, show `Unavailable`. Never default to 0, guess, or silently omit.

## ✨ Features (what actually exists today)

- Live dashboard: CPU/RAM/disk/network/process metrics, server-cached, with a connection indicator (`Live` → `Reconnecting` → `Offline`).
- System identity: computer name, manufacturer, model, BIOS version, OS edition/build, uptime.
- GPU: every adapter detected (multi-GPU laptops included) with live per-engine utilization on Windows, not one fabricated "GPU usage" number.
- Real Windows battery telemetry via the battery-class-driver IOCTL interface (same one `powercfg /batteryreport` uses).
- Historical analytics: CPU/network trend charts, bottleneck-episode detection, stats over 1h/6h/24h/7d windows.
- Client-side network speed test against Cloudflare.
- Native desktop app on both platforms (not a browser tab), with Start/Stop/Exit and orphan-process hardening.
- In-app self-update via GitHub Releases (since 2.2.0).
- Background/startup preference (2.7.3): *always run in the background*, *do not run in the background* (default for every earlier install) or *run at system startup*; asked once on a fresh installation only (Windows installer page; first-launch dialog on Linux and on silent Windows installs), changeable on the System page.
- Overlay page shows drive (SSD/NVMe/HDD) temperatures in a Drives tile next to the CPU, GPU and memory tiles.
- Overview, Network and Processes were redesigned in 2.7.3 (headline + live cards; interface cards; grouped process list).

## 🧰 Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, Tailwind 4, sweetalert2 (alerts), lucide-react (icons) — no router, no Redux, state lives in custom hooks |
| Desktop shell | Tauri 2 (Rust, `win32job` on Windows) — native window, spawns/supervises the backend as a child process |
| Backend | C#, .NET 10 Minimal API. No auth (loopback-only, single user). No ORM. |
| Native engine | C++17 (CMake), called via P/Invoke — CPU topology/features, storage volumes, fans, GPU/VRAM, battery, benchmarks, memory bandwidth |
| Assembly | x86-64 NASM: benchmark loops + SSE2/AVX2 vector kernels (`math/vector_math.asm`: add, dot, int32 sum; `memory/memory_kernels.asm`: xor checksum) behind runtime CPUID/XGETBV dispatch in `simd_dispatch.cpp`. Three tiers: AVX2 asm → SSE2 asm → portable C++; the start-up selftest demotes a failing tier, `SYSTEMINFO_NO_ASM=1` / `si_force_portable(1)` forces the portable one. A hand-written memcpy was removed in 2.4.8 (never beat libc, 0.95-1.0x) — re-add nothing without a benchmark that beats the portable path |
| Analytics | `AnalyticsService.cs` (in-process; was Python/FastAPI on :8001) — trend/bottleneck/stats over local snapshot files, 5 s result cache |
| Storage | **No database.** Append-only local JSON Lines: `data/snapshots/{yyyy}/{MM}/{dd}.jsonl`, never deleted automatically (it grows until Reset data; the System page shows the size via `DataUsageService`), plus `data/battery/sessions.json` (charge/discharge sessions, the only history limited to 7 days). The System page's Reset data button calls `DataResetService`, then the frontend relaunches the app. (Previously MongoDB Atlas, before that PostgreSQL was the original target — both replaced deliberately for offline capability. Don't reintroduce a DB without discussion.) |
| CI/CD | `.github/workflows/release.yml`: `version → tests → build-windows + build-linux (parallel) → release`, triggered by a new top `CHANGELOG.md` entry. `tests` is the reusable `tests.yml` (native/Assembly ctest on Linux + Windows/MSVC, C# tests, Rust supervisor tests); `tests.yml` also runs on every PR and non-main push. |

**Prerequisites for local dev:** .NET SDK 10.0+, Node.js 20.x+, CMake 3.10+, NASM, Rust (stable) + Tauri 2 CLI (only needed for the desktop shell itself).

## 📁 Structure

```
frontend/src/          React app: components/{views,common,layout}, hooks/, lib/ (apiConfig.ts!), styles/, types/
                       Each view in components/views/ is a thin page that composes section files in a same-named subfolder
                       (views/overview/, network/, battery/, ram/ …). Shared pieces live in components/common/.
                       Design system: styles/tokens.css (colours, radii, fonts) · base.css · components.css · alerts.css.
                       Every subsystem owns a hue (lib/hues.ts, `--hue-*`); `Panel hue=…` sets `--h`, and bars/glyphs/dots tint from it.
                       Fonts are bundled (@fontsource-variable/bricolage-grotesque) — no network font requests; body text is the system font.
                       Live series come from ONE buffer (hooks/useDashboardHistory) fed by the snapshot already polled. Polled JSON keeps
                       the identity of unchanged sections (lib/share.ts) so memo()'d panels skip renders. Visited pages stay mounted inside
                       React <Activity>, which pauses their effects/polling while hidden. Never put numbers in raw `toFixed` per page —
                       use lib/format.ts.
                       Startup cache (frontend): lib/persisted.ts keeps the last /api/system/all snapshot (minus processes) in localStorage,
                       keyed by schema + APP_VERSION, so the dashboard renders before the backend answers; `stale` marks it until live data
                       arrives, and live-only features (history, updater, Processes) ignore it. Any miss is silent.
                       components/ also holds SpeedTestCard plus four older analytics files (BottleneckTimeline, SpikeDetail,
                       StatsSummary, TrendSummary) that nothing imports — the live ones are in views/analytics/.
  views/                OverviewView, AnalyticsView, ProcessesView, CpuView, RamView, GpuView, OverlayView, StorageView, NetworkView, BatteryView, SystemView, UpdatesView
  common/                Shared design-system primitives: Panel, MetricCard, Sparkline, UsageBar, States, Table, Segmented, StatusIndicator
  hooks/                 useGpu (adapter list persisted, live polled only while the GPU tab is open), usePolling (the one fetch loop; optional `persist` cache), useSystemMetrics, useSystemInfo, useSystemGpu, useAnalytics, useSpeedTest, useServiceControl, useUpdater, useTheme
frontend/src-tauri/     Rust shell: supervisor.rs (Tauri-free lifecycle core), process.rs (resource lookup + command building), commands.rs
                        (IPC commands: start_services/stop_services/get_service_status/exit_app, prepare_for_update/log_update_event/
                        diagnose_update_check, get_startup_behavior/set_startup_behavior/begin_restart — deliberately no
                        tauri-plugin-shell / no generic command execution), shell.rs (preference state, tray, close handling, quit),
                        settings.rs (settings.json + fresh-vs-update decision), autostart.rs (Run key / XDG autostart entry),
                        instance.rs (one-instance-per-user loopback handshake), installer-hooks.nsh (Windows installer page + Run key);
                        supervisor-tests/ = std-only test crate that includes supervisor.rs, settings.rs, autostart.rs and instance.rs
backend/SystemMonitor.Api/
  Endpoints/            SystemEndpoints, CpuEndpoints, AnalyticsEndpoints, NativeEndpoints, SpeedTestEndpoints
  Services/             Grouped by purpose (namespaces unchanged): Platform/{Linux,Windows}/ (the two system-info providers + WindowsBatteryInterop),
                         Sampling/ (SystemMonitorBackgroundService, SystemSnapshotService = /api/system/all isolation, SystemInfoService, HostSnapshotService),
                         Storage/ (LocalJsonSnapshotStore, SnapshotLogger, SystemInfoCache = startup cache, AppDataPath), Analytics/AnalyticsService,
                         Battery/ (BatteryTracker, BatteryHistoryService, BatteryReadCache = one shared battery read for the sampler, the dashboard and /api/system/battery),
                         Memory/ (MemoryHardwareService/MemoryHealthReader/MemoryMapping/RamDetailsReader),
                         Services/Gpu/: GpuService (cached hardware + 1 s shared live sample), LinuxGpuCollector (DRM/sysfs), WindowsGpuCollector,
                         GpuCounters/GpuMath (Windows counters are matched to adapters by LUID via native get_gpu_luid; per-engine sums), NvmlGpuSource (NVML via NativeLibrary, optional), PciIds (pci.ids names). API: /api/system/gpus/hardware and /gpus/live.
                         Services/Cpu/: CpuDetailService (merges the native CPU document with the overlay engine's live per-processor load, clocks and
                         CPU temperature — one source, so the CPU and Overlay tabs always agree) + CpuDetailModels. The headline CPU temperature is NEVER read
                         a second time: it is the overlay engine's value (native cpu_temperature.cpp; acpitz is NEVER a CPU temperature).
                         HostSnapshotService + Native/HostSnapshot.cs: ONE native call (si_read_host_snapshot) for CPU ticks + memory + CPU temperature, shared by the Linux provider.
                         API: /api/system/cpu/detail (Endpoints/CpuEndpoints). Frontend: CpuView (components/views/cpu/: hero, tiles, per-core grid, temperature,
                         clock/power, specs, activity) and OverlayView (compact tiles: CPU, memory, each GPU, and a Drives tile with SSD/NVMe/HDD temperatures from /api/system/sensors — no clock/fan/power sections, by decision)
  Contracts/             ISystemInfoProvider (and the records it returns), ISnapshotStore, MemoryModels
  Native/                 NativeInterop.cs (P/Invoke bridge), NativeKernels.cs (safe span wrappers + C# reference implementations), SeriesEngine.cs (series statistics/slope/run scans for AnalyticsService: native engine for series of 256+ samples, plain C# below that or when the library is missing; SeriesEngine.Reference = the plain versions the tests compare with; TryParseSnapshots = the native reader of the saved day files, which returns false whenever it cannot match the managed reader exactly and AnalyticsService then reads the managed way)
backend/SystemMonitor.Tests/  dependency-free test runner (analytics, storage, native wrappers); links sources instead of referencing the Api project
Engine/Cpp/              C++ engine: include/native_engine.h (C ABI), src/common.cpp, src/simd_dispatch.cpp (CPUID + dispatch + self-test), src/series_engine.cpp (series maths over the analytics kernels), src/series_parse.cpp (validating reader of the saved snapshot lines: follows the managed reader exactly or returns 0 so the caller reads the managed way),
                         src/smbios/ (platform-neutral table parsing), platform/{linux,windows}/ (cpu, cpu_detail, storage, fan, memory, smbios_source, provider), build.sh,
                         src/cpu_detail.cpp (CPUID identity/features + the one JSON document behind the CPU tab, si_cpu_detail_json; null = not readable, never 0)
Engine/Assembly/         NASM: cpu/ (benchmark_loop, simd_loop, get_constant), math/vector_math.asm + stats_kernels.asm, memory/memory_kernels.asm, analytics/series_stats.asm + series_scan.asm (float64 series; SSE2/AVX2; no SSE2 count kernel because it measured slower than portable), abi.inc. Kernels use volatile registers only (RAX, R10, R11, XMM/YMM0-5), no stack, pointer/integer arguments only (a double argument would sit in different registers on Windows and System V), and are covered by si_kernel_selftest (tier demotion) and tests/series_engine_test.cpp (incl. a guard-page over-read check)
scripts/                 sync-version.mjs, check-version.mjs, archive-changelog.mjs, make-update-manifest.mjs
Engine/Cpp/tests/       C++/Assembly tests (ctest)
packaging/linux/         systeminfo.png (icon source) + install-smbios-snapshot.sh (one-time Linux RAM-module setup).
docs/                    Empty placeholder (there is no database/ directory).
```

## 🏗️ Architecture

Two independent hardware-reading paths — intentional, not duplication:
1. `/api/system/*` → `ISystemInfoProvider` (C#) → WMI/PerformanceCounter+Battery IOCTL (Windows) or `/proc`,`/sys`,DMI sysfs,`/etc/os-release` (Linux). **This is what the dashboard actually displays** (GPU panel, CPU/RAM/battery cards).
2. `/api/native/*` → C++ engine → Assembly. Used for CPU benchmarking, GPU vendor/AMD-usage detect (Linux's only GPU source), diagnostics.

Live metrics: frontend polls `GET /api/system/all` → `SystemMonitorBackgroundService` (cached CPU/network) + `ISystemInfoProvider` (RAM/disk/battery on demand).
History: background service appends every sample to `.jsonl` → frontend Analytics tab → `AnalyticsService` (in-process) reads `.jsonl` directly, skipping malformed lines rather than failing.

### 📊 Metrics: Windows source vs Linux source

| Metric | Windows | Linux |
|---|---|---|
| CPU | `PerformanceCounter` + native read | `/proc/stat`, `/proc/cpuinfo` |
| RAM (runtime) | Native `GlobalMemoryStatusEx` + `GetPerformanceInfo` (WMI fallback) | Native `/proc/meminfo` (managed `/proc/meminfo` fallback) |
| RAM (physical modules) | Raw SMBIOS Type 16/17 via `GetSystemFirmwareTable('RSMB')` (no admin; never wmic/PowerShell) — implemented, not run on real Windows | Raw SMBIOS Type 16/17 parsed natively from `/sys/firmware/dmi/tables/DMI` (root-only; never `dmidecode`) |
| Memory health | None | EDAC counters under `/sys/devices/system/edac/mc*` |
| Disk | `DriveInfo` (.NET, both platforms) — capacity/usage only, no SMART health (needs root, not implemented) |
| Network | Windows network counters | `/proc/net/dev` |
| Processes | .NET `Process` APIs | `/proc/[pid]/status` |
| Battery | Battery-class-driver IOCTL | sysfs `BAT*`, dynamic discovery |
| GPU | `Win32_VideoController` + `GPU Engine` perf counters (every adapter, live per-engine) | native engine `get_gpu_vendor()`/`get_amd_gpu_usage_percent()` (sysfs) — narrower than Windows |
| System identity | `Win32_ComputerSystem`/`Win32_BIOS`/`Win32_OperatingSystem` | DMI sysfs, `/etc/os-release`, `/proc/uptime` |
| CPU temp / fan RPM | CPU temp: LibreHardwareMonitorLib via `Services/Cpu/LibreHardwareCpuSensorSource.cs` (2.6.3; needs administrator, and the PawnIO driver for the library version in use; the reason for a missing value comes from `CpuSensorSelection.ExplainMissingTemperature`; selection rules in `CpuSensorSelection.cs`, native value never replaced). Fan RPM: native, `Unavailable` if no trustworthy sensor | Native engine + sysfs thermal zones, same rule |
| Integrated GPU temp (Windows) | LibreHardwareMonitorLib via `Services/Gpu/LibreHardwareGpuSensorSource.cs` (2.6.6), merged into the overlay snapshot by `GpuSensorSelection.Apply` (called from `OverlayService.Read`): only an `integrated` Intel/AMD adapter with no native temperature, from the `GPU Core` sensor, 1..125 °C, paired by normalised name or by lone-adapter elimination; otherwise a specific note, never a number | Native engine / sysfs, NVIDIA via NVML, all unchanged |

## 🪟 Desktop shell (Tauri 2) details


**Windows elevation (2.6.3):** `frontend/src-tauri/build.rs` embeds `windows-app-manifest.xml` (`requireAdministrator`) only for **release** builds targeting Windows; `tauri dev` stays non-elevated (an elevated manifest makes `cargo run` fail with os error 740). Children inherit the token, so there is one UAC prompt per launch and no code in `process.rs` re-elevates. Never add `runas`/`ShellExecute` relaunch logic. Elevation does not guarantee a CPU temperature (driver/firmware must expose it).
Window: 1280×820 default, 980×650 minimum, both platforms. `supervisor.rs` (Tauri-free lifecycle core, unit-tested) + `process.rs` (resource lookup, command building) start the backend (`:5132`) — the supervisor is generic over a list of services and starts them **concurrently**, polling `/health` every 100 ms; a child that dies during startup is reported immediately, a busy port is detected before spawn, a pid file lets the next launch reap leftovers (Linux). The 45 s timeout is an upper bound only. `get_service_status` is lock-free and must stay non-blocking — sync Tauri commands run on the UI thread, and holding a lock across the readiness wait froze the window once. `start_services`/`stop_services` are async + `spawn_blocking` for the same reason. Stage timings land in `<data>/logs/startup.log`. Data dir resolution: `%LOCALAPPDATA%\SystemInfo` (Win) / `~/.local/share/SystemInfo` (Linux). `ServiceControls.tsx` (Tauri-only, not shown under plain `npm run dev`) exposes Stop (halt services, keep window) and Exit (stop + close); the native window's `X` button does the same full shutdown as Exit unless a background mode is chosen and the tray exists, in which case it hides the window. Orphan hardening: Windows uses `win32job` Job Objects (`KILL_ON_JOB_CLOSE`) so the backend dies even on an app crash; Linux uses the pid file + `/proc/<pid>/exe` check to reap leftovers.

**Background and startup behaviour (2.7.3):** the choice lives in `settings.json` in the data root (`%LOCALAPPDATA%\SystemInfo` / `~/.local/share/SystemInfo`, next to `data/` and `logs/`; Reset data never deletes it). `settings.rs` decides fresh vs. update from what is on disk *before* anything creates folders: a readable file wins; no file but existing content = an update, stored as `off` and never asked; no file and an empty folder = fresh, stored as `off` + `firstRunPending` so the first-launch dialog (`FirstRunDialog.tsx`, shown only when `get_startup_behavior` reports `firstRun`) asks exactly once even if the app is closed unanswered. The Windows installer (`installer-hooks.nsh`, a page that is first in a fresh install) writes the same file only; it is skipped for `/UPDATE`, `/P`, silent installs, an existing installation, or an existing `settings.json`. `shell.rs` owns the tray (exists exactly while a background mode is chosen; created on the main thread) and the close handler: `hides_on_close` is true only for a background mode AND a working tray AND not closing; otherwise close = full shutdown, so the window can never be lost. `Startup` registers `--autostart` (Windows: scheduled task `SystemInfo`, at logon, highest privileges, created via `schtasks /XML` by the elevated app — the Run key does not start elevation-requiring programs at sign-in, so it is only a fallback for unelevated dev runs; the installer writes only settings.json; Linux `~/.config/autostart/systeminfo.desktop`, AppImage uses `$APPIMAGE`), reconciled on every launch, and an OS-started launch stays hidden only when the tray works. The window is created hidden (`visible:false`) and shown in `setup`. **One instance per user** is `instance.rs`, not a plugin: a loopback handshake on port 47813 where the running app answers `ok` (and shows its window) or `closing`. Anything that restarts the app must call `relaunchApp()` (`lib/tauri.ts`, which calls `begin_restart` first) rather than the process plugin's `relaunch()` directly, or the new process is turned away as a second launch. Quit and the full-shutdown path set the same closing flag. The cross button AND the Exit button both call `shell::close_window` → `settings::close_action` (the single decision; tested): hide in a background mode with a working tray, otherwise quit. Tray Quit is the only way to stop a background-mode app completely.

## 🔄 In-app updates (since 2.2.0)

Checks GitHub Releases a few seconds after load and every 6h while open; `Updates` tab shows current/new release notes, a manual check button, download progress, and an "install automatically at startup" toggle (off by default). Install sequence: download (services keep running) → stop the backend → install → relaunch → services start fresh; a cancelled/failed install restarts services instead. Reads `github.com/VipulSharma143/System-Info/releases/latest/download/latest.json`, built by `scripts/make-update-manifest.mjs` in the `release` job. Signing: public key lives in `tauri.conf.json` (`plugins.updater.pubkey`); private key only as GitHub secrets `TAURI_SIGNING_PRIVATE_KEY`(`_PASSWORD`) — `release.yml` refuses to run if the public key is still a placeholder or the secret is missing. Versions before 2.2.0 have no updater and need one manual install.

## 🔌 API (backend on :5132, or whatever `apiConfig.ts` resolves)

`GET /health` · `/api/system/{all,cpu,ram,disk,network,processes,battery,info,gpu,memory/hardware,memory/health}` · `/api/analytics/{stats,trend,bottlenecks}?minutes=` · `/api/speed-test` (implemented, unused — frontend does it client-side against Cloudflare) · `/api/native/{cpuinfo,cpufeatures,kernels,topology,storage,fans,memory-bandwidth,cpu,cputemp,gpu,battery,fan,test,benchmark,asmtest,simd-benchmark}`. `/api/system/all` now isolates each subsystem (per-section timeout, last-good RAM, additive `unavailable` array) via `SystemSnapshotService`

CORS locked to `localhost:5173` (Vite dev), `tauri.localhost` (Win WebView2), `tauri://localhost` (Linux Tauri). No auth token — CORS is the only real boundary.

## 🚀 Dev commands

```bash
./setup.sh                                  # first-time (Linux full / Windows dev-only via setup.ps1)
./start-all.sh                              # dev: backend+frontend together (start-all.ps1 on Windows)
cd backend/SystemMonitor.Api && dotnet run  # :5132
cd frontend && npm run dev                  # :5173
cd frontend && npm run tauri dev            # actual desktop shell, dev mode
cmake -S Engine/Cpp -B Engine/Cpp/build -DBUILD_NATIVE_TESTS=ON && cmake --build Engine/Cpp/build && (cd Engine/Cpp/build && ctest --output-on-failure)   # native + assembly tests
cd frontend/src-tauri/supervisor-tests && cargo test   # process-supervision tests (std-only fake service; uses loopback ports 18101-18152)
dotnet run --project backend/SystemMonitor.Tests   # analytics + storage + native wrapper tests (SYSTEMINFO_NATIVE_DIR=<native build dir>)
./build.sh                                  # fail-fast full validation build (native → backend → frontend)
./clean.sh                                  # strip build artifacts (node_modules/dist/bin/obj/caches) before archiving/sharing
```
Startup cache: `<data>/cache/*.json` (`SystemInfoCache.cs`) holds identity/CPU model, memory modules, Windows GPU adapters and last disks/battery; a `.version` marker (schema|app version|machine) wipes it on any change. Every failure is a cache miss — never make the cache required or let it throw.
Data dir: `./data` (dev) · `%LOCALAPPDATA%\SystemInfo\data` (Win packaged) · `~/.local/share/SystemInfo/data` (Linux packaged) — resolved by `AppDataPath.cs`, never hardcode.

## 🔢 Versioning & release

Single source: top `## [x.y.z]` entry in `CHANGELOG.md`. Synced to 6 files: `frontend/package.json`, `frontend/package-lock.json`, `frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/Cargo.toml`, `frontend/src-tauri/Cargo.lock` (the `system-info` package only), `Directory.Build.props`.
```bash
node scripts/sync-version.mjs   # propagate CHANGELOG.md top version → all 6 files
node scripts/check-version.mjs  # verify sync (CI runs this)
node scripts/archive-changelog.mjs [--keep N]  # manual, post-release: move old entries to CHANGELOG_ARCHIVE.md (default keeps 2 newest); never affects release detection, which only reads the top entry
```
Release = push a new top `CHANGELOG.md` entry to `main`. Pipeline: `version` job parses it and checks the tag doesn't already exist → `build-windows` + `build-linux` (parallel, each builds native engine → self-contained backend publish → embeds frontend into `wwwroot` → `tauri build`), after the reusable `tests.yml` workflow (native/Assembly ctest on Linux+Windows, C# tests, Rust supervisor tests) has passed → `release` (only if both succeed) creates the git tag + GitHub Release atomically, attaches installers + `latest.json`. **Never hand-create a git tag** — see traps below.

## 🐛 Known traps (don't repeat these)

- **2.4.8 — CPU temperature:** never read `thermal_zone0` or any `acpitz` zone as the CPU; it is a constant ~28 °C. Select by hwmon name (coretemp/k10temp/zenpower) or thermal type (x86_pkg_temp/cpu-thermal). Missing sensor = `null` + a note, never 0 or -1. Native (`cpu_temperature.cpp`) and managed (`CpuTemperatureSelection.cs`) must stay in agreement — `CpuTemperatureTests` checks it.
- **2.4.8 — updates:** `stop_services` returning is NOT proof the installer may overwrite files. Use `prepare_for_update` (waits for port/process/file release) and never start the installer when it reports `released: false`. Retry only failures `classifyUpdateError` calls transient (`frontend/src/lib/updateFlow.ts`); failures are logged to `update.log`.
- **2.4.8 — tests:** never assert a specific CPU/GPU/RAM/temperature of the machine running the test. Use fixture trees, fakes and temp dirs; live-host checks assert only universal properties.
- **2.6.5 — PawnIO:** the Windows temperature library needs the PawnIO kernel driver. The release job runs `scripts/fetch-pawnio.mjs` (pinned version + SHA-256, **after** the staging step, which recreates the folder) to put `PawnIO_setup.exe` in `resources/backend/`; `SensorDriverBootstrap` runs it once per app version when elevated, `SensorDriverInstaller` checks the hash first and falls back to winget. To update PawnIO change `VERSION`/`SHA256` in the script and `BundledSha256` in `SensorDriverInstaller.cs` together (the script refuses to run if they differ). It is GPL: keep `THIRD_PARTY_NOTICES.md` shipped and never modify or re-sign the installer.
- **2.6.3 — CPU usage:** `get_cpu_usage_percent` (both platforms) must never sleep per call; it diffs against the previous call and only the first call waits one 200 ms window. Covered by `tests/native/cpu_usage_test.cpp`.
- **2.6.3 — Windows CPU temp:** the sensor library names Intel cores `CPU Core #N` (AMD/others `Core #N`); `CpuSensorSelection` accepts both. A missing reading must carry the specific reason (`ExplainMissingTemperature`), never a number. Do not touch GPU detection/utilization/VRAM/temperature code when working on CPU monitoring.
- **2.6.6 — Windows integrated GPU temp:** the library only builds its Intel GPU group when the CPU group is enabled too, so `LibreHardwareGpuSensorSource` opens `new Computer { IsCpuEnabled = true, IsGpuEnabled = true }` and updates only `GpuIntel`/`GpuAmd` hardware. **Never call `Computer.Close()` on it (or reopen it) while the app runs:** `Close()` runs the library's static `OpCode.Close()`/`Mutexes.Close()`, which nulls delegates the CPU source's own `Computer` uses, so it is closed only in `Dispose` at shutdown. Keep it a separate instance so a graphics-driver fault cannot reach CPU temperatures. The native value always wins; the source is read only while `GpuSensorSelection.Wants` is true for some adapter. Do not widen the sensor choice beyond `GPU Core` (hot spot, memory and regulator sensors are different quantities) and do not add name-based guessing to the pairing.
- **Battery history / data lifecycle (2.6.8):** `BatteryTracker` is a pure, clock-free state machine (a power-source change must last 15 s to count, i.e. two of the 10 s battery readings agree; a reading gap over 5 min is recorded as a gap, and a source change inside a gap makes both neighbouring sessions inexact — never invent when a plug moved). `BatteryHistoryService` observes the sampler's battery reading via `SnapshotLogger` and saves atomically (temp file + move). Anything that deletes or rewrites snapshot files must go through `LocalJsonSnapshotStore` (`ResetData`) because the store buffers lines in memory and caches which folders exist: deleting behind its back makes later writes fail or resurrects deleted lines. The reset endpoint needs the `X-SystemInfo-Action` header (forces a CORS preflight). The reset list never includes `sensor-driver-install.txt`. **The sampler's battery read is gated by `SystemMonitorBackgroundService.BatteryReadDue` with a nullable "last read"; never use `long.MinValue` as a "never" sentinel in a `now - last` check (it overflows negative and the read never happens: that is exactly how the battery silently went unrecorded). `BatteryRecorderTests` runs the real sampler loop with shortened timings and a fake clock; keep it passing when touching the sampler, `SnapshotLogger` or `BatteryHistoryService`.** The recorder reports its latest reading as `watching` in the API and logs events with a `[BatteryHistory]` console prefix.
- **Drive / board / memory sensors (2.6.8):** `HardwareSensorSelection` holds the rules both platforms share (drop 0 °C / −127 °C / 0 V, no estimates, warning/critical entries are limits, not readings). Linux: `LinuxHwmonReader` classifies `/sys/class/hwmon` devices by the name their driver registers (`nvme`, `drivetemp`, `spd5118`/`jc42`, an allow-list of board chip names); CPU, GPU and battery hwmons belong to other pages and must stay out. Windows: `LibreHardwareBoardSensorSource` is a THIRD `Computer` (storage, motherboard, embedded controller, optionally memory; no CPU) with the same rule as the GPU source — opened once, closed only at shutdown, never reopened — and a motherboard's SuperIO chips are `SubHardware` that only report after being updated. DIMM sensing on Windows stays off unless `SYSTEMINFO_DIMM_SENSORS=1` (SMBus access can misbehave on some machines); do not turn it on by default without testing on real hardware. The CPU tab's hottest/busiest core rows are pure functions in `cpu/model.ts`.
- **2.4.8 — polling:** use `scheduleWhenVisible` (lib/visibility.ts) for any new poll loop so hidden windows stop fetching.

- **Never hardcode an API host/port** outside `frontend/src/lib/apiConfig.ts`. Packaged builds get an OS-assigned/non-fixed backend port — a hardcoded `localhost:5132` broke the shipped app once already. Prod uses same-origin relative URLs (`import.meta.env.DEV ? 'http://localhost:5132' : ''`).
- **`wwwroot` copy must happen as a CI shell step before `dotnet publish`**, not an MSBuild `BeforeTargets="Publish"` target — the SDK decides publishable `wwwroot` content at project-evaluation time, before any target runs, so a target-based copy silently ships an empty `wwwroot`.
- **Never manually create a release git tag.** A broken/premature tag permanently blocked a version once under the old multi-workflow (`workflow_run`-linked) chain, which had no atomic tag+release guarantee; the current single `release.yml` with job-level `needs:` fixes this, but don't defeat it by tagging by hand.
- Windows DXGI/system-lib links need an explicit `target_link_libraries(...)` in `CMakeLists.txt` — an MSVC-only `#pragma comment(lib,...)` silently no-ops on other toolchains (e.g. mingw).
- Don't add a generic Tauri command/shell-execution bridge. `commands.rs` intentionally exposes exactly 4 named commands and nothing else.
- **Don't reintroduce a second runtime or a second process for analytics** (Python, Node, anything frozen with PyInstaller-style tooling). It was tried, and cost a PyInstaller build per platform, a hidden-import failure mode that built cleanly but crashed on launch, a second port with its own health check and a proxy hop, and a Job Object workaround — all to run ~800 lines of arithmetic over files the backend already owns. Full account in `PROJECT_STATUS.md`.
- **Never hold a lock across a readiness wait, and never block in a sync Tauri command.** Sync commands run on the UI thread; this froze the window on slow cold starts once. `get_service_status` must stay lock-free and do no I/O.
- **Keep every native export exception-free and bounds-checked.** An exception crossing the `extern "C"` boundary into .NET kills the process. Use the `std::error_code` filesystem overloads, validate buffers, report unknown as `-1`/`0` return — never a fabricated zero.
- **Linux physical RAM goes through a memory-only snapshot.** `/sys/firmware/dmi/tables/DMI` is root-only (it also holds the machine serial/UUID), so the app never reads it as an unprivileged user and never runs `dmidecode`. `si_smbios_snapshot` (root, built by `native/build.sh`, installed by `packaging/linux/install-smbios-snapshot.sh`) saves only Type 16/17 records to `/var/lib/system-info/smbios-memory.bin` with the boot id; `si_dmi_load_table_ex` reads the live table first, then that snapshot, and returns a reason code (`si_get_memory_hardware_status`) that `MemoryMapping.UnavailableNote` turns into the on-screen message. Never widen what the filter copies, and keep the stale-boot check. The snapshot code is covered by `smbios_loader_test`.
- **The SMBIOS parser is shared and byte-buffer driven.** Don't add platform branches inside the Type 16/17 parsing; only `si_dmi_load_table` (platform/<os>/smbios_source.cpp) is platform-specific. Any parser change needs a case in `tests/native/smbios_parse_test.cpp` (hand-built tables; unknown stays `-1`/empty, never a fabricated 0). `smbios_loader_test` `#include`s `hardware_info.cpp`, so it is a standalone target and must not link `systemmonitor_native`.
- **Assembly kernels must stay verified.** Any new or changed kernel needs a C++ reference and a case in `si_kernel_selftest()` covering n = 0, 1, odd lengths, tails and misaligned pointers; SSE2 is the only baseline — AVX2 is reachable only through the CPUID+XGETBV dispatcher.
- **An unbounded query range is a trap.** `ISnapshotStore.QueryAsync(DateTime.MinValue, …)` is legal because the store clamps to the oldest day on disk; don't add code that iterates calendar days itself.
- When zipping the repo for sharing, don't exclude `Engine/Cpp/build*` — it also matches `Engine/Cpp/build.sh`. Leave out the built `libsystemmonitor_native.so` in `backend/SystemMonitor.Api/` too (it is a build output, rebuilt by `Engine/Cpp/build.sh`).

## ⚠️ Unverified / known-limited (check `PROJECT_STATUS.md` before assuming these work)

Windows physical-RAM reader (`si_dmi_load_table` → `GetSystemFirmwareTable('RSMB')` → `si_dmi_extract_rsmb`) and the Windows C# runtime-RAM provider — the shared SMBIOS parser and the header-stripping are unit-tested (`smbios_parse_test`, `smbios_loader_test`, also run as Windows builds under Wine), but the live Windows API call has never returned a real table anywhere (Wine has no DMI source in the authoring sandbox). Linux physical RAM needs the one-time snapshot setup (see README) and degrades to an explained "unavailable" without it. The installer's systemd unit passes `systemd-analyze verify`, but the install/boot flow has not been run on a real systemd machine.

Background/startup behaviour (2.7.3): the Rust shell compiles and the std-only parts (settings, autostart entry, one-instance handshake) have tests, and the installer hook compiles with `makensis` in the template's include order, but the Windows installer page, the tray, hide-on-close and start-at-sign-in have not been run on real Windows or on a real Linux desktop (GNOME needs the AppIndicator extension to show a tray icon). The redesigned Overview/Network/Processes pages and the Overlay Drives tile are covered by view-model tests and a production build, not by looking at them on screen.

Windows battery IOCTL detail + DXGI-linked GPU reads — implemented, not hardware-verified (no Windows/dotnet toolchain in the environment that most recently extended them; Windows cross-compilation via mingw-w64 was verified in isolation only). GPU detection is split across two unreconciled code paths (Windows structured provider vs. Linux native-engine path — see Architecture above). Multi-GPU engine-to-adapter attribution on Windows (parses `_phys_N_` from perf-counter instance names) is unverified against real dual-GPU hardware. No retention/TTL on snapshot storage (grows unbounded — accepted tradeoff, not a bug to silently fix). Automated tests exist for the native/Assembly layer, the C# analytics + native wrappers, and the Rust supervisor, and CI gates releases on them; there are no frontend tests and nothing automatically exercises an *installed* build — the 2.3.0 changes (supervisor rewrite, in-process analytics, new native functions) had not been run from a real installer when this was written. The Windows-only C# (WMI provider) has only ever been compiled by CI. `docs/` is an empty placeholder. No `LICENSE` file.

## 📜 Behavioral contracts (do not break)

- No fabricated hardware values, ever — `Unavailable` is always correct over a guess.
- Fully offline: no account, no cloud backend, no database.
- Windows Job Object hardening must keep guaranteeing no orphaned backend process survives a crash; on Linux the pid-file reaper must keep verifying `/proc/<pid>/exe` before killing anything.
- The backend is the only process the app starts. Analytics stays in-process.
- A failing subsystem degrades `/api/system/all` to partial data with a named `unavailable` entry — it never fails the whole request and never becomes a zero.
- Fresh installation asks about background/startup once; an update never asks and never changes the saved choice. Closing the window must quit unless a background mode is chosen AND the tray exists.
- Update install must cleanly stop all services first, restart fresh after (or restart again if cancelled/failed) — never straddle services across an update.
- CORS stays restricted to the known Tauri/Vite-dev origins listed above — it's the only real access boundary this API has.

---

<div align="center">

See [`README.md`](./README.md) for the project overview and [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) for full engineering history and verification status.

</div>
