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

int get_battery_info_json(char* bufferOut, int bufferSize) {
    const std::string psPath = "/sys/class/power_supply";
    std::string batteryDir;

    // Dynamic discovery — same lesson as get_gpu_vendor(): don't assume BAT0.
    // This machine reports BAT1; another might report BAT0 or CMB1.
    if (fs::exists(psPath)) {
        for (const auto& entry : fs::directory_iterator(psPath)) {
            std::ifstream typeFile(entry.path().string() + "/type");
            if (!typeFile.is_open()) continue;
            std::string type;
            typeFile >> type;
            if (type == "Battery") {
                batteryDir = entry.path().string();
                break; // first battery only — multi-battery laptops deferred
            }
        }
    }

    if (batteryDir.empty()) {
        // Desktop, or no battery exposed at all — honest, not a crash.
        std::strncpy(bufferOut, "{\"present\":false}", bufferSize - 1);
        bufferOut[bufferSize - 1] = '\0';
        return 0;
    }

    auto readStr = [&](const std::string& file) -> std::string {
        std::ifstream f(batteryDir + "/" + file);
        std::string val;
        std::getline(f, val);
        return val;
    };
    auto readLong = [&](const std::string& file) -> long long {
        std::ifstream f(batteryDir + "/" + file);
        long long val = -1;
        f >> val;
        return val;
    };

    std::string status = readStr("status");
    if (status.empty()) status = "Unknown";

    long long capacityPercent   = readLong("capacity");            // kernel-computed 0-100
    long long cycleCount        = readLong("cycle_count");         // present but unreliable on some firmware
    long long chargeFullDesign  = readLong("charge_full_design");  // µAh
    long long chargeFull        = readLong("charge_full");         // µAh
    long long chargeNow         = readLong("charge_now");          // µAh
    long long voltageNowUv      = readLong("voltage_now");         // µV
    long long currentNowUa      = readLong("current_now");         // µA

    // Some hardware reports energy_* (µWh) instead of charge_* (µAh) — never both.
    // Yours uses charge_*, but fall back for other machines this code runs on.
    bool usingEnergyUnits = false;
    if (chargeFullDesign <= 0 || chargeFull <= 0) {
        long long energyFullDesign = readLong("energy_full_design");
        long long energyFull       = readLong("energy_full");
        long long energyNow        = readLong("energy_now");
        if (energyFullDesign > 0 && energyFull > 0) {
            chargeFullDesign = energyFullDesign;
            chargeFull       = energyFull;
            chargeNow        = energyNow;
            usingEnergyUnits = true;
        }
    }

    double designMah = chargeFullDesign > 0 ? chargeFullDesign / 1000.0 : -1.0;
    double fullMah    = chargeFull > 0 ? chargeFull / 1000.0 : -1.0;
    double nowMah     = chargeNow >= 0 ? chargeNow / 1000.0 : -1.0;

    double healthPercent = (designMah > 0 && fullMah > 0)
        ? (fullMah / designMah) * 100.0
        : -1.0;

    double voltageV = voltageNowUv > 0 ? voltageNowUv / 1000000.0 : -1.0;
    double currentA  = currentNowUa >= 0 ? currentNowUa / 1000000.0 : -1.0;
    double powerW    = (voltageV > 0 && currentA >= 0) ? voltageV * currentA : -1.0;

    std::string model        = readStr("model_name");
    std::string manufacturer = readStr("manufacturer");

    std::ostringstream json;
    json << "{"
         << "\"present\":true,"
         << "\"status\":\"" << status << "\","
         << "\"capacityPercent\":" << capacityPercent << ","
         << "\"cycleCount\":" << cycleCount << ","
         << "\"designCapacityMah\":" << designMah << ","
         << "\"fullCapacityMah\":" << fullMah << ","
         << "\"nowCapacityMah\":" << nowMah << ","
         << "\"healthPercent\":" << healthPercent << ","
         << "\"voltageNow\":" << voltageV << ","
         << "\"currentNow\":" << currentA << ","
         << "\"powerWatts\":" << powerW << ","
         << "\"usingEnergyUnits\":" << (usingEnergyUnits ? "true" : "false") << ","
         << "\"model\":\"" << model << "\","
         << "\"manufacturer\":\"" << manufacturer << "\""
         << "}";

    std::string result = json.str();
    std::strncpy(bufferOut, result.c_str(), bufferSize - 1);
    bufferOut[bufferSize - 1] = '\0';
    return 1;
}

} // extern "C"