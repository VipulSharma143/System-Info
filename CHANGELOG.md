# Changelog

All notable changes to SystemInfo are documented here.

## [Unreleased]

### Added

### Changed

### Fixed

### Known Issues


## [2.4.7] - 2026-10-06

### Added
- **Overlay tab.** One page that shows the CPU and every GPU together, live, for games and heavy work: a "Right now" table at the top (CPU first, then every GPU, then system memory, with usage, temperature, clock, power, memory used and fan side by side so nothing needs scrolling), then a full CPU panel with total usage, a per-core grid (usage, clock and temperature for each logical processor), base/maximum/average/highest clock, package temperature, package power and load average, followed by the full detail card for each GPU. Values a platform cannot report show as "Not reported".
- **CPU detail on both platforms.** Linux reads per-core usage from /proc/stat, clocks from cpufreq, temperatures from coretemp/k10temp (or a thermal zone) and package power from RAPL when the kernel allows it. Windows uses the Processor Information counters for per-core load and live frequency; its temperature is the ACPI thermal zone and is labelled approximate.

### Fixed
- **GPU memory above 100% on laptops with two GPUs.** Windows names the counters of every GPU "_phys_0", so one GPU's figures were mixed into the other's (an Intel Iris Xe showed 648% video memory). Counters are now matched to each adapter by its LUID, obtained from DXGI through a new native `get_gpu_luid` export, and an adapter that cannot be identified shows nothing instead of another GPU's numbers.
- **Integrated GPU memory** is measured against dedicated plus shared memory (it uses system RAM), and every memory percentage is capped at 100%.
- **GPU usage on Windows** is now summed per engine across processes, as Task Manager does, instead of showing the single busiest process.
- **NVIDIA device ID** is now shown on Windows.


## [2.4.5] - 2026-10-05

### Added
- **GPU page, below RAM.** Lists every graphics adapter the system reports (one, two, three or more) as its own card: name, vendor, integrated/discrete, driver, PCI address, dedicated and shared memory, plus live usage, video-memory use, temperature, power and limit, clocks, fan, voltage and performance state wherever the driver exposes them. Anything a platform does not report shows as "Not reported" instead of a made-up zero.
- **Linux GPU support.** Adapters and telemetry are read from the kernel's DRM/sysfs interfaces (AMD, Intel, nouveau) and from NVIDIA's management library for NVIDIA cards. On Windows, adapters come from WMI/DXGI, per-engine load and video-memory use from performance counters, and NVIDIA telemetry from NVML.
- **GPU hardware is cached.** Adapter details are saved between launches, so the GPU page shows instantly while live values load.

### Changed
- **Simpler connection indicator.** The "updated Ns ago" readout next to the Live status is gone; the indicator now shows only Live, Connecting, Reconnecting or Offline.
