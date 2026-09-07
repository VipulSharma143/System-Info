// ============================================================
// System Monitor — Native C++ Engine
// Reads low-level Linux system info (CPU, temperature, GPU vendor)
// Exposed to C# via P/Invoke (extern "C" functions at the bottom)
// ============================================================

#include <fstream>
#include <sstream>
#include <string>
#include <cstring>
#include <vector>
#include <unistd.h>
#include <filesystem>

namespace fs = std::filesystem;

// ------------------------------------------------------------
// Internal helpers (C++ linkage — not exposed to C#)
// ------------------------------------------------------------

// Aggregate CPU jiffies read from /proc/stat: idle time + total time.
// Used to compute a usage percentage between two samples.
struct CpuTimes {
    long long idle;
    long long total;
};

CpuTimes read_cpu_times() {
    std::ifstream file("/proc/stat");
    std::string line;
    std::getline(file, line); // first line = aggregate "cpu" line

    std::istringstream iss(line);
    std::string cpuLabel;
    iss >> cpuLabel; // discard the leading "cpu" label

    std::vector<long long> values;
    long long val;
    while (iss >> val) {
        values.push_back(val);
    }

    long long idle = values.size() > 3 ? values[3] : 0;
    long long total = 0;
    for (auto v : values) total += v;

    return { idle, total };
}

// Declared here, defined in assembly/get_constant.asm
extern "C" int get_constant();
// Declared here, defined in assembly/benchmark_loop.asm
extern "C" long long run_benchmark_loop(long long iterations);
extern "C" long long run_benchmark_loop_scalar_compare(long long iterations);
extern "C" long long run_benchmark_loop_simd(long long iterations);
// ------------------------------------------------------------
// Functions exposed to C# via P/Invoke
// ------------------------------------------------------------

extern "C" {

// Simple proof-of-concept function used to validate the C# <-> C++ pipeline.
int add_numbers(int a, int b) {
    return a + b;
}

// Reads /proc/cpuinfo, fills modelNameOut with the CPU model name (null-terminated,
// truncated to bufferSize if needed), and returns the number of logical cores found.
int get_cpu_info(char* modelNameOut, int bufferSize) {
    std::ifstream file("/proc/cpuinfo");
    std::string line;
    std::string modelName = "Unknown";
    int coreCount = 0;

    while (std::getline(file, line)) {
        if (line.rfind("model name", 0) == 0 && modelName == "Unknown") {
            size_t colonPos = line.find(':');
            if (colonPos != std::string::npos) {
                modelName = line.substr(colonPos + 2); // skip ": "
            }
        }
        if (line.rfind("processor", 0) == 0) {
            coreCount++;
        }
    }

    std::strncpy(modelNameOut, modelName.c_str(), bufferSize - 1);
    modelNameOut[bufferSize - 1] = '\0'; // ensure null-termination even if truncated

    return coreCount;
}

// Returns overall CPU usage percent, sampled over a ~200ms window via /proc/stat.
// Mirrors the C# implementation for direct comparison purposes.
double get_cpu_usage_percent() {
    CpuTimes sample1 = read_cpu_times();

    usleep(200000); // ~200ms sample window

    CpuTimes sample2 = read_cpu_times();

    long long idleDelta = sample2.idle - sample1.idle;
    long long totalDelta = sample2.total - sample1.total;

    if (totalDelta == 0) return 0.0;
    return (1.0 - (double)idleDelta / totalDelta) * 100.0;
}

// Returns CPU package temperature in Celsius, read from the first thermal zone.
// Returns -1.0 if the sysfs path is unavailable (e.g. unsupported hardware/VM).
double get_cpu_temperature() {
    std::ifstream file("/sys/class/thermal/thermal_zone0/temp");
    if (!file.is_open()) return -1.0;

    long milliDegrees;
    file >> milliDegrees;

    return milliDegrees / 1000.0; // sysfs reports millidegrees Celsius
}

// Scans /sys/class/drm for the first real "cardN" entry (skipping connector
// sub-entries like "card1-HDMI-A-1") and reads its PCI vendor ID to identify
// the GPU vendor. Card numbering isn't guaranteed to start at 0, so this
// scans dynamically rather than assuming "card0".
// Returns: 1 = NVIDIA, 2 = AMD, 3 = Intel, 0 = unknown/unsupported/not found.
int get_gpu_vendor() {
    const std::string drmPath = "/sys/class/drm";

    if (!fs::exists(drmPath)) return 0;

    for (const auto& entry : fs::directory_iterator(drmPath)) {
        std::string name = entry.path().filename().string();

        // Only consider plain "cardN" entries — skip connector sub-entries
        if (name.rfind("card", 0) != 0) continue;
        if (name.find('-') != std::string::npos) continue;

        std::string vendorPath = entry.path().string() + "/device/vendor";
        std::ifstream file(vendorPath);
        if (!file.is_open()) continue;

        std::string vendorId;
        file >> vendorId;

        if (vendorId == "0x10de") return 1; // NVIDIA
        if (vendorId == "0x1002") return 2; // AMD
        if (vendorId == "0x8086") return 3; // Intel
    }

    return 0; // no recognized GPU found
}
// Reads AMD GPU busy percentage from sysfs. Only meaningful when vendor == AMD.
// Returns -1.0 if the file doesn't exist (older AMD driver) or can't be read.
double get_amd_gpu_usage_percent() {
    const std::string drmPath = "/sys/class/drm";

    for (const auto& entry : fs::directory_iterator(drmPath)) {
        std::string name = entry.path().filename().string();
        if (name.rfind("card", 0) != 0) continue;
        if (name.find('-') != std::string::npos) continue;

        std::string busyPath = entry.path().string() + "/device/gpu_busy_percent";
        std::ifstream file(busyPath);
        if (!file.is_open()) continue;

        int percent;
        file >> percent;
        return (double)percent;
    }

    return -1.0; // not found — not AMD, or driver doesn't expose this file
}

// Reads fan RPM from the first hwmon device that exposes fan1_input.
// Returns -1 if no fan sensor is found (common on laptops/thin clients).
int get_fan_rpm() {
    const std::string hwmonPath = "/sys/class/hwmon";
    if (!fs::exists(hwmonPath)) return -1;

    for (const auto& entry : fs::directory_iterator(hwmonPath)) {
        std::string fanPath = entry.path().string() + "/fan1_input";
        std::ifstream file(fanPath);
        if (!file.is_open()) continue;

        int rpm;
        file >> rpm;
        return rpm;
    }

    return -1; // no fan sensor found
}

// Calls into hand-written x86-64 Assembly — proves the full C# -> C++ -> ASM chain
int call_asm_constant() {
    return get_constant();
}

// Runs the Assembly benchmark loop for a fixed iteration count, times it with
// a high-resolution clock, and returns operations-per-second.
// resultOut receives the accumulated value (proves the loop actually executed,
// not optimized away) — mostly for sanity-checking, not meaningful on its own.
double run_cpu_benchmark(long long iterations, long long* resultOut) {
    auto start = std::chrono::high_resolution_clock::now();

    long long result = run_benchmark_loop(iterations);

    auto end = std::chrono::high_resolution_clock::now();
    std::chrono::duration<double> elapsed = end - start;

    *resultOut = result;

    if (elapsed.count() <= 0.0) return 0.0;
    return iterations / elapsed.count(); // operations per second
}
// Times scalar vs SIMD versions of the same add+xor workload, same element count.
void run_simd_comparison(long long iterations, double* scalarOpsPerSecOut, double* simdOpsPerSecOut)
{
    auto start1 = std::chrono::high_resolution_clock::now();
    run_benchmark_loop_scalar_compare(iterations);
    auto end1 = std::chrono::high_resolution_clock::now();
    std::chrono::duration<double> elapsed1 = end1 - start1;
    *scalarOpsPerSecOut = elapsed1.count() > 0 ? iterations / elapsed1.count() : 0.0;

    long long simdIterations = (iterations / 4) * 4; // round down to a multiple of 4
    auto start2 = std::chrono::high_resolution_clock::now();
    run_benchmark_loop_simd(simdIterations);
    auto end2 = std::chrono::high_resolution_clock::now();
    std::chrono::duration<double> elapsed2 = end2 - start2;
    *simdOpsPerSecOut = elapsed2.count() > 0 ? simdIterations / elapsed2.count() : 0.0;
}

} // extern "C"