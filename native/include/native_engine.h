#pragma once

#ifdef _WIN32
#define NATIVE_API extern "C" __declspec(dllexport)
#else
#define NATIVE_API extern "C"
#endif

// Cross-platform, implemented in common.cpp
NATIVE_API int add_numbers(int a, int b);
NATIVE_API int call_asm_constant();
NATIVE_API double run_cpu_benchmark(long long iterations, long long* resultOut);
NATIVE_API void run_simd_comparison(long long iterations, double* scalarOpsPerSecOut, double* simdOpsPerSecOut);

// Platform-specific — implemented differently in linux_provider.cpp / windows_provider.cpp
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

// ---------------------------------------------------------------------
// CPU features + Assembly kernels (simd_dispatch.cpp / vector_kernels.asm)
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
// Topology, storage, fans (hardware_info.cpp)
// Unknown values are reported as -1 (or return 0); never a fabricated zero.
// ---------------------------------------------------------------------
// Returns 1 if at least the logical CPU count is known. physicalCores/packages
// stay -1 when the OS does not expose topology (some VMs/containers).
NATIVE_API int si_get_cpu_topology(int* physicalCores, int* logicalCores, int* packages);

// Enumerate real (block-device) volumes: call with index = 0, 1, 2... until 0 is returned.
// Byte counts are 64-bit; freeBytes is the space available to an unprivileged user.
NATIVE_API int si_get_storage_volume(int index, char* mountOut, int mountSize, char* fsOut, int fsSize,
                                     long long* totalBytes, long long* freeBytes);

// Enumerate fan tachometers: index = 0, 1, 2... until 0 is returned. No fans, or a
// platform with no API (Windows), simply yields 0 on the first call.
NATIVE_API int si_get_fan(int index, char* labelOut, int labelSize, int* rpmOut);
