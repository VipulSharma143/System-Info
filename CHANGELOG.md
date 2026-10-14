# Changelog

All notable changes to SystemInfo are documented here.

## [Unreleased]


## [2.7.0] - 2026-10-14

### Added
- **Battery history by date.** The Battery page's charging history now shows one day at a time instead of one long list. A **Date** menu lists only the days that have records (shown as Today, Yesterday, then the weekday and date, with the number of entries), opens on the newest day, and switches the list to the entries recorded on the day you pick. Days are decided in your own time zone, so an entry made late in the evening stays on your evening. An entry that runs past midnight stays on the day it started and its row still shows when it ended. Your pick is kept when new readings arrive; if the day you picked ages out of the 7-day history, the page falls back to the newest day. The latest status line and the summary tiles stay above the list and do not change with the date. Entries whose start time cannot be read are left out instead of being given a guessed date.

### Changed
- **The native engine now lives in a top-level `Engine/` folder.** The C++ source moved from `native/` to `Engine/Cpp/`, the NASM Assembly from `assembly/` to `Engine/Assembly/`, and the native tests from `tests/native/` to `Engine/Cpp/tests/`. One copy of every file; no engine logic changed. Every reference was updated: the CMake file, `build.sh`, `setup.sh`, `setup.ps1`, `clean.sh`, `.gitignore`, the Linux SMBIOS helper installer, both CI workflows, the tests' include paths, and the C# test that looks for the built library. The VS Code setting that pointed at one developer's absolute path now uses the workspace folder.
- **The backend folders are grouped by purpose.** `services/` is now `Services/` with `Platform/{Linux,Windows}`, `Sampling`, `Storage`, `Analytics` and `Memory` beside the existing `Battery`, `Cpu`, `Gpu`, `Overlay`, `Sensors` and `DataLifecycle`, instead of 25 loose files; `interface/` is now `Contracts/`. Files only moved: namespaces, routes and behaviour are the same.
- **The battery is read far less often.** The dashboard asked the hardware for the battery about once a second (a driver enumeration plus IOCTLs on Windows, a sysfs pass on Linux) on top of the history recorder's own read every 10 s. All three readers (the recorder, the dashboard and `/api/system/battery`) now share one reading no more than 3 s old, so the hardware is read at most once every 3 s while the app is open and once every 10 s otherwise. Plug-in and unplug still show within a few seconds.
- **Saved history lines carry the battery only after a new reading**, instead of repeating the same four values on every one-second line. Every other field, the order and the formatting are unchanged, and nothing that reads the history needs the repeated copies (it is optional there already, as on desktops).
- Each saved line is written with a reusable JSON writer instead of building a JSON tree every second, and the day's file path is built once per day. The text written is identical to before (a test compares it byte for byte).
- **Analytics reads each saved line once, as a token stream.** Every line of a day was parsed into a JSON document twice (once by the store to find its timestamp, once more by the analytics code for CPU and network), and the slope maths built two temporary lists per series. Both now read the line as tokens, interface names are shared instead of one string per row, and the slope is computed in two passes with no lists. Measured on a synthetic full day (86,400 rows) on Linux: loading the day from the store 530 ms to about 260 ms, each of the trend, stats and bottleneck calls 1.1-1.9 s to 0.45-0.9 s, and about 22% less memory allocated; the test suite's own full-day trend check went from 2,244 ms to about 520 ms. The results are identical (the serialized output of all three calls was compared before and after), and a line the store rejected before is still rejected.
- **The Linux process list produces about 34 times less garbage.** The dashboard lists the top processes about once a second, and it read every `/proc/<pid>/status` through a stream, a reader and a string per line. Each file is now read once into a stack buffer. Measured with 55 processes: 574 KB to 17 KB allocated per call, same rows in the same order, time per call unchanged (the cost is the system calls). A status file too long for the buffer falls back to the old reader. On Windows the `Process` objects of that list are now disposed.
- **The native storage listing scans once per listing.** `si_get_storage_volume(index)` is asked for index 0, 1, 2... until one is missing, and every call re-read `/proc/mounts` and ran `statvfs` on every mount, so listing N volumes cost N+1 full scans. A listing is now scanned when index 0 is asked for and the later indexes are answered from that same moment (a caller that asks for a later index first, or more than 1.5 s later, gets a fresh scan). Measured with one volume: 62 µs to 30 µs and 24 KB to 12 KB per listing; the saving grows with the number of volumes. Same symbol, same arguments, same data.
- The Battery history panel computes its day groups and summary only when the history actually changes, not on every redraw.

### Fixed
- **A battery that stopped answering was still recorded as current.** The sampler kept passing the last good reading to the charging history every second, so a failed reader looked healthy and the Battery page could never say that readings had stopped. A reading that has not been refreshed for two refresh periods is no longer passed on.
- **Linux battery details could vanish.** The native battery reader pasted the battery's status, model and manufacturer text into JSON without escaping it, so a name containing a quote or a backslash made the document invalid and the whole battery read failed. The text is now escaped. The reader also silently cut the document short when it did not fit the buffer; it now reports an error instead of returning broken JSON. The Windows placeholder gets the same buffer checks.
- `frontend/src-tauri/Cargo.lock` recorded the app as version 3.0.0 while `Cargo.toml` said 2.6.8. It now matches the release version.

### Notes
- Battery collection, API routes and response formats, stored data, the CPU and GPU temperature code, the Assembly kernels and the native ABI are unchanged.
- An audit of the frontend found every timer, listener and polling loop already cleaned up when its page closes, so no performance changes were made there beyond the history panel. The native calls the backend makes repeatedly (memory, battery, CPU temperature, overlay and host snapshots) were timed and are already cheap (microseconds, most with no allocations), so they were left alone apart from the storage listing above.
- The timings above are from a Linux sandbox with synthetic data and are not a benchmark of the whole app; the Windows paths were not measured.

### Known Issues
- Built and run for this release: the native engine from its new location (16 native tests, including new ones for the battery JSON and the storage listing, plus the no-Assembly run); the frontend type check, lint, production build and 104 tests; and the backend test runner on .NET 8 (820 checks, including new ones for the shared battery read, the saved line format, the stopped-reader case and the line readers). Not run: the .NET 10 build of the backend project itself, the Windows build and its battery code, the installers, CI, and the Date menu on screen.

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
