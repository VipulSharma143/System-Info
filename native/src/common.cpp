#include "../include/native_engine.h"
#include <chrono>

// Declared here, defined in the .asm files under native/assembly/
extern "C" int get_constant();
extern "C" long long run_benchmark_loop(long long iterations);
extern "C" long long run_benchmark_loop_scalar_compare(long long iterations);
extern "C" long long run_benchmark_loop_simd(long long iterations);

extern "C" {

int add_numbers(int a, int b) {
    return a + b;
}

int call_asm_constant() {
    return get_constant();
}

double run_cpu_benchmark(long long iterations, long long* resultOut) {
    if (resultOut) *resultOut = 0;
    if (iterations <= 0) return 0.0;
    auto start = std::chrono::high_resolution_clock::now();
    long long result = run_benchmark_loop(iterations);
    auto end = std::chrono::high_resolution_clock::now();
    std::chrono::duration<double> elapsed = end - start;

    if (resultOut) *resultOut = result;

    if (elapsed.count() <= 0.0) return 0.0;
    return iterations / elapsed.count();
}

void run_simd_comparison(long long iterations, double* scalarOpsPerSecOut, double* simdOpsPerSecOut)
{
    if (scalarOpsPerSecOut) *scalarOpsPerSecOut = 0.0;
    if (simdOpsPerSecOut) *simdOpsPerSecOut = 0.0;
    if (iterations <= 0) return;
    auto start1 = std::chrono::high_resolution_clock::now();
    run_benchmark_loop_scalar_compare(iterations);
    auto end1 = std::chrono::high_resolution_clock::now();
    std::chrono::duration<double> elapsed1 = end1 - start1;
    if (scalarOpsPerSecOut) *scalarOpsPerSecOut = elapsed1.count() > 0 ? iterations / elapsed1.count() : 0.0;

    long long simdIterations = (iterations / 4) * 4;
    if (simdIterations == 0) return;   // < 4 iterations: nothing for the 4-lane loop to do
    auto start2 = std::chrono::high_resolution_clock::now();
    run_benchmark_loop_simd(simdIterations);
    auto end2 = std::chrono::high_resolution_clock::now();
    std::chrono::duration<double> elapsed2 = end2 - start2;
    if (simdOpsPerSecOut) *simdOpsPerSecOut = elapsed2.count() > 0 ? simdIterations / elapsed2.count() : 0.0;
}

} // extern "C"