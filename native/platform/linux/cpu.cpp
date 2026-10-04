// Linux CPU topology (/proc/cpuinfo + /sys/devices/system/cpu).
#include "../../src/internal.h"
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
