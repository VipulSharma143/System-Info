// nvml.h — NVIDIA's management library, loaded at run time (no SDK, no import library). The only supported source of
// NVIDIA temperature, load and clocks on both OSes. A missing driver, a sleeping GPU or a driver reset never throws:
// the session is retried and rebuilt, and the reason for any gap is available through problem().
#pragma once
#include <string>
#include <vector>
#include "overlay_types.h"

namespace si {

struct NvmlDevice { std::string name, pci; uint32_t vendorId = 0, deviceId = 0; double memTotal = NA; };

struct NvmlReading {
    double util = NA, temp = NA, memUsed = NA, memTotal = NA, power = NA, powerLimit = NA, fan = NA, coreMhz = NA, memMhz = NA;
    std::string pstate;
    int tempCode = 0;
};

class Nvml {
public:
    Nvml();
    ~Nvml();
    bool ready();                                   // loads/reconnects when needed (rate-limited)
    const std::vector<NvmlDevice>& devices();
    std::string driverVersion();
    std::string problem();                          // empty when working
    bool read(size_t device, NvmlReading& out);     // false when the device or session is unusable
    static std::string normalizePci(const std::string& address);   // "00000000:01:00.0" and "0000:01:00.0" are the same
private:
    struct Impl;
    Impl* d;
};

}  // namespace si
