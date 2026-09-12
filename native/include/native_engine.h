#pragma once

extern "C" {

// Cross-platform, implemented in common.cpp
int add_numbers(int a, int b);
int call_asm_constant();
double run_cpu_benchmark(long long iterations, long long* resultOut);
void run_simd_comparison(long long iterations, double* scalarOpsPerSecOut, double* simdOpsPerSecOut);

// Platform-specific — implemented differently in linux_provider.cpp / windows_provider.cpp
int get_cpu_info(char* modelNameOut, int bufferSize);
double get_cpu_usage_percent();
double get_cpu_temperature();
int get_gpu_vendor();
double get_amd_gpu_usage_percent();
int get_fan_rpm();
int get_battery_info_json(char* bufferOut, int bufferSize);
}