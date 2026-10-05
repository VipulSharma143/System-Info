# Changelog

All notable changes to SystemInfo are documented here.

## [Unreleased]

### Added

### Changed

### Fixed

### Known Issues


## [2.4.5] - 2026-10-05

### Added
- **GPU page, below RAM.** Lists every graphics adapter the system reports (one, two, three or more) as its own card: name, vendor, integrated/discrete, driver, PCI address, dedicated and shared memory, plus live usage, video-memory use, temperature, power and limit, clocks, fan, voltage and performance state wherever the driver exposes them. Anything a platform does not report shows as "Not reported" instead of a made-up zero.
- **Linux GPU support.** Adapters and telemetry are read from the kernel's DRM/sysfs interfaces (AMD, Intel, nouveau) and from NVIDIA's management library for NVIDIA cards. On Windows, adapters come from WMI/DXGI, per-engine load and video-memory use from performance counters, and NVIDIA telemetry from NVML.
- **GPU hardware is cached.** Adapter details are saved between launches, so the GPU page shows instantly while live values load.

### Changed
- **Simpler connection indicator.** The "updated Ns ago" readout next to the Live status is gone; the indicator now shows only Live, Connecting, Reconnecting or Offline.


## [2.4.4] - 2026-10-05

### Changed
- **Dashboard appears instantly on later launches.** The app now remembers your last CPU, memory, storage, network and battery readings and shows them the moment the window opens, marked as "Connecting" until live values arrive a moment later. The process list is never kept. A cache from another app version, too old, or damaged is discarded and rebuilt automatically.
