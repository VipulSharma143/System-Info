// Linux runtime RAM and swap (/proc/meminfo).
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
// Runtime RAM / swap
// =====================================================================
//
// /proc/meminfo reports values in KiB.
//
// cached:
//   Cached + SReclaimable
//
// Linux does not expose the same Windows commit model through this
// interface, so commitLimitBytes and commitUsedBytes remain -1.

int si_get_memory_info(
    long long* totalBytes,
    long long* availableBytes,
    long long* freeBytes,
    long long* cachedBytes,
    long long* buffersBytes,
    long long* swapTotalBytes,
    long long* swapUsedBytes,
    long long* commitLimitBytes,
    long long* commitUsedBytes) {

    si_mem_put(totalBytes, -1);
    si_mem_put(availableBytes, -1);
    si_mem_put(freeBytes, -1);
    si_mem_put(cachedBytes, -1);
    si_mem_put(buffersBytes, -1);
    si_mem_put(swapTotalBytes, -1);
    si_mem_put(swapUsedBytes, -1);
    si_mem_put(commitLimitBytes, -1);
    si_mem_put(commitUsedBytes, -1);

    try {
        FILE* file =
            std::fopen(
                "/proc/meminfo",
                "r"
            );

        if (!file)
            return 0;

        long long memTotal = -1;
        long long memFree = -1;
        long long memAvailable = -1;
        long long buffers = -1;
        long long cached = -1;
        long long sreclaimable = 0;
        long long swapTotal = -1;
        long long swapFree = -1;

        char line[256];

        while (std::fgets(
            line,
            sizeof(line),
            file)) {

            char key[64] = {};
            long long value = -1;

            if (std::sscanf(
                    line,
                    "%63[^:]: %lld",
                    key,
                    &value) != 2) {
                continue;
            }

            if (!std::strcmp(
                    key,
                    "MemTotal")) {

                memTotal = value;
            }
            else if (!std::strcmp(
                         key,
                         "MemFree")) {

                memFree = value;
            }
            else if (!std::strcmp(
                         key,
                         "MemAvailable")) {

                memAvailable = value;
            }
            else if (!std::strcmp(
                         key,
                         "Buffers")) {

                buffers = value;
            }
            else if (!std::strcmp(
                         key,
                         "Cached")) {

                cached = value;
            }
            else if (!std::strcmp(
                         key,
                         "SReclaimable")) {

                sreclaimable = value;
            }
            else if (!std::strcmp(
                         key,
                         "SwapTotal")) {

                swapTotal = value;
            }
            else if (!std::strcmp(
                         key,
                         "SwapFree")) {

                swapFree = value;
            }
        }

        std::fclose(file);

        if (memTotal < 0)
            return 0;

        if (memAvailable < 0 &&
            memFree >= 0) {

            memAvailable =
                memFree +
                std::max(buffers, 0LL) +
                std::max(cached, 0LL) +
                std::max(sreclaimable, 0LL);
        }

        if (memAvailable < 0)
            return 0;

        si_mem_put(
            totalBytes,
            memTotal * 1024
        );

        si_mem_put(
            availableBytes,
            memAvailable * 1024
        );

        if (memFree >= 0) {

            si_mem_put(
                freeBytes,
                memFree * 1024
            );
        }

        if (buffers >= 0) {

            si_mem_put(
                buffersBytes,
                buffers * 1024
            );
        }

        if (cached >= 0) {

            si_mem_put(
                cachedBytes,
                (
                    cached +
                    std::max(
                        sreclaimable,
                        0LL
                    )
                ) * 1024
            );
        }

        if (swapTotal >= 0 &&
            swapFree >= 0 &&
            swapFree <= swapTotal) {

            si_mem_put(
                swapTotalBytes,
                swapTotal * 1024
            );

            si_mem_put(
                swapUsedBytes,
                (
                    swapTotal -
                    swapFree
                ) * 1024
            );
        }

        return 1;
    }
    catch (...) {
        return 0;
    }
}
