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