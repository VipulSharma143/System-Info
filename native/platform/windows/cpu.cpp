// Windows CPU topology.
#include "../../src/internal.h"

#include <windows.h>
#include <psapi.h>

#include <vector>

// ---------------------------------------------------------------------
// CPU topology
// ---------------------------------------------------------------------

static int popcount64(
    ULONG_PTR value) {

    int count = 0;

    while (value) {
        value &= value - 1;
        ++count;
    }

    return count;
}

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
        DWORD length = 0;

        GetLogicalProcessorInformationEx(
            RelationAll,
            nullptr,
            &length
        );

        if (GetLastError() != ERROR_INSUFFICIENT_BUFFER ||
            length == 0) {
            return 0;
        }

        std::vector<char> buffer(length);

        if (!GetLogicalProcessorInformationEx(
                RelationAll,
                reinterpret_cast<
                    PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(
                    buffer.data()),
                &length)) {
            return 0;
        }

        int cores = 0;
        int logical = 0;
        int pkgs = 0;

        for (DWORD offset = 0;
             offset < length;) {

            auto* info =
                reinterpret_cast<
                    PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(
                    buffer.data() + offset);

            if (info->Size == 0)
                break;

            if (info->Relationship ==
                RelationProcessorCore) {

                ++cores;

                // Processor groups allow systems with more than
                // 64 logical processors to be represented correctly.
                for (WORD group = 0;
                     group < info->Processor.GroupCount;
                     ++group) {

                    logical +=
                        popcount64(
                            info->Processor
                                .GroupMask[group]
                                .Mask
                        );
                }
            }
            else if (info->Relationship ==
                     RelationProcessorPackage) {

                ++pkgs;
            }

            offset += info->Size;
        }

        if (cores <= 0)
            return 0;

        if (physicalCores)
            *physicalCores = cores;

        if (logicalCores)
            *logicalCores =
                logical > 0
                    ? logical
                    : -1;

        if (packages)
            *packages =
                pkgs > 0
                    ? pkgs
                    : -1;

        return 1;
    }
    catch (...) {
        return 0;
    }
}
