# Changelog

All notable changes to SystemInfo are documented here.

## [Unreleased]

### Added

### Changed

### Fixed

### Known Issues


## [2.1.2] - 2026-09-17

### Added

- **Windows GPU support.** `WindowsSystemInfoProvider.GetGpus()` queries `Win32_VideoController` for every detected display adapter (name, video processor, adapter memory, driver version/date, status, current resolution/refresh rate) — a laptop with integrated + discrete graphics now returns both rather than assuming a single adapter. Live per-engine utilization is sampled from the `GPU Engine` performance-counter category and reported per-engine (3D, Copy, VideoDecode, ...) rather than summed into one fabricated "GPU usage" number, matching the engineering spec's no-fabricated-data policy. New `GET /api/system/gpu` endpoint; new System tab GPU panel(s) in `SystemView.tsx`.
- **Extended System Identity.** `GetSystemIdentity()` on both providers adds manufacturer, model, BIOS version, Windows edition/build, and last-boot time/uptime — Windows via `Win32_ComputerSystem`/`Win32_BIOS`/`Win32_OperatingSystem`, Linux via DMI sysfs (`/sys/class/dmi/id/*`) and `/etc/os-release`/`/proc/uptime`. Each query is independently null-safe so one missing field never blanks the rest of the System tab. Surfaced through `/api/system/info` and the System tab's identity panel.
- `useSystemGpu` hook — polls `/api/system/gpu` on its own interval, separate from the CPU/RAM cycle, with its own scoped error state so a GPU read failure never blocks the rest of the System tab.

### Changed

- `useSystemInfo` now retries `/api/system/info` on a bounded backoff (300ms/600ms/1s/1.5s/2s) instead of surfacing "Failed to fetch" on the very first attempt. Fixes the System tab permanently showing "System identification is unavailable — Failed to fetch" when the backend hadn't finished starting yet at the moment the tab first mounted — previously a single failed request never retried, even once the backend came up a moment later. Also adds a Retry action once the budget is spent.

### Fixed

### Known Issues

- GPU engine-to-adapter attribution on multi-GPU systems relies on parsing the `_phys_N_` segment of the performance counter's instance name; unverified against a real dual-GPU (integrated + discrete) Windows laptop.
- Backend GPU/System Identity changes have not been build-verified on Windows — no `dotnet`/Windows toolchain available in the environment that wrote them. Build and test before shipping.


## [2.1.1] - 2026-09-16

### Added

### Changed

### Fixed

- **Windows child-process console windows.** Fixed the Tauri process manager spawning the backend and analytics services with visible console windows on Windows. The Windows `CREATE_NO_WINDOW` process creation flag is now applied to both managed child processes, keeping the packaged SystemInfo desktop application clean and fully windowed without opening separate command prompt windows.
- **Tauri Windows process spawning.** Added the Windows-specific `CommandExt` integration required to apply native process creation flags while keeping the existing cross-platform process-management implementation unchanged.

### Known Issues

- Windows battery IOCTL support has not been hardware-tested on a real Windows machine — cycle count, designed/full-charge capacity, voltage, and battery health depend on what the installed battery driver exposes.
- Local storage has no retention/TTL policy yet — `data/snapshots/` grows over time.
- Code signing is not yet configured for the installer or application binaries.
