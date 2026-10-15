#pragma once

#include <stdint.h>

#ifdef _WIN32
#define NATIVE_API extern "C" __declspec(dllexport)
#else
#define NATIVE_API extern "C" __attribute__((visibility("default")))
#endif

// Cross-platform, implemented in common.cpp
NATIVE_API int add_numbers(int a, int b);
NATIVE_API int call_asm_constant();
NATIVE_API double run_cpu_benchmark(long long iterations, long long* resultOut);
NATIVE_API void run_simd_comparison(long long iterations, double* scalarOpsPerSecOut, double* simdOpsPerSecOut);

// Platform-specific — implemented per OS in platform/linux/ and platform/windows/
NATIVE_API int get_cpu_info(char* modelNameOut, int bufferSize);
NATIVE_API double get_cpu_usage_percent();
// Legacy: CPU package temperature in Celsius, or -1.0 when no CPU sensor exists. Prefer si_cpu_temperature(), which
// says WHY there is no value and which sensor produced it.
NATIVE_API double get_cpu_temperature();

// Live CPU package temperature. Returns 1 and fills *celsiusOut / sourceOut ("coretemp", "k10temp", "thermal-zone",
// ...) when a real CPU sensor was read; 0 when the machine exposes none (virtual machines, Windows, locked-down
// kernels) — *celsiusOut is then 0 and must be ignored; -1 for invalid arguments. Generic firmware zones (acpitz)
// are never reported as the CPU. Every call reads the kernel; only the choice of sensor file is cached.
NATIVE_API int si_cpu_temperature(double* celsiusOut, char* sourceOut, int sourceCap);

// Same, against an alternative sysfs root (tests build a fake tree in a temporary directory).
NATIVE_API int si_cpu_temperature_at(const char* sysRoot, double* celsiusOut, char* sourceOut, int sourceCap);
NATIVE_API int get_gpu_vendor();
NATIVE_API double get_amd_gpu_usage_percent();
NATIVE_API int get_fan_rpm();
NATIVE_API int get_battery_info_json(char* bufferOut, int bufferSize);

// Dedicated/shared VRAM for the adapter at adapterIndex, read via DXGI's
// DXGI_ADAPTER_DESC (SIZE_T fields — correct on 4GB+ cards, unlike WMI's
// 32-bit Win32_VideoController.AdapterRAM). Callers loop adapterIndex =
// 0, 1, 2, ... until this returns 0 (no such adapter / DXGI unavailable).
// On success, nameOut receives the adapter's DXGI description string and
// the function returns 1.
NATIVE_API int get_gpu_vram_bytes(int adapterIndex, char* nameOut, int nameBufferSize,
                                   long long* dedicatedBytesOut, long long* sharedSystemBytesOut);

// Locally unique identifier (LUID) of the DXGI adapter at adapterIndex, packed as (high << 32) | low. Windows'
// "GPU Engine" / "GPU Adapter Memory" performance counters name their instances by LUID, so this is the only
// reliable way to attribute counters to an adapter on a multi-GPU machine. Returns 1 on success, 0 otherwise.
NATIVE_API int get_gpu_luid(int adapterIndex, long long* luidOut);

// ---------------------------------------------------------------------
// CPU features + Assembly kernels (simd_dispatch.cpp / math/vector_math.asm, memory/memory_kernels.asm)
// ---------------------------------------------------------------------
// Bitmask returned by si_get_cpu_features(). A bit is set ONLY when the CPU
// reports the feature and (for AVX-family) the OS has enabled YMM state.
#define SI_FEAT_SSE    (1LL << 0)
#define SI_FEAT_SSE2   (1LL << 1)
#define SI_FEAT_SSE3   (1LL << 2)
#define SI_FEAT_SSSE3  (1LL << 3)
#define SI_FEAT_SSE41  (1LL << 4)
#define SI_FEAT_SSE42  (1LL << 5)
#define SI_FEAT_AVX    (1LL << 6)
#define SI_FEAT_AVX2   (1LL << 7)
#define SI_FEAT_FMA    (1LL << 8)

NATIVE_API long long si_get_cpu_features();
NATIVE_API int si_get_cpu_vendor(char* out, int size);          // "GenuineIntel", "AuthenticAMD", ...
NATIVE_API int si_active_isa();                                  // 2 = AVX2 asm, 1 = SSE2 asm, 0 = portable C++ (no/disabled/demoted asm)
NATIVE_API void si_force_portable(int on);                       // 1 = never use assembly (also: env SYSTEMINFO_NO_ASM=1)
NATIVE_API int si_asm_demotions();                               // tiers the startup selftest rejected; 0 on a healthy machine
NATIVE_API void si_vec_add_f32(const float* a, const float* b, float* out, long long n);
NATIVE_API float si_dot_f32(const float* a, const float* b, long long n);
NATIVE_API long long si_sum_i32(const int* a, long long n);      // int32 elements, int64 accumulator
NATIVE_API int si_kernel_selftest();                             // 0 = all kernels match the C++ reference
NATIVE_API int si_kernel_benchmark(long long elements, int repeats,
                                   double* addGBps, double* dotGBps, double* sumGBps);

NATIVE_API long long si_minmax_i32(const int* a, long long n, int* minOut, int* maxOut);  // 1 = ok, 0 = invalid args
NATIVE_API int si_memcpy(void* dst, const void* src, long long n);                        // 1 = ok; overlap-safe
// Layout shared with Engine/Assembly/math/stats_kernels.asm.
struct SiStatsF32 { float sum; float max; float threshold; int count; };

// Sum, maximum and count of values >= threshold over n floats (non-finite values are treated as 0).
// Assembly (AVX2 / SSE2) with the same demotion rules as the other kernels. Returns 1 on success.
NATIVE_API int si_stats_f32(const float* a, long long n, float threshold, double* sumOut, double* maxOut, long long* countOut);
// ---------------------------------------------------------------------
// Series engine (src/series_engine.cpp over Engine/Assembly/analytics/): statistics, trend and threshold scans over
// double-precision series, the maths behind the Analytics page. Every function runs on the assembly tier selected for the
// other kernels (AVX2 -> SSE2 -> portable C++, same selftest and demotion rules, same kill switch) and gives the same
// answers on every tier. No function allocates, and none reads outside [a, a + n).
// ---------------------------------------------------------------------
// Layout shared with Engine/Assembly/analytics/series_stats.asm.
struct SiSeriesStats { double sum; double min; double max; };

// Sum, smallest and largest of n doubles. The values must not contain NaN (filter missing samples first).
// Returns 1 on success, 0 for n <= 0 or a null pointer. The sum is reassociated (SIMD lanes): it can differ from a
// left-to-right sum in the last bits.
NATIVE_API int si_series_stats(const double* a, long long n, SiSeriesStats* out);

// Least-squares slope of y against x (change of y per unit of x) over n points; neither array may contain NaN.
// The points are shifted by the first one internally, so a large offset in x or y does not cost accuracy.
// Returns 1 and *slopeOut, or 0 when there is no slope (n < 2, all x equal, or non-finite sums).
NATIVE_API int si_series_slope(const double* x, const double* y, long long n, double* slopeOut);

// Number of values >= threshold. A NaN is never >= threshold.
NATIVE_API long long si_series_count_ge(const double* a, long long n, double threshold);

// Runs of at least minLen consecutive values >= threshold (a NaN ends a run), as inclusive [start, end] index pairs written
// to out[2*k], out[2*k+1] for k < capPairs. Returns the number of runs found, which can exceed capPairs: allocate that many
// pairs and call again.
NATIVE_API long long si_series_find_runs(const double* a, long long n, double threshold, long long minLen,
                                         long long* out, long long capPairs);

// Indexes i (ascending) with a[i] >= threshold and, when skip is not null, skip[i] == 0. Returns how many there are; only
// the first cap are written.
NATIVE_API long long si_series_collect_ge(const double* a, long long n, double threshold, const unsigned char* skip,
                                          long long* outIdx, long long cap);

// ---------------------------------------------------------------------
// Saved-history reader (src/series_parse.cpp): turns the text of a day's snapshot file (one JSON object per line, as the
// backend writes them) into dense arrays, so the Analytics page does not have to parse hundreds of thousands of lines in
// managed code. It reads exactly what the managed reader reads: every line must be complete, valid JSON (anything else is
// counted in `malformed` and left out), the first top-level "timestamp" is the line's time, the last numeric
// "cpuUsedPercent" is its CPU load, and every object in "network" is one interface entry. Lines outside
// [fromTicks, toTicks] are left out. It never guesses: anything it does not handle exactly (an unusual timestamp format,
// text that is not valid UTF-8, a number outside the double range, UTF-16 files, too many distinct interface names) returns 0
// and the caller reads the file the managed way instead.
// ---------------------------------------------------------------------
struct SiSeriesBatch {
    // Buffers supplied by the caller. netStart needs rowCap + 1 entries.
    long long* ticks;        // UTC ticks (100 ns since 0001-01-01), one per accepted row
    double*    cpu;          // CPU percent per row, NaN when the line has no numeric "cpuUsedPercent"
    int*       netStart;     // row r owns entries [netStart[r], netStart[r + 1])
    int*       netIface;     // index into the name table, per network entry
    double*    rx;           // NaN when missing or not a number
    double*    tx;
    char*      names;        // interface names, UTF-8, each followed by a NUL, in order of first appearance
    long long  rowCap, netCap, namesCap;
    // Results.
    long long  rows, netEntries, nameCount, namesBytes, malformed;
};

// 1 = ok. 0 = not handled exactly: read the file the managed way. -1 = a buffer was too small: rows / netEntries /
// namesBytes hold the sizes needed, call again with at least those. Lines are separated by \n, \r or \r\n and blank lines are
// ignored, like the managed reader. The data pointer must stay valid for the call; nothing is retained.
NATIVE_API int si_series_parse_lines(const unsigned char* data, long long len, long long fromTicks, long long toTicks, SiSeriesBatch* batch);

// ---------------------------------------------------------------------
// Overlay engine (src/overlay/): one background thread samples CPU, every GPU and RAM and publishes a single JSON
// snapshot with a short history per series. See overlay_engine.cpp for the schema.
// ---------------------------------------------------------------------
// intervalMs > 0: sample on a background thread (idle heartbeat of 2 s when nobody reads snapshots).
// intervalMs == 0: manual mode, a sample happens only in si_overlay_sample_now() (tests).
// root: "" in production; tests pass a directory holding a fake proc/ and sys/ tree. Returns 1.
NATIVE_API int si_overlay_start(int intervalMs, const char* root);
NATIVE_API void si_overlay_stop();
NATIVE_API int si_overlay_sample_now();                                  // 1 = sampled, 0 = engine not running
// Latest snapshot as UTF-8 JSON. Returns its length; 0 when no sample exists yet; -(needed bytes) when the buffer is too small.
NATIVE_API int si_overlay_snapshot_json(char* buffer, int capacity);

// ---------------------------------------------------------------------
// CPU detail (src/cpu_detail.cpp): everything the CPU tab shows that the overlay engine does not sample — identity,
// topology (physical cores, hybrid P/E split), clock range, caches, instruction sets, per-core sensors, power, frequency
// policy, thermal-throttle counters, time breakdown and scheduler counters — as one UTF-8 JSON document. A value the
// platform cannot report is null, never 0. Live per-processor load/clock and the headline CPU temperature are NOT in it:
// they come from the overlay engine so both screens agree.
// Returns the length written; 0 when nothing could be read; -(needed bytes) when `capacity` is too small. Calls less
// than 300 ms apart return the same document (rates need a real interval).
// ---------------------------------------------------------------------
NATIVE_API int si_cpu_detail_json(char* buffer, int capacity);
// Tests only: read a fake tree (a directory holding proc/ and sys/) instead of the machine; "" restores the real one.
NATIVE_API void si_cpu_detail_set_root(const char* root);

NATIVE_API unsigned long long si_xor_u64(const unsigned long long* a, long long nwords);
NATIVE_API int si_memory_bandwidth(long long bytes, int repeats, double* copyGBps, double* readGBps);

// ---------------------------------------------------------------------
// Topology, storage, fans (Engine/Cpp/platform/*)
// Unknown values are reported as -1 (or return 0); never a fabricated zero.
// ---------------------------------------------------------------------
// Returns 1 if at least the logical CPU count is known. physicalCores/packages
// stay -1 when the OS does not expose topology (some VMs/containers).
NATIVE_API int si_get_cpu_topology(int* physicalCores, int* logicalCores, int* packages);

// One logical processor, `index` = 0, 1, 2... in the OS's own order (Linux: ascending CPU number among online CPUs;
// Windows: ascending processor group, then number). Returns 1 while `index` is valid, 0 past the end.
//   coreId          opaque id shared by SMT siblings of one physical core; -1 if the OS does not say.
//   efficiencyClass 0 = slowest class ... classCount-1 = fastest, for hybrid CPUs (Intel P/E cores) only.
//                   -1 when the CPU is not hybrid or the OS does not expose the split. Never guessed.
//   classCount      number of distinct classes (2 on Alder Lake), or -1 together with efficiencyClass.
// Linux: /sys/devices/cpu_core, cpu_atom, cpu_lowpower.  Windows: GetLogicalProcessorInformationEx EfficiencyClass.
NATIVE_API int si_get_cpu_logical_info(int index, int* coreId, int* efficiencyClass, int* classCount);

// Enumerate real (block-device) volumes: call with index = 0, 1, 2... until 0 is returned.
// Byte counts are 64-bit; freeBytes is the space available to an unprivileged user.
NATIVE_API int si_get_storage_volume(int index, char* mountOut, int mountSize, char* fsOut, int fsSize,
                                     long long* totalBytes, long long* freeBytes);

// RAM / swap / commit snapshot. All values are bytes (64-bit).
// A value the OS does not expose is -1 (never a fabricated 0).
// Returns 1 if at least totalBytes and availableBytes are known, else 0.
// Linux: from /proc/meminfo.  Windows: GlobalMemoryStatusEx + GetPerformanceInfo.
NATIVE_API int si_get_memory_info(long long* totalBytes, long long* availableBytes,
                                  long long* freeBytes, long long* cachedBytes,
                                  long long* buffersBytes, long long* swapTotalBytes,
                                  long long* swapUsedBytes, long long* commitLimitBytes,
                                  long long* commitUsedBytes);


// ---------------------------------------------------------------------
// Physical RAM / DIMM hardware information (Engine/Cpp/platform/*)
// ---------------------------------------------------------------------
//
// Runtime memory usage belongs to si_get_memory_info().
// These APIs describe the physical memory modules installed in the system.
//
// Enumeration:
//   index = 0, 1, 2, ... until the function returns 0.
//
// Unknown/unavailable numeric values are -1.
// Unknown/unavailable strings are empty.
//
// On systems where the OS does not expose DIMM-level information,
// the function returns 0 rather than fabricating hardware details.
//
// Windows:
//   Reads the raw SMBIOS table via GetSystemFirmwareTable('RSMB').
//   No WMI, wmic or PowerShell.
//
// Linux:
//   Uses DMI/SMBIOS information exposed through sysfs (/sys).
//
// Some fields may require elevated privileges on Linux.
//

NATIVE_API int si_get_memory_module(
    int index,
    char* manufacturerOut,
    int manufacturerSize,
    char* partNumberOut,
    int partNumberSize,
    char* serialNumberOut,
    int serialNumberSize,
    char* locatorOut,
    int locatorSize,
    char* bankLocatorOut,
    int bankLocatorSize,
    char* formFactorOut,
    int formFactorSize,
    char* memoryTypeOut,
    int memoryTypeSize,
    long long* capacityBytesOut,
    long long* speedMTsOut,
    long long* configuredSpeedMTsOut,
    int* dataWidthOut,
    int* totalWidthOut,
    int* rankOut,
    int* eccOut
);

// Summary of the physical RAM configuration.
//
// installedBytes:
//   Sum of all populated memory modules.
//
// moduleCount:
//   Number of populated modules discovered.
//
// slotCount:
//   Number of physical memory slots reported by the firmware.
//
// maxCapacityBytes:
//   Maximum RAM capacity reported by the platform firmware.
//
// maxModuleCapacityBytes:
//   Maximum capacity of a single module when exposed by firmware.
//
// Unknown values are -1.
// installedBytes is only reported when at least one populated module was found
// and every module's capacity is known (never a fabricated 0).
// Returns 1 when the firmware's memory description was read (individual values
// may still be -1, e.g. the slot count), otherwise 0.
NATIVE_API int si_get_memory_hardware_summary(
    long long* installedBytesOut,
    int* moduleCountOut,
    int* slotCountOut,
    long long* maxCapacityBytesOut,
    long long* maxModuleCapacityBytesOut
);

// Why physical memory details are or are not available right now.
//   0 = available
//   1 = this system has no firmware memory table (many VMs, some ARM boards)
//   2 = a table exists but this user may not read it (Linux: root-only)
//   3 = a saved snapshot exists but is from before the last restart
//   4 = a table exists but could not be read / is not valid SMBIOS
// Cheap enough to call only when the details are unavailable.
NATIVE_API int si_get_memory_hardware_status();

// Linux, run as root: saves ONLY the memory records (SMBIOS Type 16/17) of the
// firmware table to `path` (null/empty = the default location) so the
// unprivileged app can read them. Nothing else from the table (serial number,
// UUID, ...) is copied. The file is world-readable and written atomically.
// Returns 1 on success, otherwise:
//   -1 not allowed to read the firmware table (not running as root)
//   -2 this system has no firmware table
//   -3 the table has no memory records / could not be read
//   -4 the snapshot file could not be written
//   -5 not supported on this platform (Windows needs no snapshot)
NATIVE_API int si_write_memory_smbios_snapshot(
    const char* path
);

// Same two APIs, but parsing a caller-supplied SMBIOS *structure table*
// (a run of Type N records, no container header) instead of the live
// firmware table. Platform independent: used by the unit tests with
// hand-built tables, and usable by any provider that already holds a table.
// A null or empty table yields "unavailable" (0); it never falls back to
// the live system table.
NATIVE_API int si_get_memory_module_from_table(
    const unsigned char* table,
    int tableSize,
    int index,
    char* manufacturerOut, int manufacturerSize,
    char* partNumberOut, int partNumberSize,
    char* serialNumberOut, int serialNumberSize,
    char* locatorOut, int locatorSize,
    char* bankLocatorOut, int bankLocatorSize,
    char* formFactorOut, int formFactorSize,
    char* memoryTypeOut, int memoryTypeSize,
    long long* capacityBytesOut,
    long long* speedMTsOut,
    long long* configuredSpeedMTsOut,
    int* dataWidthOut,
    int* totalWidthOut,
    int* rankOut,
    int* eccOut
);

NATIVE_API int si_get_memory_hardware_summary_from_table(
    const unsigned char* table,
    int tableSize,
    long long* installedBytesOut,
    int* moduleCountOut,
    int* slotCountOut,
    long long* maxCapacityBytesOut,
    long long* maxModuleCapacityBytesOut
);

// Enumerate fan tachometers: index = 0, 1, 2... until 0 is returned. No fans, or a
// platform with no API (Windows), simply yields 0 on the first call.
NATIVE_API int si_get_fan(int index, char* labelOut, int labelSize, int* rpmOut);

// ---------------------------------------------------------------------
// Compact host snapshot (host_snapshot.cpp): CPU ticks, memory and CPU temperature in ONE call.
// ---------------------------------------------------------------------
// valid_mask says which fields are real. A clear bit means the platform cannot report that field and its value is 0
// and MUST be ignored — never shown as zero. Ticks are cumulative; callers subtract two snapshots for usage:
//   usage% = (busy2 - busy1) * 100 / (total2 - total1). The tick unit differs per OS (jiffies / 100 ns) and cancels out.
#define SI_SNAP_CPU_TICKS (1u << 0)
#define SI_SNAP_MEMORY    (1u << 1)
#define SI_SNAP_SWAP      (1u << 2)
#define SI_SNAP_CPU_TEMP  (1u << 3)

typedef struct SiHostSnapshot {
    uint32_t struct_size;        // caller sets sizeof(SiHostSnapshot); a mismatch is rejected, never guessed at
    uint32_t valid_mask;         // SI_SNAP_* bits
    double   cpu_temperature_c;  // valid when SI_SNAP_CPU_TEMP
    uint64_t cpu_busy_ticks;     // valid when SI_SNAP_CPU_TICKS
    uint64_t cpu_total_ticks;
    uint64_t mem_total_kb;       // valid when SI_SNAP_MEMORY
    uint64_t mem_available_kb;
    uint64_t mem_free_kb;
    uint64_t swap_total_kb;      // valid when SI_SNAP_SWAP
    uint64_t swap_free_kb;
    uint64_t sampled_unix_ms;    // always set: when this snapshot was taken
} SiHostSnapshot;

// Returns 1 when at least one field is valid, 0 when none could be read, -1 for a null pointer or struct_size mismatch.
NATIVE_API int si_read_host_snapshot(SiHostSnapshot* out);
NATIVE_API unsigned int si_host_snapshot_size();
