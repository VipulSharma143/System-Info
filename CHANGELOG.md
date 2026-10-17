# Changelog

All notable changes to SystemInfo are documented here.

## [Unreleased]


## [2.7.2] - 2026-10-17

### Added
- **Background and startup choice.** System Info now has three ways to behave, chosen by you: *Always run in the background* (closing the window keeps it running in the notification area, so history keeps being recorded), *Do not run in the background* (closing the window quits, as in every earlier version) and *Run automatically at system startup* (starts when you sign in, minimised to the notification area, and keeps running there). A tray icon with Show and Quit appears while a background mode is chosen. If the desktop has no notification area, closing the window still quits, so the app can never become unreachable.
- **Asked once, on a fresh installation only.** The Windows installer shows a new first page with the three choices and stores the answer. On Linux (.deb and AppImage), and on a Windows install that was run silently, the app asks once on its first launch. Updates never ask and never change the choice: an installation that already has data keeps the old behaviour (*Do not run in the background*).
- **System page: Background and startup.** The same three choices as radio buttons, applied immediately and kept between launches. Exit in the top bar and Quit in the tray menu still close the app completely.
- **Drive temperatures on the Overlay page.** A new Drives tile lists every SSD, NVMe and SATA drive that reports a temperature, with its hottest reading, each sensor it has and the drive's own high and critical limits, from the same readings as the Storage page. A drive that reports nothing is explained, not shown as 0.
- One System Info runs per user. Opening it again brings the running window forward (including from the tray) instead of starting a second copy.

### Changed
- **Overview redesigned.** A headline that says how the machine is doing (Normal, Elevated or Critical, using the usual 70% / 90% thresholds) with processes, download, upload and battery next to it; processor and memory as dials with their recent trend; network traffic; the shared activity chart; the heaviest processes with their share of process memory; and storage with a plain "Filling up" or "Almost full" label. The battery tile became a figure in the headline, so the Overview no longer draws a battery trend; the Battery page is unchanged.
- **Network redesigned.** Four headline tiles, a traffic chart with a labelled scale plus peak and average for the visible window, and every interface as a card (active first, busiest first, with its share of traffic). The interface type (Wi-Fi, Ethernet, virtual, loopback) is read from the interface's name only and is labelled as such. The speed test is unchanged.
- **Processes redesigned.** Four headline tiles (running, memory held, heaviest, share held by the top five) and a Grouped view that folds same-named processes into one row you can open to see each PID, next to the flat All view. Sorting and filtering are unchanged. Memory is still the only per-process measurement shown.
- The app window now starts hidden and is shown as soon as the shell is ready, so a sign-in start never flashes it.
- Restarting the app (after Reset data or an update on Linux) now tells the shell first, so the new process waits for the old one instead of being turned away as a second launch.

### Fixed
- Documentation: `AGENT.md`, `README.md` and `PROJECT_STATUS.md` named an unreleased 3.0.0; the battery history, drive/board/memory sensors and Reset data shipped in 2.6.8. They now describe the current implementation.
- `Cargo.lock` was out of date (version 2.6.9 and an unused `ureq` entry); it now matches `Cargo.toml`.
- `scripts/sync-version.mjs` and `check-version.mjs` now also cover `package-lock.json` and `Cargo.lock`, which had drifted from the app version.

### Notes
- The preference lives in `settings.json` in System Info's data folder (`%LOCALAPPDATA%\SystemInfo` on Windows, `~/.local/share/SystemInfo` on Linux). Reset data does not delete it.
- On Linux the tray icon needs the AppIndicator library (the .deb now depends on it) and a desktop that shows tray icons; some GNOME setups need the AppIndicator extension. Without one, closing the window quits.
- Windows start-at-sign-in uses the per-user Run key; Linux uses `~/.config/autostart/systeminfo.desktop`. Uninstalling on Windows removes the Run entry.

### Known Issues
- Not yet run on real hardware: the new Windows installer page, the tray icon and hide-on-close on Windows and on a Linux desktop, start-at-sign-in on both, and the three redesigned pages and the Drives tile on screen. They compile, and the logic behind them is covered by tests, but please look at them on your PC and report what you see.

## [2.7.1] - 2026-10-14

### Changed
- Optimized application performance for faster startup and smoother runtime.
- Reduced unnecessary processing and memory allocations.
- Improved hardware monitoring efficiency across Linux and Windows.
- Optimized background operations to reduce unnecessary system overhead.
- Improved handling of system telemetry and historical data.

### Fixed
- Fixed bugs affecting system monitoring and data collection.
- Improved battery monitoring reliability and reading freshness.
- Fixed issues with malformed or unreadable historical data.
- Improved native component reliability and error handling.
- Fixed inconsistencies in application version metadata.
- Improved overall application stability and reliability across Linux and Windows.

## [2.6.8] - 2026-10-13

### Added
- **Drive temperatures.** The Storage page now has a "Drive temperatures" panel: every SSD, NVMe and SATA drive that reports a temperature, with its model, its readings (for NVMe the composite temperature and each extra sensor) and the drive's own high and critical limits when it gives them. A drive that reports nothing is explained, not shown as blank.
- **Motherboard sensors.** The System page now lists the motherboard's sensor chips (and, on laptops that expose it, the embedded controller or ACPI thermal zone) with their temperatures, voltages and fan speeds. Sensor inputs that are not connected (0 °C or −127 °C, a 0 V rail) are left out instead of shown as readings.
- **Memory module temperatures.** The RAM page now lists the temperature of each memory module that has a thermal sensor (DDR5 SPD hub or a DDR4 thermal sensor), with its SMBus address on Linux.
- **Hottest core and busiest core.** The CPU tab's Temperature panel now shows the hottest core (from the per-core temperature sensors) and the busiest core with its load, its fastest thread's clock and, when the hardware reports one for that core, its temperature. When a value is not available the row says why.
- **Battery charging history.** The Battery page now lists every time the charger was connected and every stretch on battery for the last 7 days: when you plugged in or unplugged, the percentage at the start and end, how much it charged or drained, how long it took, and the speed in % per hour. A summary shows how many times you plugged in, how much was charged in total, the longest time on battery, and how long a full battery lasts at your measured drain (shown only when it can be measured from a stretch of 10 minutes or more with no gaps; otherwise it says "Not enough data"). The Battery page also shows a status line saying whether recording is working and what the battery is doing right now (on battery, charging, full), or why nothing can be recorded (no reading yet, a status such as "Unknown" that does not say whether the charger is connected, or no reading for a while). The backend console logs the first reading and each time the charger is connected or removed.
- **Reset data.** A new "Saved data" panel on the System page has a "Reset data…" button. It asks which data to delete (CPU, GPU, Battery, Network, other cached information, or everything), warns that it cannot be undone, deletes the choice, and restarts System Info. GPU deletes only the cached graphics adapter details, because the app does not store GPU readings over time.
- **Saved data size.** The System page's "Saved data" panel now shows how much disk space System Info's saved data uses (in total and split into saved history, battery charging history, cached information and other files), how many days of history exist and from when to when, and the folder it is stored in. It works the same on Windows and Linux; only the folder differs.

### Fixed
- **The battery was never read by the background sampler, so no battery history could be recorded.** The sampler decided when to read the battery with a starting value that overflowed, which made "is a read due?" false forever. As a result the battery reading never reached the saved history lines (they have never contained a battery entry) or the new charging history, and no `battery` folder was ever created. The battery is now read from the first sample and then every 10 seconds. A battery driver error is also handled on its own, so it can no longer stop the CPU and network history.
- **Quick plug-and-unplug tests now show up.** A change of power source now counts after 15 seconds instead of 45.

### Notes
- Only the battery charging history is limited (to the last 7 days). Everything else System Info saves keeps growing until you delete it with Reset data, and the Saved data panel shows how big it has become.
- On Linux the drive, motherboard and memory sensors are read straight from the kernel (`/sys/class/hwmon`), with no root and no extra software. SATA drive temperatures need the `drivetemp` kernel module, DDR5 memory needs `spd5118` and DDR4 `jc42`; when a module is missing the page names it.
- On Windows they come from LibreHardwareMonitor, in their own library instance that is opened once and closed only when the app exits, so a fault there cannot reach the CPU or GPU temperatures. Drive temperatures need administrator rights, and the page says so when System Info is not running as administrator.
- Memory module temperature on Windows is **off by default**, because reading it talks to the memory modules over the SMBus, which can misbehave on some computers. Set the environment variable `SYSTEMINFO_DIMM_SENSORS=1` and restart System Info to turn it on.
- The sensors are read only while the page that shows them is open.
- The CPU temperature collection itself is unchanged. Per-core temperatures still appear only when the processor, driver and sensor library report them; if your CPU tab shows only the package temperature, the Temperature panel's note says why.
- The battery history is recorded while System Info is running. If the app was closed or the PC was off or asleep, that time is shown as such on the row and counted separately, and when the charger was connected or removed during that time is not guessed. A charger that is seen for less than 15 seconds (a contact that flickers) is ignored; one connected for half a minute is recorded.
- The history is kept in `data/battery/sessions.json`. Reset data never deletes the PawnIO driver install marker or any file System Info did not create.

### Known Issues
- Not yet run on real hardware: the Windows drive, motherboard and memory sensors; the battery history on a real laptop battery; and Reset data with the app restart in the desktop build. The new pages and the reset dialog have been tested as logic and compiled, but not looked at on screen. Please check them on your PC and report what you see.
- The integrated GPU temperature from 2.6.6 still shows "Not reported" on Intel Iris Xe graphics, because that driver exposes no temperature sensor for it (confirmed with the stock LibreHardwareMonitor).


## [2.6.6] - 2026-10-11

### Fixed
- **Integrated GPU temperature on Windows.** An Intel or AMD integrated GPU now shows its temperature on the GPU and Overlay pages when its graphics driver reports one. Before, Windows only had a temperature for NVIDIA GPUs, so integrated GPUs showed none and gave no reason. The value is the "GPU Core" sensor read through LibreHardwareMonitor (Intel through the graphics driver's telemetry, AMD through its driver API). It only fills a gap: a temperature the engine already has is never replaced, a dedicated GPU is never touched, and the CPU temperature path is unchanged. If the driver reports no temperature, the sensor library cannot start, or the adapter cannot be matched with certainty, the page shows no number and says which of those it is. Nothing is estimated or borrowed from another adapter.

### Changed
- **Faster dot-product kernel in the native engine (Assembly).** The AVX2 and SSE2 versions of `si_dot_f32` now add with four independent accumulators instead of one, so the CPU no longer waits on each addition before starting the next. Measured with the new `kernel_bench` on a 2.8 GHz Intel Xeon test machine: AVX2 went from 54 to 123 GB/s on a 16 KB input and from 50 to 95 GB/s on 256 KB; SSE2 from 26 to 94 GB/s and from 26 to 49 GB/s. Inputs larger than the CPU cache are unchanged, because memory speed is the limit there. Floats are now added in a different order, so a result can differ from before in its last digits. No displayed hardware metric uses this kernel, and the portable fallback is untouched.
- The four code-style warnings reported by the linter are gone: helper functions moved out of component files into their own modules. No behaviour or bundle-size change.

### Added
- `kernel_bench`, an opt-in benchmark for every Assembly kernel against its portable fallback at cache-sized and memory-sized inputs (`cmake -DBUILD_NATIVE_BENCH=ON`). It prints numbers only and is not part of the normal tests.
- The kernel self-test now also checks lengths at the 16-, 32- and 64-element block edges that the new dot-product loops depend on.

### Notes
- The sensor library is only started while an integrated Intel or AMD GPU lacks a temperature, so a PC without one (and any Linux PC) never loads it. It samples at most once a second and keeps one small history per adapter.
- It runs in its own library instance, opened once and closed only when the app exits, because closing one instance resets state the CPU temperature reader shares.
- Measured and deliberately left alone: the `sum` kernel is limited by the CPU's shuffle port, not by dependent additions, so unrolling would not help; the `stats` kernel feeds the overlay's displayed averages and is already about 9 times faster than the portable loop on the small inputs it receives; one overlay sample takes about 64-88 microseconds and one uncached CPU-detail document about 187 microseconds, so the C++ collection code needed no change.
- The faster dot-product kernel, the linter cleanup and the benchmark under Changed and Added were prepared before this fix and ship with it. They touch no hardware metric.

### Known Issues
- The integrated GPU temperature has not been run on a real Windows PC yet. Please check an Intel integrated GPU and an AMD processor with integrated graphics, and a laptop with both an integrated and a dedicated GPU (the dedicated GPU's temperature should look exactly as before).
