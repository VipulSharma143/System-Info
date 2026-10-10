// CPU detail document (si_cpu_detail_json): identity, topology, hybrid split, caches, clock range, per-core sensors,
// power, throttle counters, time breakdown and load — against a fake /proc + /sys tree (Linux), plus properties that
// hold on any real machine. Never asserts a specific CPU model, temperature or clock of the machine running it.
#include "../../native/include/native_engine.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <thread>
#include <vector>

#ifndef _WIN32
#include <filesystem>
#include <fstream>
namespace fs = std::filesystem;
#endif

static int failures = 0;

#define CHECK(cond)                                                          \
    do {                                                                     \
        if (!(cond)) {                                                       \
            std::printf("FAIL line %d: %s\n", __LINE__, #cond);              \
            ++failures;                                                      \
        }                                                                    \
    } while (0)

static std::string read_doc() {
    std::vector<char> buf(32 * 1024);
    int n = si_cpu_detail_json(buf.data(), (int)buf.size());
    if (n < 0) { buf.resize((size_t)(-n) + 16); n = si_cpu_detail_json(buf.data(), (int)buf.size()); }
    return n > 0 ? std::string(buf.data(), (size_t)n) : std::string();
}

static bool has(const std::string& doc, const std::string& needle) { return doc.find(needle) != std::string::npos; }

// The number after `"key":` (first occurrence at or after `from`), or -1e9 when the value is null / absent.
static double num_after(const std::string& doc, const std::string& key, size_t from = 0) {
    const std::string k = "\"" + key + "\":";
    size_t p = doc.find(k, from);
    if (p == std::string::npos) return -1e9;
    p += k.size();
    if (doc.compare(p, 4, "null") == 0) return -1e9;
    return std::atof(doc.c_str() + p);
}

static void test_capacity_and_cache() {
    si_cpu_detail_set_root("");
    CHECK(si_cpu_detail_json(nullptr, 0) < 0);
    char tiny[8];
    CHECK(si_cpu_detail_json(tiny, (int)sizeof tiny) < 0);
    const std::string a = read_doc(), b = read_doc();
    CHECK(!a.empty());
    CHECK(a == b);                               // closer than the minimum gap: the same document, rates untouched
}

static void test_live_properties() {
    si_cpu_detail_set_root("");
    const std::string doc = read_doc();
    CHECK(doc.size() > 2 && doc.front() == '{' && doc.back() == '}');
    for (const char* k : {"\"identity\"", "\"topology\"", "\"logical\"", "\"frequency\"", "\"caches\"", "\"features\"",
                          "\"sensors\"", "\"power\"", "\"throttle\"", "\"time\"", "\"system\""})
        CHECK(has(doc, k));

    int physical = -1, logical = -1, packages = -1;
    CHECK(si_get_cpu_topology(&physical, &logical, &packages) == 1);
    const double logicalReported = num_after(doc, "logicalProcessors");
    CHECK(logicalReported == (double)logical);
    const double physicalReported = num_after(doc, "physicalCores");
    if (physicalReported > -1e8) CHECK(physicalReported >= 1 && physicalReported <= logicalReported);

    // A value that was not read is null, never a made-up zero or negative number.
    CHECK(!has(doc, "\"tempC\":-"));
    CHECK(!has(doc, ":-1,") && !has(doc, ":-1}"));
    CHECK(!has(doc, "nan") && !has(doc, "inf"));
}

#ifndef _WIN32
static void write(const fs::path& p, const std::string& text) { fs::create_directories(p.parent_path()); std::ofstream(p) << text << "\n"; }

// 2 P-cores (4 threads: cpu0-3) + 2 E-cores (cpu4, cpu5), one package, one die temperature set, RAPL package power.
static void build_tree(const fs::path& root) {
    write(root / "proc/cpuinfo",
          "processor\t: 0\nvendor_id\t: GenuineIntel\ncpu family\t: 6\nmodel\t\t: 154\nmodel name\t: Fake CPU 9000 @ 2.50GHz\nstepping\t: 3\n"
          "flags\t\t: fpu sse2 hypervisor\n\nprocessor\t: 1\nmodel name\t: Fake CPU 9000 @ 2.50GHz\n");
    write(root / "proc/stat", "cpu  100 0 100 700 0 0 0 0 0 0\ncpu0 25 0 25 175 0 0 0 0 0 0\nctxt 1000\nintr 5000 1 2\nprocesses 77\nprocs_running 3\n");
    write(root / "proc/loadavg", "0.52 0.58 0.59 3/421 5678");

    const fs::path cpu = root / "sys/devices/system/cpu";
    const int core[6] = {0, 0, 1, 1, 8, 9};
    const char* l1share[6] = {"0-1", "0-1", "2-3", "2-3", "4", "5"};
    for (int i = 0; i < 6; i++) {
        const fs::path c = cpu / ("cpu" + std::to_string(i));
        write(c / "topology/core_id", std::to_string(core[i]));
        write(c / "topology/physical_package_id", "0");
        const bool p = i < 4;
        write(c / "cpufreq/cpuinfo_min_freq", "800000");
        write(c / "cpufreq/cpuinfo_max_freq", p ? "4900000" : "3600000");
        if (i == 0) {
            write(c / "cpufreq/base_frequency", "2500000");
            write(c / "cpufreq/scaling_governor", "powersave");
            write(c / "cpufreq/scaling_driver", "intel_pstate");
            write(c / "cpufreq/energy_performance_preference", "balance_performance");
            write(c / "cpufreq/scaling_max_freq", "4800000");
        }
        write(c / "cache/index0/level", "1"); write(c / "cache/index0/type", "Data");
        write(c / "cache/index0/size", p ? "48K" : "32K"); write(c / "cache/index0/shared_cpu_list", l1share[i]);
        write(c / "cache/index3/level", "3"); write(c / "cache/index3/type", "Unified");
        write(c / "cache/index3/size", "12288K"); write(c / "cache/index3/shared_cpu_list", "0-5");
        write(c / "thermal_throttle/package_throttle_count", "3");
        write(c / "thermal_throttle/core_throttle_count", std::to_string(core[i] == 0 ? 2 : 1));
    }
    write(cpu / "intel_pstate/no_turbo", "0");
    write(root / "sys/devices/cpu_core/cpus", "0-3");
    write(root / "sys/devices/cpu_atom/cpus", "4-5");

    const fs::path hw = root / "sys/class/hwmon/hwmon0";
    write(hw / "name", "coretemp");
    const char* labels[5] = {"Package id 0", "Core 0", "Core 1", "Core 8", "Core 9"};
    const int milli[5] = {61000, 58000, 57000, 55000, 54000};
    for (int i = 0; i < 5; i++) {
        const std::string t = "temp" + std::to_string(i + 1);
        write(hw / (t + "_label"), labels[i]); write(hw / (t + "_input"), std::to_string(milli[i]));
        write(hw / (t + "_max"), "100000"); write(hw / (t + "_crit"), "105000");
    }
    write(root / "sys/class/hwmon/hwmon1/name", "acpitz");                     // generic firmware zone: never a CPU sensor
    write(root / "sys/class/hwmon/hwmon1/temp1_input", "28000");

    const fs::path rapl = root / "sys/class/powercap/intel-rapl:0";
    write(rapl / "name", "package-0");
    write(rapl / "energy_uj", "1000000");
    write(rapl / "max_energy_range_uj", "262143328850");
    write(rapl / "constraint_0_name", "long_term"); write(rapl / "constraint_0_power_limit_uw", "45000000");
    write(rapl / "constraint_1_name", "short_term"); write(rapl / "constraint_1_power_limit_uw", "90000000");
    write(root / "sys/class/powercap/intel-rapl:0:0/name", "core");            // sub-domain: not counted as a package
    write(root / "sys/class/powercap/intel-rapl:0:0/energy_uj", "5");
}

static void test_fake_tree() {
    const fs::path root = fs::temp_directory_path() / ("si_cpu_detail_" + std::to_string((long long)std::chrono::steady_clock::now().time_since_epoch().count()));
    fs::remove_all(root);
    build_tree(root);
    si_cpu_detail_set_root(root.string().c_str());

    const std::string first = read_doc();
    CHECK(!first.empty());
    CHECK(has(first, "\"model\":\"Fake CPU 9000 @ 2.50GHz\""));
    CHECK(has(first, "\"virtualized\":"));
    CHECK(num_after(first, "logicalProcessors") == 6);
    CHECK(num_after(first, "physicalCores") == 4);
    CHECK(num_after(first, "packages") == 1);
    CHECK(num_after(first, "performanceCores") == 2);
    CHECK(num_after(first, "efficiencyCores") == 2);
    CHECK(has(first, "\"lowPowerCores\":null"));

    // Clock range from the fastest processor (the P-cores); policy read from it too.
    CHECK(num_after(first, "minMhz") == 800);
    CHECK(num_after(first, "maxMhz") == 4900);
    CHECK(num_after(first, "baseMhz") == 2500);
    CHECK(num_after(first, "policyMaxMhz") == 4800);
    CHECK(has(first, "\"governor\":\"powersave\""));
    CHECK(has(first, "\"driver\":\"intel_pstate\""));
    CHECK(has(first, "\"preference\":\"balance_performance\""));
    CHECK(has(first, "\"boost\":true"));

    // Caches: four L1d (48K x 2 + 32K x 2: sizes differ, so no per-instance size), one shared L3.
    CHECK(has(first, "\"level\":1,\"type\":\"Data\",\"totalBytes\":163840,\"instances\":4,\"perInstanceBytes\":null"));
    CHECK(has(first, "\"level\":3,\"type\":\"Unified\",\"totalBytes\":12582912,\"instances\":1,\"perInstanceBytes\":12582912"));

    // Sensors: the package and each core; the acpitz zone is not one of them.
    CHECK(has(first, "\"label\":\"Package id 0\",\"kind\":\"package\""));
    CHECK(has(first, "\"label\":\"Core 8\",\"kind\":\"core\",\"coreKey\":8,\"tempC\":55.0,\"highC\":100.0,\"criticalC\":105.0"));
    CHECK(!has(first, "28.0"));
    CHECK(has(first, "\"sensorsNote\":null"));

    // Throttle: package counter 3; core counters counted once per physical core (2 + 1 + 1 + 1).
    CHECK(num_after(first, "packageEvents") == 3);
    CHECK(num_after(first, "coreEvents") == 5);

    // First sample is only a baseline: no rates, no power yet — null, not zero.
    CHECK(has(first, "\"userPercent\":null"));
    CHECK(has(first, "\"packageWatts\":null"));
    CHECK(has(first, "\"contextSwitchesPerSec\":null"));
    CHECK(num_after(first, "load1") == 0.52);
    CHECK(num_after(first, "threads") == 421);
    CHECK(num_after(first, "runnableTasks") == 3);
    CHECK(num_after(first, "limit1Watts") == 45);
    CHECK(num_after(first, "limit2Watts") == 90);

    // Second sample: 20% user, 10% system, 70% idle over the interval; 10 W-ish of package power.
    write(root / "proc/stat", "cpu  300 0 200 1400 0 0 0 0 0 0\nctxt 5000\nintr 9000 1 2\nprocs_running 2\n");
    write(root / "sys/class/powercap/intel-rapl:0/energy_uj", "9000000");
    write(root / "sys/class/hwmon/hwmon0/temp2_input", "130000");                // implausible reading: dropped, not shown
    std::this_thread::sleep_for(std::chrono::milliseconds(450));
    const std::string second = read_doc();
    CHECK(has(second, "\"userPercent\":20.0"));
    CHECK(has(second, "\"systemPercent\":10.0"));
    CHECK(has(second, "\"idlePercent\":70.0"));
    CHECK(has(second, "\"iowaitPercent\":0.0"));
    const double watts = num_after(second, "packageWatts");
    CHECK(watts > 1.0 && watts < 100.0);                                         // 8 J over ~0.45 s, give or take scheduling
    CHECK(has(second, "\"source\":\"rapl\""));
    const double ctx = num_after(second, "contextSwitchesPerSec");
    CHECK(ctx > 1000.0 && ctx < 20000.0);                                        // 4000 switches over ~0.45 s
    CHECK(!has(second, "\"label\":\"Core 0\""));

    // A sensor that returns after it was dropped comes back (the plan is rebuilt after a failed read).
    write(root / "sys/class/hwmon/hwmon0/temp2_input", "59000");
    std::this_thread::sleep_for(std::chrono::milliseconds(350));
    const std::string third = read_doc();
    CHECK(has(third, "\"label\":\"Core 0\",\"kind\":\"core\",\"coreKey\":0,\"tempC\":59.0"));

    // An impossible jump (a glitching counter) is dropped, not shown as hundreds of kilowatts.
    write(root / "sys/class/powercap/intel-rapl:0/energy_uj", "262142328850");
    std::this_thread::sleep_for(std::chrono::milliseconds(350));
    const std::string glitch = read_doc();
    CHECK(has(glitch, "\"packageWatts\":null"));

    // A real wrap: just below max_energy_range_uj, then just above zero -> a small positive delta, not a negative one.
    write(root / "sys/class/powercap/intel-rapl:0/energy_uj", "1000000");
    std::this_thread::sleep_for(std::chrono::milliseconds(350));
    const std::string wrapped = read_doc();
    const double w2 = num_after(wrapped, "packageWatts");
    CHECK(w2 > 1.0 && w2 < 100.0);
    si_cpu_detail_set_root("");
    fs::remove_all(root);
}

// No sensors and no power counter: every such field is null and says why.
static void test_bare_tree() {
    const fs::path root = fs::temp_directory_path() / ("si_cpu_detail_bare_" + std::to_string((long long)std::chrono::steady_clock::now().time_since_epoch().count()));
    fs::remove_all(root);
    write(root / "proc/cpuinfo", "processor\t: 0\nmodel name\t: Bare\n");
    write(root / "proc/stat", "cpu  1 0 1 1 0 0 0 0\n");
    write(root / "sys/devices/system/cpu/cpu0/topology/core_id", "0");
    write(root / "sys/devices/system/cpu/cpu0/topology/physical_package_id", "0");
    si_cpu_detail_set_root(root.string().c_str());
    const std::string doc = read_doc();
    CHECK(has(doc, "\"sensors\":[]"));
    CHECK(has(doc, "no CPU temperature sensors"));
    CHECK(has(doc, "\"packageWatts\":null"));
    CHECK(has(doc, "no CPU power counter"));
    CHECK(has(doc, "\"caches\":[]"));
    CHECK(has(doc, "\"packageEvents\":null") && has(doc, "\"coreEvents\":null"));
    CHECK(has(doc, "\"governor\":null") && has(doc, "\"boost\":null"));
    CHECK(has(doc, "\"minMhz\":null"));
    si_cpu_detail_set_root("");
    fs::remove_all(root);
}
#endif

int main() {
    test_capacity_and_cache();
    test_live_properties();
#ifndef _WIN32
    test_fake_tree();
    test_bare_tree();
#endif
    if (failures == 0) std::printf("cpu_detail_test: all checks passed\n");
    return failures == 0 ? 0 : 1;
}
