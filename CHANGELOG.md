# Changelog

All notable changes to SystemInfo are documented here.

## [Unreleased]

### Added

### Changed

### Fixed

### Known Issues

## [2.4.4] - 2026-10-05

### Changed
- **Dashboard appears instantly on later launches.** The app now remembers your last CPU, memory, storage, network and battery readings and shows them the moment the window opens, marked as "Connecting" until live values arrive a moment later. The process list is never kept. A cache from another app version, too old, or damaged is discarded and rebuilt automatically.

## [2.4.3] - 2026-10-04

### Changed
- **Opens even faster after the first launch.** The app now keeps a small cache of your system details (computer model, processor, memory modules, graphics adapters on Windows, and the last storage and battery readings) and shows it immediately next time, while fresh values are read in the background.
- **Safe by design.** If the cache is deleted, damaged or can't be written, the app quietly rebuilds it. After an update, the old cache is discarded so outdated information is never shown.

## [2.4.1] - 2026-10-04

### Changed
- **Faster to open.** The dashboard now appears as soon as your main numbers (CPU, memory, storage and network) are ready. Extra details for the System page, such as your computer's model and graphics card, are no longer waited for on the loading screen. They load the first time you open that page.
- **CPU usage shows up sooner.** The CPU figure now appears within about a second of opening the app, instead of after a few seconds.
- **Tabs load when you need them.** Analytics, Processes, RAM, Storage, Network, Battery, System and Updates are prepared the first time you open them, so the app has less to do at startup and feels lighter.
- **Gentler on your computer.** The app now does less work in the background and saves your history to disk in small batches instead of constantly. Your Analytics history is just as detailed as before.
- **System page opens faster the second time.** Details that never change while the app is running (such as your computer's model and graphics adapters on Windows) are now looked up once and reused.
- **Tidier inside.** We reorganised and cleaned up a large part of the app's internals so future updates are quicker to build and less likely to cause problems. Nothing changes in how the app looks or works.

### Known Issues
- The Windows version of this update has been checked as far as possible without a real Windows PC, but has not been run on one yet. If anything looks off on Windows, please let us know.

## [2.4.0] - 2026-10-02

### Added
- **RAM tab** with a full memory dashboard: usage ring, free/cached/buffers, swap or page file, commit, the installed memory platform (type, speeds, slots, maximum capacity, ECC capability), one card per physical memory module (slot, bank, manufacturer, part number, serial, capacity, speeds, rank, widths, form factor), memory health, and a "detection sources" panel that says where each section's data came from. Loading, partial-data and error states are handled per section, so a failure in one never blanks the page. Nothing is polled while the tab is hidden.
- `GET /api/system/ram` now returns byte-accurate runtime memory (`RamDetails`), `GET /api/system/memory/hardware` returns the physical platform summary plus installed modules, and `GET /api/system/memory/health` returns ECC capability and error counters. A value the platform doesn't report is `null`, never `0`.
- Native physical-memory API: `si_get_memory_module` and `si_get_memory_hardware_summary` parse the raw SMBIOS Type 16/17 tables directly (no `dmidecode`, `wmic` or PowerShell), plus `si_get_memory_module_from_table` / `si_get_memory_hardware_summary_from_table` to parse a caller-supplied table.
- **Windows** physical RAM details, read from the firmware SMBIOS table via `GetSystemFirmwareTable` (no administrator rights needed).
- **Linux physical RAM without running as root.** The firmware table is root-only, so a small helper (`si_smbios_snapshot`, installed with `sudo packaging/linux/install-smbios-snapshot.sh`) saves only the memory records (slots, capacity, speed, manufacturer, part and serial number of the modules; never the machine's own serial or UUID) to `/var/lib/system-info/smbios-memory.bin`, and a systemd service refreshes it at every boot. A snapshot from before the last restart is ignored, and when physical details are missing the RAM tab now says why and what to do instead of one generic message.
- Linux memory error counters (corrected / uncorrected) from the kernel's EDAC interface, shown only when the kernel exposes them.
- `smbios_parse_test` (195 checks) and `smbios_loader_test` (101 checks: the Windows header handling, and the Linux memory-only snapshot including a check that the machine serial and UUID never reach the saved file): the SMBIOS parser against hand-built tables (DDR/DDR2/DDR3/DDR4/DDR5/LPDDR mappings, Type 16 capacity, slot counts, empty slots, rank, speeds, ECC, multiple arrays, truncated and corrupt tables). It needs no hardware and runs identically on Windows and Linux.

### Changed
- `/api/system/ram` response shape changed from megabytes (`RamInfo`) to bytes (`RamDetails`). The old shape had no consumer in the app.
- Runtime RAM reads the native engine first and falls back to the OS's basic counters; the response states which one was used.
- The installed-memory total is reported only when at least one populated module was found and every module's capacity is known, instead of a possible `0`.

### Fixed
- The Windows native build no longer fails to link `memory_hardware_test` (the two physical-memory functions only existed in the Linux build).

### Known Issues
- Physical memory details on Linux need the one-time `install-smbios-snapshot.sh` setup (see the README); until then the RAM tab explains this and runtime usage keeps working. The installer's systemd service passes `systemd-analyze verify` but has not been run on a real systemd machine.
- The Windows SMBIOS reader and the Windows C# RAM provider compile (cross-compiled and reviewed) but have not been run on a real Windows machine yet.
- Memory channel mode always shows "Unknown": the installed module count does not prove how the channels are populated, and no platform source is wired up yet.
- ECC "enabled" status is not reported on any platform; only ECC capability (SMBIOS) and Linux EDAC error counters are.

## [2.3.0] - 2026-09-29

### Added
- Native CPU topology (physical/logical cores, packages), storage-volume and fan-sensor enumeration, and a memory-bandwidth benchmark, exposed as `/api/native/topology`, `/api/native/storage`, `/api/native/fans` and `/api/native/memory-bandwidth`.
- x86-64 Assembly SSE2/AVX2 kernels for int32 min/max, memcpy and a 64-bit XOR checksum, with CPUID/XGETBV runtime dispatch, plus `/api/native/cpufeatures` and `/api/native/kernels` (self-test against a C++ reference and throughput).
- `/api/system/all` reports an additive `unavailable` list naming subsystems that could not be read.
- Test suites for the native/Assembly layer, the C# analytics and managed wrappers, and the Tauri process supervisor; a reusable `tests.yml` workflow that gates the release builds.

### Changed
- Analytics now runs inside the .NET backend. The Python/FastAPI service, its PyInstaller build, port 8001 and the analytics process are gone; `/api/analytics/*` routes and responses are unchanged. The app starts one fewer process and ships no Python runtime.
- Service supervision rewritten: the backend is started on a worker thread, a crashed child is reported immediately instead of after a timeout, a busy port is detected before launching, and leftover processes from a previous crash are cleaned up on Linux. Start/stop no longer run on the UI thread.
- Linux storage lists only real block-device volumes; Linux battery parsing tolerates missing fields and no longer reports 0 for unknown capacities; Windows skips network and optical drives so a disconnected share cannot stall the storage view; both platforms read physical core count from the native layer first.
- Removed obsolete pre-Tauri files (`launcher/`, `SystemInfo.iss`, old installer docs, legacy Linux `AppRun`/desktop file). Version sync now covers four files.

### Fixed
- The window could freeze on launch while the backend was starting (a lock held across the readiness wait blocked the UI thread).
- `run_benchmark_loop_simd` and the SIMD comparison no longer hang for fewer than 4 iterations.
- Native Linux filesystem and battery code no longer throws across the C ABI on unreadable `/sys` entries.

### Known Issues
- Installers (Windows NSIS, Linux `.deb`, AppImage) have not been exercised on real machines for this release; check startup logs under the app's data directory (`logs/startup.log`) after installing.
- Analytics over multi-day windows reads every snapshot line on a cache miss and can take several seconds.

## [2.2.2] - 2026-09-25

### Added

* **Clear, friendly error messages.** When something goes wrong, System Info now shows a simple pop-up that explains what happened and what to do next, instead of technical text. This covers: system information not loading, live updates pausing, graphics details being unavailable, update checks/downloads/installs failing, the speed test failing, and monitoring failing to start or stop. Where it helps, the pop-up has a **Try again** button.
* **Smarter pop-ups.** You will never see the same message stacked several times, and the "Live updates paused" message closes by itself as soon as the connection is back. It also stays quiet when the pause is expected, such as when you stop monitoring yourself or while an update is installing.

### Changed

* **Cleaner, more compact look across every tab.** Spacing, alignment, sizes, borders and cards are now consistent everywhere. More fits on screen, and the Overview tab now shows everything at once on a typical laptop without scrolling.
* **Consistent buttons and controls.** All buttons, the time-range picker in Analytics and the sort options in Processes now look and behave the same way.
* **Better use of small windows.** In a narrow window, the top-bar buttons switch to icons only, cards rearrange to fit, and wide tables scroll inside their own card instead of pushing the whole page sideways.
* **Clearer live status.** The status indicator now shows how fresh your data is, for example "Live · updated just now".
* **Exit confirmation** now uses the same styled pop-up as the rest of the app.
* **Easier to read.** Dimmer text has better contrast in both light and dark themes, and the window title now correctly reads "System Info".

### Fixed

* **Technical messages are no longer shown.** Web addresses, network error text and other developer-style details no longer appear anywhere in the app, even when something fails.
* **Start and Stop no longer fail silently.** If starting or stopping monitoring doesn't work, you are now told.
* **Stray dot next to the Live indicator** has been removed.
* **Previous releases** in the Updates tab now show an arrow so it is clear that each one can be opened.



## [2.2.1] - 2026-09-24

### Changed

* **Update-test release.** No application code changed in this version — it exists only to verify that an installed 2.2.0 finds, downloads and installs a new release from inside the app (Updates tab), stops and restarts all services cleanly, and shows these release notes.


## [2.2.0] - 2026-09-24

### Added

* **In-app updates.** System Info now checks for new releases by itself a few seconds after the dashboard loads (and every 6 hours while it stays open), and a new **Updates** tab lets you check manually, see the installed version's release notes next to the new version's release notes, and install with one click. A green dot on the Updates tab and a dismissible banner announce an available update. An optional "Install updates automatically when found at startup" setting is off by default.
* **Clean restart on update.** Installing an update downloads it first (services keep running), then stops the backend and analytics services, installs, and relaunches — the new version starts every service fresh. If the install fails or is cancelled (for example the Linux password prompt), the services are started again instead of being left stopped.
* **Signed releases.** `release.yml` now signs the Windows installer, the AppImage and the `.deb` with a Tauri updater key (once, in the `release` job — build jobs never see the private key), generates `latest.json` with `scripts/make-update-manifest.mjs`, attaches it to the GitHub Release, and verifies that the manifest and every installer URL it lists are downloadable. The app verifies each download's signature against the public key in `tauri.conf.json` before installing.
* **Updater plugins.** Added `tauri-plugin-updater` and `tauri-plugin-process` (Rust) plus their `@tauri-apps/plugin-*` counterparts, and committed `Cargo.lock` so the crate and npm versions cannot drift apart between CI runs.

### Changed

* **Release preflight.** The `version` job now fails immediately if the updater public key in `tauri.conf.json` is still the placeholder or the `TAURI_SIGNING_PRIVATE_KEY` secret is missing, instead of publishing a release whose installed copies could never update.
* **AppImage stamped for the updater.** The hand-assembled AppImage now has Tauri's bundle-type marker patched in (the `.deb` gets its marker from `tauri build`), so the updater swaps the AppImage in place while `.deb` installs update through `dpkg`.
* **Release notes come from CHANGELOG.md everywhere.** The GitHub Release body, the `notes` field of `latest.json`, and the Updates tab all read the same section.

### Known Issues

* **One-time setup required before the first release with this change:** generate a signing key (`npx tauri signer generate -w ~/.tauri/systeminfo.key`), paste the public key into `plugins.updater.pubkey` in `frontend/src-tauri/tauri.conf.json`, and add the repository secrets `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key has a password). Losing the private key means installed copies can no longer be updated.
* **v2.1.4 and older cannot self-update** — they contain no updater. Install 2.2.0 manually once; every release after it can be installed from inside the app.
* The Rust side compiles (`cargo check`/`cargo build --release`), the frontend type-checks and builds, and signing plus signature verification were checked end to end with a throwaway key. The full download → stop services → install → relaunch cycle has not yet been run on real Windows/Linux machines against a real GitHub Release.


## [2.1.4] - 2026-09-22

### Fixed

* **Linux `.deb`/AppImage required `sudo` and a system-wide `uvicorn`.** The production Linux package previously staged `start-all.sh` — a development script that assumed `/opt/systeminfo/logs` was writable and called `uvicorn` from `PATH` — directly into the installed app, producing `mkdir: cannot create directory '/opt/systeminfo/logs': Permission denied` on a normal run and `start-all.sh: line 141: uvicorn: command not found` even under `sudo`. Linux packaging now goes through the same Tauri 2 pipeline already used for Windows: a self-contained `linux-x64` backend, a PyInstaller-frozen analytics binary, and no dependency on the system's Python/Node toolchain.
* **Linux build opened a browser tab instead of a native window.** `systeminfo` now launches the Tauri desktop shell directly — no `localhost:5173`, no manually opening Firefox/Chrome, and no development server required after installation.

### Changed

* **`release.yml`'s `build-linux` job rewritten** to mirror `build-windows`: native C++ engine → self-contained `linux-x64` backend publish → frontend build → PyInstaller-frozen `analytics` binary → staged as Tauri resources → `npx tauri build`, producing the `.deb` and `.AppImage` from the same `tauri.conf.json` used for the Windows NSIS installer (`bundle.targets` now `["nsis","deb","appimage"]`).
* **`frontend/src-tauri/icons/`** now includes a full desktop icon set (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `icon.icns`) generated from the existing app icon, required by Tauri's Linux/macOS bundlers.

### Known Issues

* The reworked Linux CI job has been reviewed for consistency against the working Windows job and Tauri's documented Linux build prerequisites, but has not yet been run end-to-end on real GitHub Actions infrastructure or installed on a real Linux machine.
* `packaging/linux/AppRun` and `packaging/linux/systeminfo.desktop` are no longer used by the build (Tauri generates its own desktop entry) and are kept only as a deprecated reference.


## [2.1.3] - 2026-09-18

### Added

* **Full-screen startup loading screen.** Added `StartupScreen.tsx` to replace the old inline "Connecting to backend…" message with a full-screen startup checklist covering services, system information, CPU/memory/storage/network, and GPU. The checklist reflects actual data sources rather than pretending that CPU, memory, storage, and network are independent requests, since they are returned together by `/api/system/all`.
* **Shared startup grace period.** Added `STARTUP_GRACE_MS` (35 seconds) in `apiConfig.ts` as the shared startup budget for `useSystemMetrics`, `useSystemGpu`, and `useSystemInfo`, allowing the frontend startup window to exceed Tauri's 30-second backend readiness timeout.
* **Physical CPU core information.** Added `SystemIdentity.PhysicalCores` in the backend and `SystemIdentification.physicalCores` in the frontend. Windows obtains the value from `Win32_Processor.NumberOfCores`, summed across processor sockets, while Linux derives it from `/proc/cpuinfo` grouped by physical processor.
* **64-bit GPU VRAM detection.** Added the native `get_gpu_vram_bytes` export using DXGI's `DXGI_ADAPTER_DESC` to obtain dedicated and shared video memory without relying on WMI's truncated `AdapterRAM` field.
* **System CPU utilization display.** Added a "Current utilization" row to the System tab's "Processor & memory" panel using the existing live CPU utilization value from the metrics API.

### Changed

* **Startup retry and error handling.** `useSystemMetrics`, `useSystemGpu`, and `useSystemInfo` no longer expose the browser's raw `"Failed to fetch"` message during the initial application startup period. Failed requests before the first successful response are treated as temporary startup conditions and retried within the shared 35-second grace period.
* **Post-startup error handling.** Steady-state `error` handling is now reserved for genuine service/API failures occurring after data has successfully loaded once, preserving the existing reconnect/offline behavior for later failures.
* **System information retry behavior.** `useSystemInfo` now continues retrying at a steady 2-second interval after its initial fast retry sequence instead of abandoning startup after the previous approximately 5.4-second retry budget.
* **GPU startup retry behavior.** `useSystemGpu` now uses the shared startup grace period instead of treating three early polling failures as an immediate startup failure.
* **Windows GPU VRAM source.** `WindowsSystemInfoProvider.GetGpus()` now obtains `AdapterMemoryBytes` from DXGI through the native `get_gpu_vram_bytes` implementation rather than relying on WMI's `Win32_VideoController.AdapterRAM`. Multiple adapters are correlated by name when a confident match is available; ambiguous matches are not guessed.
* **System identity API contract.** `/api/system/info` no longer exposes the misleading `coreCount` field. The new `physicalCores` field represents the actual physical CPU core count, while `logicalProcessors` continues to represent logical processors/threads.
* **System startup rendering.** `App.tsx` now keeps the main `AppShell` from mounting until system information, live system metrics, and GPU information have each successfully loaded at least once. The new startup screen handles the initial loading phase instead.

### Fixed

* **GPU VRAM reported below actual capacity.** Fixed the Windows GPU VRAM calculation that could report an incorrect value such as approximately 5 GB for an 8 GB GPU. WMI's `Win32_VideoController.AdapterRAM` is a 32-bit field and can truncate or wrap for adapters with 4 GB or more VRAM. GPU dedicated memory is now obtained from DXGI's 64-bit `DedicatedVideoMemory` value.
* **Physical CPU cores incorrectly reported as logical processors.** Fixed the System tab displaying the logical processor/thread count under the "Physical cores" label. The application now obtains a separate physical-core value from the platform-specific sources described above.
* **"Failed to fetch" displayed during normal startup.** Fixed the frontend treating temporary API connection failures during cold startup as permanent errors. The application now continues loading while the backend and analytics services start and only presents a startup failure after the full grace period expires without a successful initial response.
* **Startup screen appearing before required data is ready.** Fixed the main dashboard mounting while required system, metrics, or GPU data was still unavailable. Initial application rendering now waits for all three required data sources to succeed at least once.

### Known Issues

* **Windows hardware verification pending.** The DXGI GPU VRAM implementation and Windows physical-core query have not yet been build-verified or hardware-tested on a real Windows environment because the development environment used for these changes does not have the required Windows/.NET/MSVC toolchain. Build and test the application on the target Windows hardware before shipping.
* GPU-to-adapter VRAM correlation on multi-GPU systems is name-based because DXGI enumeration order is not guaranteed to match WMI enumeration order. If the application cannot establish a single confident match, the VRAM value remains unavailable rather than guessing.
* GPU engine-to-adapter attribution on multi-GPU systems relies on parsing the `_phys_N_` segment of the performance-counter instance name and remains unverified against a real dual-GPU Windows laptop.
* Backend GPU and System Identity changes introduced in 2.1.2 remain unverified on Windows for the same toolchain/hardware-testing limitation.
* Local storage has no retention/TTL policy yet, so `data/snapshots/` continues to grow over time.
* Code signing is not yet configured for the installer or application binaries.


## [2.1.2] - 2026-09-17

### Added

* **Windows GPU support.** `WindowsSystemInfoProvider.GetGpus()` queries `Win32_VideoController` for every detected display adapter (name, video processor, adapter memory, driver version/date, status, current resolution/refresh rate) — a laptop with integrated + discrete graphics now returns both rather than assuming a single adapter. Live per-engine utilization is sampled from the `GPU Engine` performance-counter category and reported per-engine (3D, Copy, VideoDecode, ...) rather than summed into one fabricated "GPU usage" number, matching the engineering spec's no-fabricated-data policy. New `GET /api/system/gpu` endpoint; new System tab GPU panel(s) in `SystemView.tsx`.
* **Extended System Identity.** `GetSystemIdentity()` on both providers adds manufacturer, model, BIOS version, Windows edition/build, and last-boot time/uptime — Windows via `Win32_ComputerSystem`/`Win32_BIOS`/`Win32_OperatingSystem`, Linux via DMI sysfs (`/sys/class/dmi/id/*`) and `/etc/os-release`/`/proc/uptime`. Each query is independently null-safe so one missing field never blanks the rest of the System tab. Surfaced through `/api/system/info` and the System tab's identity panel.
* `useSystemGpu` hook — polls `/api/system/gpu` on its own interval, separate from the CPU/RAM cycle, with its own scoped error state so a GPU read failure never blocks the rest of the System tab.

### Changed

* `useSystemInfo` now retries `/api/system/info` on a bounded backoff (300ms/600ms/1s/1.5s/2s) instead of surfacing "Failed to fetch" on the very first attempt. Fixes the System tab permanently showing "System identification is unavailable — Failed to fetch" when the backend hadn't finished starting yet at the moment the tab first mounted — previously a single failed request never retried, even once the backend came up a moment later. Also adds a Retry action once the budget is spent.

### Fixed

### Known Issues

* GPU engine-to-adapter attribution on multi-GPU systems relies on parsing the `_phys_N_` segment of the performance counter's instance name; unverified against a real dual-GPU (integrated + discrete) Windows laptop.
* Backend GPU/System Identity changes have not been build-verified on Windows — no `dotnet`/Windows toolchain available in the environment that wrote them. Build and test before shipping.