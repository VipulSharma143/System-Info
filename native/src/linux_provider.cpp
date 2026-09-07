#include "../include/native_engine.h"
#include <fstream>
#include <sstream>
#include <string>
#include <cstring>
#include <vector>
#include <unistd.h>
#include <filesystem>

namespace fs = std::filesystem;

// ------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------

struct CpuTimes {
    long long idle;
    long long total;
};

static CpuTimes read_cpu_times() {
    std::ifstream file("/proc/stat");
    std::string line;
    std::getline(file, line);

    std::istringstream iss(line);
    std::string cpuLabel;
    iss >> cpuLabel;

    std::vector<long long> values;
    long long val;
    while (iss >> val) values.push_back(val);

    long long idle = values.size() > 3 ? values[3] : 0;
    long long total = 0;
    for (auto v : values) total += v;

    return { idle, total };
}

extern "C" {

int get_cpu_info(char* modelNameOut, int bufferSize) {
    std::ifstream file("/proc/cpuinfo");
    std::string line;
    std::string modelName = "Unknown";
    int coreCount = 0;

    while (std::getline(file, line)) {
        if (line.rfind("model name", 0) == 0 && modelName == "Unknown") {
            size_t colonPos = line.find(':');
            if (colonPos != std::string::npos) {
                modelName = line.substr(colonPos + 2);
            }
        }
        if (line.rfind("processor", 0) == 0) {
            coreCount++;
        }
    }

    std::strncpy(modelNameOut, modelName.c_str(), bufferSize - 1);
    modelNameOut[bufferSize - 1] = '\0';

    return coreCount;
}

double get_cpu_usage_percent() {
    CpuTimes sample1 = read_cpu_times();
    usleep(200000);
    CpuTimes sample2 = read_cpu_times();

    long long idleDelta = sample2.idle - sample1.idle;
    long long totalDelta = sample2.total - sample1.total;

    if (totalDelta == 0) return 0.0;
    return (1.0 - (double)idleDelta / totalDelta) * 100.0;
}

double get_cpu_temperature() {
    std::ifstream file("/sys/class/thermal/thermal_zone0/temp");
    if (!file.is_open()) return -1.0;

    long milliDegrees;
    file >> milliDegrees;

    return milliDegrees / 1000.0;
}

int get_gpu_vendor() {
    const std::string drmPath = "/sys/class/drm";
    if (!fs::exists(drmPath)) return 0;

    for (const auto& entry : fs::directory_iterator(drmPath)) {
        std::string name = entry.path().filename().string();
        if (name.rfind("card", 0) != 0) continue;
        if (name.find('-') != std::string::npos) continue;

        std::string vendorPath = entry.path().string() + "/device/vendor";
        std::ifstream file(vendorPath);
        if (!file.is_open()) continue;

        std::string vendorId;
        file >> vendorId;

        if (vendorId == "0x10de") return 1;
        if (vendorId == "0x1002") return 2;
        if (vendorId == "0x8086") return 3;
    }

    return 0;
}

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

    return -1.0;
}

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

    return -1;
}

} // extern "C"