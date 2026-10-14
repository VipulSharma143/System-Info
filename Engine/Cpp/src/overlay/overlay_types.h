// overlay_types.h — plain data shared by the overlay engine and its per-OS sources.
// An unavailable number is NaN (never 0); an unavailable string is empty.
#pragma once
#include <cmath>
#include <cstdint>
#include <limits>
#include <string>
#include <utility>
#include <vector>

namespace si {

constexpr double NA = std::numeric_limits<double>::quiet_NaN();
inline bool known(double v) { return std::isfinite(v); }

struct CpuSample {
    double usage = NA;                 // 0-100, whole machine
    double tempC = NA;
    std::string tempSource, tempNote;  // why there is no temperature, or which sensor produced it
    double clockMhz = NA;              // average effective clock across logical processors
    std::vector<float> core;           // 0-100 per logical processor
    std::vector<float> coreMhz;        // same order; NaN when unknown
    std::string note;
};

// Stable facts about one adapter; id never changes while the adapter exists (the Windows LUID does).
struct GpuInfo {
    std::string id, name, vendor, kind;      // vendor: NVIDIA | AMD | Intel | ""; kind: discrete | integrated | ""
    uint32_t vendorId = 0, deviceId = 0;
    std::string pci, driverVersion;
    long long dedicatedBytes = -1, sharedBytes = -1;
    long long luid = 0;                      // Windows only, 0 when unknown
};

struct GpuSample {
    double util = NA, temp = NA, memUsed = NA, memTotal = NA, sharedUsed = NA;
    double power = NA, powerLimit = NA, fanPercent = NA, coreMhz = NA, memMhz = NA;
    std::string pstate, utilSource, tempSource, memSource, note;
    std::vector<std::pair<std::string, double>> engines;    // busiest first, > 0.1% only
};

struct SourceStatus { std::string nvml, counters; };        // "ok" or the reason it is not

class CpuSource {
public:
    virtual ~CpuSource() = default;
    virtual void sample(CpuSample& out) = 0;
};

class GpuSource {
public:
    virtual ~GpuSource() = default;
    // Adapter list (refreshed internally from time to time); index order is stable between calls.
    virtual const std::vector<GpuInfo>& adapters() = 0;
    // One live sample per adapter, same order as adapters().
    virtual void sample(std::vector<GpuSample>& out) = 0;
    virtual SourceStatus status() const = 0;
};

}  // namespace si
