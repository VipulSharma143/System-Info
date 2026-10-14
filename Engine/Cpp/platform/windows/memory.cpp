// Windows runtime RAM, page file and commit counters.
#include "../../src/internal.h"

#include <windows.h>
#include <psapi.h>

// ---------------------------------------------------------------------
// Runtime RAM / page-file / commit information
// ---------------------------------------------------------------------

static BOOL CALLBACK si_pagefile_cb(
    LPVOID context,
    PENUM_PAGE_FILE_INFORMATION info,
    LPCWSTR) {

    if (!context || !info)
        return TRUE;

    auto* totals =
        static_cast<unsigned long long*>(
            context
        );

    // [0] = total pages
    // [1] = in-use pages
    totals[0] += info->TotalSize;
    totals[1] += info->TotalInUse;

    return TRUE;
}

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
        MEMORYSTATUSEX memoryStatus{};

        memoryStatus.dwLength =
            sizeof(memoryStatus);

        if (!GlobalMemoryStatusEx(
                &memoryStatus)) {
            return 0;
        }

        si_mem_put(
            totalBytes,
            static_cast<long long>(
                memoryStatus.ullTotalPhys
            )
        );

        si_mem_put(
            availableBytes,
            static_cast<long long>(
                memoryStatus.ullAvailPhys
            )
        );

        unsigned long long pageSize =
            4096;

        PERFORMANCE_INFORMATION performance{};

        performance.cb =
            sizeof(performance);

        if (GetPerformanceInfo(
                &performance,
                sizeof(performance))) {

            pageSize =
                static_cast<unsigned long long>(
                    performance.PageSize
                );

            si_mem_put(
                cachedBytes,
                static_cast<long long>(
                    static_cast<unsigned long long>(
                        performance.SystemCache
                    ) * pageSize
                )
            );

            si_mem_put(
                commitLimitBytes,
                static_cast<long long>(
                    static_cast<unsigned long long>(
                        performance.CommitLimit
                    ) * pageSize
                )
            );

            si_mem_put(
                commitUsedBytes,
                static_cast<long long>(
                    static_cast<unsigned long long>(
                        performance.CommitTotal
                    ) * pageSize
                )
            );
        }

        unsigned long long pageFiles[2] = {
            0,
            0
        };

        if (EnumPageFilesW(
                si_pagefile_cb,
                pageFiles)) {

            si_mem_put(
                swapTotalBytes,
                static_cast<long long>(
                    pageFiles[0] * pageSize
                )
            );

            si_mem_put(
                swapUsedBytes,
                static_cast<long long>(
                    pageFiles[1] * pageSize
                )
            );
        }

        return 1;
    }
    catch (...) {
        return 0;
    }
}
