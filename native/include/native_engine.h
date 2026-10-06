#pragma once

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
NATIVE_API double get_cpu_temperature();
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
NATIVE_API int si_active_isa();                                  // 2 = AVX2 kernels in use, 1 = SSE2
NATIVE_API void si_vec_add_f32(const float* a, const float* b, float* out, long long n);
NATIVE_API float si_dot_f32(const float* a, const float* b, long long n);
NATIVE_API long long si_sum_i32(const int* a, long long n);      // int32 elements, int64 accumulator
NATIVE_API int si_kernel_selftest();                             // 0 = all kernels match the C++ reference
NATIVE_API int si_kernel_benchmark(long long elements, int repeats,
                                   double* addGBps, double* dotGBps, double* sumGBps);

NATIVE_API long long si_minmax_i32(const int* a, long long n, int* minOut, int* maxOut);  // 1 = ok, 0 = invalid args
NATIVE_API int si_memcpy(void* dst, const void* src, long long n);                        // 1 = ok; overlap-safe
NATIVE_API unsigned long long si_xor_u64(const unsigned long long* a, long long nwords);
NATIVE_API int si_memory_bandwidth(long long bytes, int repeats, double* copyGBps, double* readGBps);

// ---------------------------------------------------------------------
// Topology, storage, fans (native/platform/*)
// Unknown values are reported as -1 (or return 0); never a fabricated zero.
// ---------------------------------------------------------------------
// Returns 1 if at least the logical CPU count is known. physicalCores/packages
// stay -1 when the OS does not expose topology (some VMs/containers).
NATIVE_API int si_get_cpu_topology(int* physicalCores, int* logicalCores, int* packages);

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
// Physical RAM / DIMM hardware information (native/platform/*)
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
