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