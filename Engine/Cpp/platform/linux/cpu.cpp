// Linux CPU topology (/proc/cpuinfo + /sys/devices/system/cpu).
#include "../../src/internal.h"
#include "../../src/cpu_list.h"
#include "sysfs.h"

#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <set>
#include <sstream>
#include <sys/statvfs.h>
#include <unistd.h>
#include <vector>

// =====================================================================
// CPU topology
// =====================================================================

int si_get_cpu_topology(
    int* physicalCores,
    int* logicalCores,
    int* packages) {

    if (physicalCores)
        *physicalCores = -1;

    if (logicalCores)
        *logicalCores = -1;

    if (packages)
        *packages = -1;

    try {
        std::set<
            std::pair<long long, long long>
        > cores;

        std::set<long long>
            packagesFound;

        int logical = 0;
        bool topologyKnown = false;

        for (const auto& path :
             sorted_children(
                 "/sys/devices/system/cpu")) {

            const std::string name =
                fs::path(path)
                    .filename()
                    .string();

            if (name.size() < 4 ||
                name.compare(0, 3, "cpu") != 0 ||
                !std::all_of(
                    name.begin() + 3,
                    name.end(),
                    [](unsigned char c) {
                        return std::isdigit(c);
                    })) {
                continue;
            }

            long long online = 1;

            if (read_int(
                    path + "/online",
                    online) &&
                online == 0) {
                continue;
            }

            ++logical;

            long long core = -1;
            long long package = -1;

            if (read_int(
                    path + "/topology/core_id",
                    core) &&
                read_int(
                    path +
                        "/topology/physical_package_id",
                    package)) {

                topologyKnown = true;

                cores.insert({
                    package,
                    core
                });

                packagesFound.insert(
                    package
                );
            }
        }

        if (logical == 0) {

            const long count =
                sysconf(
                    _SC_NPROCESSORS_ONLN
                );

            if (count <= 0)
                return 0;

            logical =
                static_cast<int>(count);
        }

        if (logicalCores)
            *logicalCores =
                logical;

        if (topologyKnown) {

            const bool invalid =
                std::any_of(
                    cores.begin(),
                    cores.end(),
                    [](const auto& value) {
                        return value.first < 0 ||
                               value.second < 0;
                    }
                );

            if (!invalid) {

                if (physicalCores)
                    *physicalCores =
                        static_cast<int>(
                            cores.size()
                        );

                if (packages)
                    *packages =
                        static_cast<int>(
                            packagesFound.size()
                        );
            }
        }

        return 1;
    }
    catch (...) {
        return 0;
    }
}

// =====================================================================
// Per-logical-processor identity and hybrid core class
// =====================================================================

namespace {

struct LogicalCpu {
    int number;
    int coreId;
};

// Core-type sets, slowest first. Present only on hybrid Intel kernels; absent files mean "not hybrid".
struct ClassSet {
    const char* path;
    std::set<int> cpus;
};

std::vector<LogicalCpu> enumerate_online_cpus(const std::string& root) {
    std::vector<LogicalCpu> result;

    for (const auto& path : sorted_children(root)) {
        const std::string name = fs::path(path).filename().string();

        if (name.size() < 4 || name.compare(0, 3, "cpu") != 0 ||
            !std::all_of(name.begin() + 3, name.end(),
                         [](unsigned char c) { return std::isdigit(c); })) {
            continue;
        }

        long long online = 1;
        if (read_int(path + "/online", online) && online == 0)
            continue;

        long long core = -1;
        long long package = -1;
        const bool haveCore = read_int(path + "/topology/core_id", core) && core >= 0;
        const bool havePackage = read_int(path + "/topology/physical_package_id", package) && package >= 0;

        LogicalCpu cpu;
        cpu.number = std::atoi(name.c_str() + 3);
        cpu.coreId = haveCore ? static_cast<int>((havePackage ? package : 0) * 100000 + core) : -1;
        result.push_back(cpu);
    }

    std::sort(result.begin(), result.end(),
              [](const LogicalCpu& a, const LogicalCpu& b) { return a.number < b.number; });
    return result;
}

}  // namespace

int si_get_cpu_logical_info(
    int index,
    int* coreId,
    int* efficiencyClass,
    int* classCount) {

    if (coreId)
        *coreId = -1;
    if (efficiencyClass)
        *efficiencyClass = -1;
    if (classCount)
        *classCount = -1;

    if (index < 0)
        return 0;

    try {
        const char* override_root = std::getenv("SYSTEMINFO_SYSFS_ROOT");
        const std::string sys = override_root && *override_root ? override_root : "/sys";

        const auto cpus = enumerate_online_cpus(sys + "/devices/system/cpu");
        if (static_cast<std::size_t>(index) >= cpus.size())
            return 0;

        const LogicalCpu& cpu = cpus[static_cast<std::size_t>(index)];
        if (coreId)
            *coreId = cpu.coreId;

        // Slowest to fastest: low-power E-cores, E-cores, P-cores.
        std::vector<ClassSet> sets = {
            {"/devices/cpu_lowpower/cpus", {}},
            {"/devices/cpu_atom/cpus", {}},
            {"/devices/cpu_core/cpus", {}},
        };
        for (auto& set : sets)
            set.cpus = parse_cpu_list(read_line(sys + set.path));

        sets.erase(std::remove_if(sets.begin(), sets.end(),
                                  [](const ClassSet& s) { return s.cpus.empty(); }),
                   sets.end());

        // One kind of core is not a hybrid CPU: report nothing rather than a one-sided split.
        if (sets.size() < 2)
            return 1;

        if (classCount)
            *classCount = static_cast<int>(sets.size());

        for (std::size_t rank = 0; rank < sets.size(); ++rank) {
            if (sets[rank].cpus.count(cpu.number)) {
                if (efficiencyClass)
                    *efficiencyClass = static_cast<int>(rank);
                break;
            }
        }
        return 1;
    }
    catch (...) {
        return 0;
    }
}
