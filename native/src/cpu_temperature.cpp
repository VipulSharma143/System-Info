// cpu_temperature.cpp — live CPU package temperature from the Linux hwmon / thermal sysfs interfaces.
//
// Why this exists: the previous implementation read /sys/class/thermal/thermal_zone0 and nothing else. On most
// machines zone 0 is the generic firmware "acpitz" zone, which sits at a fixed ~27-28 C regardless of load, so the
// app showed a CPU temperature that never moved. The rules below pick a sensor that is actually the CPU package
// and refuse generic zones outright.
//
// Selection (identical to backend/.../CpuTemperatureSelection.cs, which a C# contract test checks against this):
//   1. hwmon devices named coretemp / k10temp / zenpower / cpu_thermal / soc_thermal. Package value is, in order,
//      the "Package id N" label, "Tdie", "Tctl", the hottest "Core N", or an unlabelled temp1 on an ARM SoC.
//   2. thermal zones typed x86_pkg_temp / cpu-thermal / cpu_thermal / soc-thermal / soc_thermal.
//   3. Nothing else. "acpitz" is never a CPU temperature.
// A reading outside 1..125 C is a broken sensor and is skipped, not reported.
//
// Performance: discovery (directory walks, name/label reads) happens once per sysfs root; later calls read only the
// chosen file(s). If a read fails (sensor re-enumerated after suspend, driver reloaded) discovery runs again.
// Values are never cached: every call reads the kernel.
#include "internal.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <map>
#include <mutex>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace {

struct Plan {
    std::vector<std::string> files;   // millidegree files; the reading is the maximum of them
    std::string source;
};

bool read_text(const std::string& path, std::string& out) {
    std::ifstream f(path);
    if (!f) return false;
    std::getline(f, out);
    while (!out.empty() && (out.back() == '\r' || out.back() == ' ' || out.back() == '\t')) out.pop_back();
    return true;
}

bool read_milli(const std::string& path, long long& out) {
    std::string text;
    if (!read_text(path, text) || text.empty()) return false;
    char* end = nullptr;
    const long long v = std::strtoll(text.c_str(), &end, 10);
    if (end == text.c_str()) return false;
    out = v;
    return true;
}

bool plausible(long long milli) { return milli >= 1000 && milli < 125000; }

std::vector<std::string> children(const std::string& dir, const char* prefix) {
    std::vector<std::string> out;
    std::error_code ec;
    for (fs::directory_iterator it(dir, ec), end; !ec && it != end; it.increment(ec)) {
        const std::string name = it->path().filename().string();
        if (name.rfind(prefix, 0) == 0) out.push_back(it->path().string());
    }
    std::sort(out.begin(), out.end());
    return out;
}

bool starts_with(const std::string& s, const char* p) { return s.rfind(p, 0) == 0; }

bool is_cpu_hwmon(const std::string& name) {
    return name == "coretemp" || name == "k10temp" || name == "zenpower" || name == "cpu_thermal" || name == "soc_thermal";
}

bool is_cpu_zone(const std::string& type) {
    return type == "x86_pkg_temp" || type == "cpu-thermal" || type == "cpu_thermal" || type == "soc-thermal" || type == "soc_thermal";
}

bool discover(const std::string& root, Plan& plan) {
    for (const auto& dir : children(root + "/class/hwmon", "hwmon")) {
        std::string name;
        if (!read_text(dir + "/name", name) || !is_cpu_hwmon(name)) continue;

        std::string pkg, tdie, tctl, unlabelled;
        std::vector<std::string> cores;
        for (const auto& input : children(dir, "temp")) {
            if (input.size() < 7 || input.compare(input.size() - 6, 6, "_input") != 0) continue;
            long long milli = 0;
            if (!read_milli(input, milli) || !plausible(milli)) continue;
            std::string label;
            read_text(input.substr(0, input.size() - 6) + "_label", label);
            if (starts_with(label, "Core ")) cores.push_back(input);
            else if (starts_with(label, "Package")) { if (pkg.empty()) pkg = input; }
            else if (label == "Tdie") tdie = input;
            else if (label == "Tctl") tctl = input;
            else if (label.empty() && unlabelled.empty()) unlabelled = input;
        }

        if (!pkg.empty()) plan.files = {pkg};
        else if (!tdie.empty()) plan.files = {tdie};
        else if (!tctl.empty()) plan.files = {tctl};
        else if (!cores.empty()) plan.files = cores;
        else if (!unlabelled.empty() && (name == "cpu_thermal" || name == "soc_thermal")) plan.files = {unlabelled};
        else continue;
        plan.source = name;
        return true;
    }

    for (const auto& zone : children(root + "/class/thermal", "thermal_zone")) {
        std::string type;
        long long milli = 0;
        if (!read_text(zone + "/type", type) || !is_cpu_zone(type)) continue;
        if (!read_milli(zone + "/temp", milli) || !plausible(milli)) continue;
        plan.files = {zone + "/temp"};
        plan.source = "thermal-zone";
        return true;
    }
    return false;
}

bool read_plan(const Plan& plan, double& celsius) {
    long long best = -1;
    for (const auto& file : plan.files) {
        long long milli = 0;
        if (!read_milli(file, milli) || !plausible(milli)) return false;   // stale plan or broken sensor: rediscover
        best = std::max(best, milli);
    }
    if (best < 0) return false;
    celsius = static_cast<double>(best) / 1000.0;
    return true;
}

std::mutex g_mutex;
std::map<std::string, Plan> g_plans;   // sysfs root -> chosen sensor files (paths only, never values)

int read_temperature(const std::string& root, double* celsiusOut, char* sourceOut, int sourceCap) {
    std::lock_guard<std::mutex> lock(g_mutex);
    double celsius = 0;
    auto it = g_plans.find(root);
    if (it != g_plans.end() && read_plan(it->second, celsius)) {
        if (celsiusOut) *celsiusOut = celsius;
        copy_out(sourceOut, sourceCap, it->second.source);
        return 1;
    }

    Plan plan;
    if (discover(root, plan) && read_plan(plan, celsius)) {
        if (celsiusOut) *celsiusOut = celsius;
        copy_out(sourceOut, sourceCap, plan.source);
        g_plans[root] = plan;
        return 1;
    }
    g_plans.erase(root);
    if (celsiusOut) *celsiusOut = 0;
    copy_out(sourceOut, sourceCap, "");
    return 0;
}

}  // namespace

int si_cpu_temperature_at(const char* sysRoot, double* celsiusOut, char* sourceOut, int sourceCap) {
    if (!sysRoot || !celsiusOut) return -1;
    try { return read_temperature(sysRoot, celsiusOut, sourceOut, sourceCap); } catch (...) { return -1; }
}

int si_cpu_temperature(double* celsiusOut, char* sourceOut, int sourceCap) {
#ifdef _WIN32
    // Windows has no built-in package temperature (the ACPI zone is generic and the managed layer labels it
    // approximate); report "no sensor" honestly rather than a made-up number.
    if (celsiusOut) *celsiusOut = 0;
    copy_out(sourceOut, sourceCap, "");
    return 0;
#else
    if (!celsiusOut) return -1;
    try { return read_temperature("/sys", celsiusOut, sourceOut, sourceCap); } catch (...) { return -1; }
#endif
}
