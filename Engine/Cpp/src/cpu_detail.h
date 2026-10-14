// cpu_detail.h — plain data behind the CPU tab, shared by cpu_detail.cpp and the per-OS sources.
//
// Split in two: CpuDetailInfo holds facts that cannot change while the app runs (model, topology, caches, feature
// flags) and is read once; CpuDetailLive is read on every call (sensors, power, policy, activity counters).
// Live per-processor load, clocks and the headline temperature are NOT here — they come from the overlay engine, so
// the CPU tab and the Overlay tab can never disagree. An unavailable number is NaN (never 0); -1 for integers;
// an unavailable string is empty.
#pragma once
#include <cmath>
#include <limits>
#include <memory>
#include <string>
#include <vector>

namespace si {

constexpr double CPU_NA = std::numeric_limits<double>::quiet_NaN();
inline bool cpuKnown(double v) { return std::isfinite(v); }

struct CpuCache {
    int level = 0;
    std::string type;                  // "Data", "Instruction", "Unified"
    long long totalBytes = -1;         // summed over every instance on the machine
    int instances = 0;                 // how many separate caches of this kind exist
    long long perInstanceBytes = -1;   // -1 when the instances differ in size (hybrid CPUs)
};

struct CpuLogical {
    int coreKey = -1;                  // shared by SMT siblings of one physical core; -1 when the OS does not say
    int kind = -1;                     // hybrid only: 0 = low-power efficiency, 1 = efficiency, 2 = performance; -1 = no split
};

struct CpuDetailInfo {
    std::string model, vendor, architecture;
    int family = -1, modelId = -1, stepping = -1;
    int hypervisor = -1;               // 1 = running inside a virtual machine, 0 = not, -1 = unknown
    int packages = -1, physicalCores = -1, logicalProcessors = -1;
    int performanceCores = -1, efficiencyCores = -1, lowPowerCores = -1;   // hybrid CPUs only
    double baseMhz = CPU_NA, maxMhz = CPU_NA, minMhz = CPU_NA;
    std::string baseSource, maxSource;
    std::vector<CpuLogical> logical;   // one per logical processor, in the overlay engine's order
    std::vector<CpuCache> caches;
    std::vector<std::string> features;
};

struct CpuSensor {
    std::string label, kind;           // kind: package | core | ccd | other
    int coreKey = -1;                  // matches CpuLogical::coreKey for kind == "core"
    double tempC = CPU_NA, highC = CPU_NA, critC = CPU_NA;
};

struct CpuDetailLive {
    // Frequency policy
    std::string governor, driver, preference;
    int boost = -1;                    // 1 = turbo / boost allowed, 0 = disabled, -1 = unknown
    double policyMaxMhz = CPU_NA;
    // Sensors
    std::vector<CpuSensor> sensors;
    std::string sensorNote;
    // Power
    double packageWatts = CPU_NA, limit1Watts = CPU_NA, limit2Watts = CPU_NA;
    std::string powerSource, powerNote;
    // Thermal throttling, events since boot
    long long packageThrottle = -1, coreThrottle = -1;
    // Where the last interval went, percent of all processor time
    double userPct = CPU_NA, systemPct = CPU_NA, idlePct = CPU_NA, iowaitPct = CPU_NA, irqPct = CPU_NA, stealPct = CPU_NA;
    // Whole-machine activity
    double load1 = CPU_NA, load5 = CPU_NA, load15 = CPU_NA;          // Linux only
    double runnable = CPU_NA, queueLength = CPU_NA;
    double threads = CPU_NA, processes = CPU_NA;
    double contextSwitchesPerSec = CPU_NA, interruptsPerSec = CPU_NA, systemCallsPerSec = CPU_NA;
};

class CpuDetailSource {
public:
    virtual ~CpuDetailSource() = default;
    virtual void readInfo(CpuDetailInfo& out) = 0;       // once; CPUID facts are already filled in
    virtual void readLive(CpuDetailLive& out) = 0;       // every call; keeps its own state for rates
};

// Implemented in platform/linux/cpu_detail.cpp and platform/windows/cpu_detail.cpp. `root` is "" in production;
// tests point it at a directory holding a fake proc/ and sys/ tree (Linux).
std::unique_ptr<CpuDetailSource> makeCpuDetailSource(const std::string& root);

// Shared (cpu_detail.cpp): facts the processor itself reports through CPUID. Does nothing on non-x86 CPUs.
void fillFromCpuid(CpuDetailInfo& info);

// Shared helpers for the sources.
std::string cpuTrim(std::string s);
// Folds per-logical-processor identity (si_get_cpu_logical_info) into topology counts and fills info.logical.
void fillTopology(CpuDetailInfo& info);

}  // namespace si
