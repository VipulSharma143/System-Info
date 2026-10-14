// Windows CPU topology.
#include "../../src/internal.h"

#include <windows.h>
#include <psapi.h>

#include <algorithm>
#include <iterator>
#include <set>
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

// ---------------------------------------------------------------------
// Per-logical-processor identity and hybrid core class
// ---------------------------------------------------------------------

namespace {

struct LogicalCpu {
    WORD group;
    int bit;
    int coreOrdinal;
    int efficiency;
};

bool enumerate_logical_cpus(std::vector<LogicalCpu>& out) {
    DWORD length = 0;
    GetLogicalProcessorInformationEx(RelationProcessorCore, nullptr, &length);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || length == 0)
        return false;

    std::vector<char> buffer(length);
    if (!GetLogicalProcessorInformationEx(
            RelationProcessorCore,
            reinterpret_cast<PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(buffer.data()),
            &length)) {
        return false;
    }

    int ordinal = 0;
    for (DWORD offset = 0; offset < length;) {
        auto* info = reinterpret_cast<PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(buffer.data() + offset);
        if (info->Size == 0)
            break;

        if (info->Relationship == RelationProcessorCore) {
            for (WORD g = 0; g < info->Processor.GroupCount; ++g) {
                const KAFFINITY mask = info->Processor.GroupMask[g].Mask;
                for (int bit = 0; bit < static_cast<int>(sizeof(KAFFINITY) * 8); ++bit) {
                    if (mask & (static_cast<KAFFINITY>(1) << bit)) {
                        out.push_back({info->Processor.GroupMask[g].Group, bit, ordinal,
                                       static_cast<int>(info->Processor.EfficiencyClass)});
                    }
                }
            }
            ++ordinal;
        }
        offset += info->Size;
    }

    std::sort(out.begin(), out.end(), [](const LogicalCpu& a, const LogicalCpu& b) {
        return a.group != b.group ? a.group < b.group : a.bit < b.bit;
    });
    return !out.empty();
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
        std::vector<LogicalCpu> cpus;
        if (!enumerate_logical_cpus(cpus) || static_cast<size_t>(index) >= cpus.size())
            return 0;

        const LogicalCpu& cpu = cpus[static_cast<size_t>(index)];
        if (coreId)
            *coreId = cpu.coreOrdinal;

        // EfficiencyClass is 0 on every core of a non-hybrid CPU; only more than one value means a real split.
        std::set<int> distinct;
        for (const auto& c : cpus)
            distinct.insert(c.efficiency);

        if (distinct.size() < 2)
            return 1;

        if (classCount)
            *classCount = static_cast<int>(distinct.size());
        if (efficiencyClass)
            *efficiencyClass = static_cast<int>(std::distance(distinct.begin(), distinct.find(cpu.efficiency)));
        return 1;
    }
    catch (...) {
        return 0;
    }
}
