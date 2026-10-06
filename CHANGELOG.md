# Changelog

All notable changes to SystemInfo are documented here.

## [Unreleased]

### Added

### Changed

### Fixed

### Known Issues


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
