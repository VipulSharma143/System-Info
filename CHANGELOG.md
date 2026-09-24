# Changelog

All notable changes to SystemInfo are documented here.

## [Unreleased]

### Added

### Changed

### Fixed

### Known Issues


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