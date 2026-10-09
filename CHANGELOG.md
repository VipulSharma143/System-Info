# Changelog

All notable changes to SystemInfo are documented here.

## [Unreleased]

## [2.5.1] - 2026-10-09

### Fixed
- **Graphics card temperature and usage no longer freeze or show wrong values.** On computers with a separate graphics card, the temperature could stay stuck on one number and the usage could look wrong. Both now update live and follow what the card is really doing.
- **Graphics readings come back on their own.** If the graphics card went to sleep, its driver restarted, or you switched graphics mode, the readings could stay empty until you restarted the app. They now recover automatically.
- **Clearer messages.** When a graphics reading is not available, the app now tells you why instead of leaving it blank.
- **Graphics usage shows up sooner after the app opens.**


## [2.5.0] - 2026-10-08

### Added
- **Overlay is now a compact live performance monitor.** One table at the top shows CPU, every GPU (integrated and discrete as separate rows) and RAM side by side: utilization with a bar and short trend, temperature, and memory (CPU: active threads; GPU: video memory used / total; RAM: used / total with available). A Live indicator shows when samples stop arriving.
- Overlay detail sections below the table: CPU activity (per-processor grid, busy P-core / E-core threads), GPU (utilization, temperature, power, video memory, busiest engines), Memory (used, available, free, cached, buffers, swap / page file).
- Each GPU row says where its numbers came from (NVIDIA driver, Windows counters, kernel), so a wrong-looking GPU can be traced.

### Changed
- The Overlay no longer shows hardware inventory (CPU model, topology totals, memory modules, hardware summary); that stays on the System and RAM pages.
- A metric the platform does not report reads "Unavailable"; 0 is only shown when 0 was measured.

### Fixed
- **Windows hybrid-GPU load.** The GPU load counters were rebuilt on every poll and compared 200 ms apart, which is shorter than the window Windows computes them over, and the busiest 20 engines of the whole PC were kept before the GPUs were separated. Counters now persist between polls so each reading covers a full interval, all engines are kept, and an adapter with counters that are all idle reports a real 0% while one with no counters reports unknown.
- **Stale GPU identity.** A laptop's discrete GPU can get a new LUID when it powers back up, which left its counters unmatched; the LUID is now re-read from DXGI and the counters re-matched.
- Overlay trend lines no longer freeze while a load stays constant.

### Known Issues
- The Windows GPU changes could not be run on a Windows PC here. Verify on the hybrid laptop with a game running: the discrete GPU row should show its load and the "via" label under it.
- Windows CPU temperature is still unavailable without a hardware driver, so that cell reads "Unavailable". Integrated-GPU temperature is generally not exposed on Windows either.

### Added
- **Overlay is now a hardware monitor.** CPU | GPU | RAM summary tiles on top, then expandable CPU, GPU, Memory and Hardware panels. CPU shows utilization, load state, topology (physical cores, logical processors, P-cores / E-cores on hybrid CPUs), active processors and a per-processor grid grouped by core type. GPU shows utilization, temperature, power and used / available / total video memory for every adapter. Memory keeps the operating system's view (used, available, free, cached, buffers, swap / page file) apart from the firmware's view of the physical modules. No clock speeds or fan readings are shown.
- Native `si_get_cpu_logical_info`: per-logical-processor core id and hybrid core class (Linux `/sys/devices/cpu_core|cpu_atom|cpu_lowpower`, Windows `EfficiencyClass`). A CPU that is not hybrid reports no split; the split is never inferred from the model name.
- Windows CPU package power from the "Energy Meter" counters where the platform provides them.
- Tests: native `cpu_logical_test` (parser, fake hybrid `/sys` tree), C# layout checks, frontend overlay model tests.

### Changed
- `/api/system/cpu/detail` gains `layout`, per-core `coreId` / `coreType`, and `systemTemperatureC` / `systemTemperatureSource`. Existing fields are unchanged.

### Fixed
- **Windows no longer labels a firmware thermal zone as the CPU temperature.** The ACPI zone (the source of the constant ~28 °C) is reported as a separate system temperature and never as `packageTemperatureC`; the CPU temperature is "Not reported" on Windows until a real sensor source exists.

### Known Issues
- Windows CPU package / core temperature needs a kernel driver (model-specific registers); the built-in Windows APIs expose only the firmware zone. Not changed here.
- The Windows pieces (hybrid detection, Energy Meter power) were written but not run on a Windows PC; CI builds them.


## [2.4.9] - 2026-10-07

### Added
- **Overlay is now a hardware monitor.** CPU | GPU | RAM summary tiles on top, then expandable CPU, GPU, Memory and Hardware panels.
  - **CPU:** utilization, load state, physical cores, logical processors, P-cores / E-cores on hybrid CPUs, active processors, package temperature, hottest core, package power, and a per-processor grid grouped by core type.
  - **GPU:** every adapter with utilization, temperature, power, and used / available / total video memory.
  - **Memory:** the operating system's view (used, available, free, cached, buffers, swap / page file) kept apart from the firmware's view of the physical modules (slot, capacity, type, manufacturer, part number).
  - **Hardware:** CPU, topology, GPU, RAM, OS, architecture, device, and which telemetry is available.
  - No clock speeds or fan readings are shown.
- Native `si_get_cpu_logical_info`: per-logical-processor core id and hybrid core class (Linux `/sys/devices/cpu_core|cpu_atom|cpu_lowpower`, Windows `EfficiencyClass`). A CPU that is not hybrid reports no split; the split is never guessed from the model name.
- Windows CPU package power from the "Energy Meter" counters where the platform provides them.
- Tests: native `cpu_logical_test` (CPU-list parser, fake hybrid `/sys` tree, live self-consistency check), C# layout checks, and frontend overlay model tests.

### Changed
- `/api/system/cpu/detail` now also returns `layout`, per-core `coreId` / `coreType`, and `systemTemperatureC` / `systemTemperatureSource`. Existing fields are unchanged.
- The overlay only requests data while its tab is open; static data (identity, adapters, memory modules) is fetched once.

### Fixed
- **Windows no longer labels a firmware thermal zone as the CPU temperature.** The ACPI zone (the source of the constant ~28 °C) is now reported separately as a system temperature and never as the CPU package temperature. On Windows the CPU temperature shows "Not reported" with an explanation instead of a made-up number.

### Known Issues
- Windows CPU package and core temperature need a kernel driver (model-specific registers); the built-in Windows APIs expose only the firmware zone, so the CPU temperature stays unavailable on Windows.
- The Windows parts of this release (hybrid core detection, Energy Meter power) have not been run on a real Windows PC; CI builds them.


## [2.4.8] - 2026-10-06

### Fixed
- **Updates now work the first time.** The installer used to start the moment the background service had been told to stop, but the operating system keeps a just-stopped program's files locked for a short while. The first attempt could therefore fail while an immediate Retry (by then the files were free) succeeded. The app now waits until the service's port, process and files are confirmed released before it installs, and never starts the installer on a locked file. Brief network problems while checking or downloading are retried automatically (a few times, with growing pauses); problems that cannot fix themselves (a bad signature, a missing file, a cancelled password prompt, a full disk) are reported immediately and not retried. A finished download is kept, so Retry no longer downloads it again, and a download that arrives short is detected before install. Every failure's full cause is now written to `update.log` in the app's data folder at the moment it happens.
- **CPU temperature stuck near 28 °C.** The app read the first thermal zone the system lists, which on most PCs is a generic firmware zone that sits at a fixed temperature whatever the CPU is doing. It now reads the CPU's own sensor (Intel coretemp, AMD k10temp/zenpower, or a real package thermal zone), reads it fresh every time, and ignores broken readings. If the PC exposes no real CPU sensor, the temperature shows "Not reported" with a reason instead of a made-up number. On Windows, where only the generic zone exists, a zone that never moves while the CPU load swings is recognised and withheld.
- **No more 0% while the first CPU sample is pending.** The CPU endpoint now says "not ready" instead of answering 0%, and every CPU reading carries the time it was measured.
- **Startup-cache write race.** Two writes to the same cache file at the same moment could delete each other's temporary file, losing that write. Each write now uses its own temporary file.

### Changed
- **Overlay tab redesigned.** One compact row of live tiles: CPU, memory and every graphics adapter, each with a big usage number, a short trend, and just the readings that matter (CPU temperature; GPU video memory and temperature). The clock, fan and power sections, the per-core grid and the stacked detail cards are gone.
- **Lighter on your PC.** The app stops polling while its window is minimised or hidden and catches up the moment it is shown again; the update check, analytics and live pages all follow this. The background service uses a non-concurrent, memory-conserving garbage collector (no background GC thread), and the desktop shell is built size-optimised.
- **One native read for the basics.** Memory, CPU ticks and CPU temperature now come from a single call into the native engine (persistent file handles, no per-call allocation worth mentioning) shared by every part of the app that needs them, instead of several separate parses of /proc. Measured on a test machine: the memory read dropped from about 21 µs and 14 KB of allocations to about 10 µs and under 100 bytes, while also returning CPU ticks and temperature.
- **Assembly kept only where it measurably helps.** The vector sum kernel is about 1.2-1.3x faster than the compiler's code; the hand-written memory copy was never faster than the system's own and has been removed, and the vector add shows no measurable gain on the test machine (it is memory-bound) but is kept, as it is verified and costs nothing. If a kernel ever fails its start-up self-check on a given CPU, it is switched off automatically and the app uses plain, safe code instead. Setting `SYSTEMINFO_NO_ASM=1` forces the plain path.
- **Native functions say when they have nothing.** The new temperature and snapshot calls report "available / not available" explicitly rather than returning zero or -1 values that look like readings.

### Added
- Tests that no longer depend on the machine they run on: CPU temperature selection, the host snapshot parsers, the update-release wait, the update retry rules and the polling pause all run against fixture folders, fakes and temporary directories. The suite now has 9 native tests (including a no-assembly run), 638 C# checks, 11 Rust tests and 23 frontend tests, and CI now runs the frontend checks and a no-assembly pass as well.
- `scripts/measure-startup.mjs`: measures cold vs. warm start (with and without the cache), memory and thread count, and can run a long soak that reports memory growth per hour.

### Known Issues
- The Windows parts of this release (updater wait, ACPI zone guard, snapshot reader) have been checked as far as possible without a real Windows PC, but have not been run on one yet. The Tauri shell code itself was syntax-checked but not compiled in the environment used for this release; CI builds it.
- The first-attempt update failure was fixed from the code path rather than reproduced on a real PC. If it still happens, `update.log` now contains the exact cause.


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
