// hardware_info.cpp — CPU topology, storage volumes, fan sensors and memory.
//
// Contract shared by every function here:
//   * plain C ABI, 32/64-bit widths explicit (byte counts are long long);
//   * never throws across the boundary;
//   * "unknown" is reported as -1 / return 0 — never as a fabricated value;
//   * caller-supplied buffers are size-checked and always NUL-terminated.
//
// Physical RAM / DIMM information:
//   * Windows: implemented by the Windows provider/platform layer.
//   * Linux: parsed directly from the kernel-exposed SMBIOS/DMI table.
//   * No dmidecode process, shell command, or external executable is used.

#include "../include/native_engine.h"

#include <cctype>
#include <cerrno>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

#ifndef _WIN32
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

static int copy_out(
    char* dst,
    int size,
    const std::string& src) {

    if (!dst || size <= 0)
        return 0;

    const size_t capacity =
        static_cast<size_t>(size - 1);

    const size_t n =
        src.size() < capacity
            ? src.size()
            : capacity;

    if (n > 0)
        std::memcpy(dst, src.data(), n);

    dst[n] = '\0';

    return static_cast<int>(n);
}

// Writes through an optional out-pointer.
// Null pointers are valid and simply mean the caller does not want
// that particular value.
static inline void si_mem_put(
    long long* p,
    long long value) {

    if (p)
        *p = value;
}

#ifdef _WIN32

// =====================================================================
// Windows
// =====================================================================

#include <windows.h>
#include <psapi.h>

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
// Storage
// ---------------------------------------------------------------------

int si_get_storage_volume(
    int index,
    char* mountOut,
    int mountSize,
    char* fsOut,
    int fsSize,
    long long* totalBytes,
    long long* freeBytes) {

    if (index < 0)
        return 0;

    try {
        const DWORD mask =
            GetLogicalDrives();

        int seen = 0;

        for (int i = 0; i < 26; ++i) {

            if (!(mask & (1u << i)))
                continue;

            char root[4] = {
                static_cast<char>('A' + i),
                ':',
                '\\',
                '\0'
            };

            const UINT type =
                GetDriveTypeA(root);

            if (type != DRIVE_FIXED &&
                type != DRIVE_REMOVABLE) {
                continue;
            }

            ULARGE_INTEGER available{};
            ULARGE_INTEGER total{};
            ULARGE_INTEGER freeAll{};

            if (!GetDiskFreeSpaceExA(
                    root,
                    &available,
                    &total,
                    &freeAll)) {
                continue;
            }

            if (seen++ != index)
                continue;

            char fsName[64] = {};

            GetVolumeInformationA(
                root,
                nullptr,
                0,
                nullptr,
                nullptr,
                nullptr,
                fsName,
                sizeof(fsName)
            );

            copy_out(
                mountOut,
                mountSize,
                root
            );

            copy_out(
                fsOut,
                fsSize,
                fsName
            );

            if (totalBytes)
                *totalBytes =
                    static_cast<long long>(
                        total.QuadPart
                    );

            if (freeBytes)
                *freeBytes =
                    static_cast<long long>(
                        available.QuadPart
                    );

            return 1;
        }
    }
    catch (...) {
    }

    return 0;
}

// ---------------------------------------------------------------------
// Fan
// ---------------------------------------------------------------------

// Windows has no vendor-neutral fan RPM API.
// OEM WMI interfaces or kernel drivers are required on some machines.
// Do not report a fabricated zero.

int si_get_fan(
    int,
    char*,
    int,
    int*) {

    return 0;
}

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

#else

// =====================================================================
// Linux
// =====================================================================

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <set>
#include <sstream>
#include <sys/statvfs.h>
#include <unistd.h>

namespace fs = std::filesystem;

// ---------------------------------------------------------------------
// Generic Linux helpers
// ---------------------------------------------------------------------

static bool read_int(
    const std::string& path,
    long long& out) {

    std::ifstream file(path);

    if (!file)
        return false;

    return static_cast<bool>(
        file >> out
    );
}

static std::string read_line(
    const std::string& path) {

    std::ifstream file(path);

    if (!file)
        return {};

    std::string value;

    std::getline(
        file,
        value
    );

    return value;
}

static std::vector<std::string> sorted_children(
    const std::string& directory) {

    std::vector<std::string> result;

    std::error_code ec;

    fs::directory_iterator iterator(
        directory,
        fs::directory_options::skip_permission_denied,
        ec
    );

    for (fs::directory_iterator end;
         !ec && iterator != end;
         iterator.increment(ec)) {

        result.push_back(
            iterator->path().string()
        );
    }

    std::sort(
        result.begin(),
        result.end()
    );

    return result;
}

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
// Storage
// =====================================================================

static std::string unescape_mount(
    const std::string& value) {

    std::string result;

    for (size_t i = 0;
         i < value.size();
         ++i) {

        if (value[i] == '\\' &&
            i + 3 < value.size() &&
            std::isdigit(
                static_cast<unsigned char>(
                    value[i + 1])) &&
            std::isdigit(
                static_cast<unsigned char>(
                    value[i + 2])) &&
            std::isdigit(
                static_cast<unsigned char>(
                    value[i + 3]))) {

            result += static_cast<char>(
                (value[i + 1] - '0') * 64 +
                (value[i + 2] - '0') * 8 +
                (value[i + 3] - '0')
            );

            i += 3;
        }
        else {
            result += value[i];
        }
    }

    return result;
}

struct Volume {
    std::string mount;
    std::string fstype;
};

static std::vector<Volume> list_volumes() {

    std::vector<Volume> volumes;

    std::set<std::string> seenDevices;

    std::ifstream file(
        "/proc/mounts"
    );

    if (!file)
        return volumes;

    std::string line;

    while (std::getline(
        file,
        line)) {

        std::istringstream stream(line);

        std::string device;
        std::string mount;
        std::string type;

        if (!(stream >>
              device >>
              mount >>
              type)) {
            continue;
        }

        if (device.compare(
                0,
                5,
                "/dev/") != 0) {
            continue;
        }

        if (device.compare(
                0,
                9,
                "/dev/loop") == 0) {
            continue;
        }

        if (type == "squashfs" ||
            type == "iso9660" ||
            type == "udf") {
            continue;
        }

        if (!seenDevices.insert(
                device).second) {
            continue;
        }

        volumes.push_back({
            unescape_mount(mount),
            type
        });
    }

    return volumes;
}

int si_get_storage_volume(
    int index,
    char* mountOut,
    int mountSize,
    char* fsOut,
    int fsSize,
    long long* totalBytes,
    long long* freeBytes) {

    if (index < 0)
        return 0;

    try {
        int seen = 0;

        for (const auto& volume :
             list_volumes()) {

            struct statvfs status{};

            if (statvfs(
                    volume.mount.c_str(),
                    &status) != 0 ||
                status.f_blocks == 0) {
                continue;
            }

            if (seen++ != index)
                continue;

            copy_out(
                mountOut,
                mountSize,
                volume.mount
            );

            copy_out(
                fsOut,
                fsSize,
                volume.fstype
            );

            if (totalBytes) {

                *totalBytes =
                    static_cast<long long>(
                        static_cast<
                            unsigned long long>(
                            status.f_blocks
                        ) *
                        status.f_frsize
                    );
            }

            if (freeBytes) {

                *freeBytes =
                    static_cast<long long>(
                        static_cast<
                            unsigned long long>(
                            status.f_bavail
                        ) *
                        status.f_frsize
                    );
            }

            return 1;
        }
    }
    catch (...) {
    }

    return 0;
}

// =====================================================================
// Fans
// =====================================================================

int si_get_fan(
    int index,
    char* labelOut,
    int labelSize,
    int* rpmOut) {

    if (index < 0)
        return 0;

    try {
        int seen = 0;

        for (const auto& hw :
             sorted_children(
                 "/sys/class/hwmon")) {

            const std::string chip =
                read_line(
                    hw + "/name"
                );

            for (const auto& file :
                 sorted_children(hw)) {

                const std::string base =
                    fs::path(file)
                        .filename()
                        .string();

                if (base.size() < 10 ||
                    base.compare(
                        0,
                        3,
                        "fan") != 0 ||
                    base.compare(
                        base.size() - 6,
                        6,
                        "_input") != 0) {
                    continue;
                }

                long long rpm = -1;

                if (!read_int(
                        file,
                        rpm) ||
                    rpm < 0) {
                    continue;
                }

                if (seen++ != index)
                    continue;

                const std::string stem =
                    file.substr(
                        0,
                        file.size() - 6
                    );

                std::string label =
                    read_line(
                        stem + "_label"
                    );

                if (label.empty()) {

                    label =
                        chip.empty()
                            ? std::string("hwmon")
                            : chip;

                    label += " ";
                    label +=
                        base.substr(
                            0,
                            base.size() - 6
                        );
                }

                copy_out(
                    labelOut,
                    labelSize,
                    label
                );

                if (rpmOut)
                    *rpmOut =
                        static_cast<int>(
                            rpm
                        );

                return 1;
            }
        }
    }
    catch (...) {
    }

    return 0;
}

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

#endif

// =====================================================================
// Physical RAM / DIMM hardware information
// =====================================================================
//
// Linux source:
//
//   /sys/firmware/dmi/tables/DMI
//
// SMBIOS structures:
//
//   Type 16 = Physical Memory Array
//   Type 17 = Memory Device
//
// No dmidecode process is used.
//
// Unknown:
//
//   strings -> ""
//   numbers -> -1
//   unavailable enumeration -> return 0
//
// Empty Type 17 slots are not returned as installed modules.
// The total slot count comes from Type 16.
//

struct SiDmiMemoryArray {
    unsigned short handle = 0;

    long long maxCapacityBytes = -1;

    int slotCount = -1;

    int errorCorrection = -1;
};

struct SiDmiMemoryModule {
    unsigned short arrayHandle = 0;

    long long capacityBytes = -1;
    long long speedMTs = -1;
    long long configuredSpeedMTs = -1;

    int dataWidth = -1;
    int totalWidth = -1;
    int rank = -1;

    int formFactor = -1;
    int memoryType = -1;

    std::string manufacturer;
    std::string partNumber;
    std::string serialNumber;
    std::string locator;
    std::string bankLocator;
};

// =====================================================================
// SMBIOS primitive readers
// =====================================================================

static unsigned short si_dmi_u16(
    const unsigned char* p) {

    if (!p)
        return 0;

    return static_cast<unsigned short>(
        static_cast<unsigned short>(p[0]) |
        static_cast<unsigned short>(
            static_cast<unsigned short>(p[1])
            << 8
        )
    );
}

static unsigned int si_dmi_u32(
    const unsigned char* p) {

    if (!p)
        return 0;

    return
        static_cast<unsigned int>(p[0]) |
        (static_cast<unsigned int>(p[1]) << 8) |
        (static_cast<unsigned int>(p[2]) << 16) |
        (static_cast<unsigned int>(p[3]) << 24);
}

static unsigned long long si_dmi_u64(
    const unsigned char* p) {

    if (!p)
        return 0;

    return
        static_cast<unsigned long long>(p[0]) |
        (static_cast<unsigned long long>(p[1]) << 8) |
        (static_cast<unsigned long long>(p[2]) << 16) |
        (static_cast<unsigned long long>(p[3]) << 24) |
        (static_cast<unsigned long long>(p[4]) << 32) |
        (static_cast<unsigned long long>(p[5]) << 40) |
        (static_cast<unsigned long long>(p[6]) << 48) |
        (static_cast<unsigned long long>(p[7]) << 56);
}

// =====================================================================
// SMBIOS string resolver
// =====================================================================

static std::string si_dmi_string(
    const unsigned char* record,
    size_t recordSize,
    unsigned char stringIndex) {

    if (!record ||
        recordSize < 4 ||
        stringIndex == 0) {
        return {};
    }

    const size_t formattedLength =
        static_cast<size_t>(
            record[1]
        );

    if (formattedLength < 4 ||
        formattedLength >= recordSize) {
        return {};
    }

    size_t position =
        formattedLength;

    unsigned int currentIndex = 1;

    while (position < recordSize) {

        if (record[position] == '\0') {

            if (position + 1 < recordSize &&
                record[position + 1] == '\0') {
                break;
            }

            ++position;
            ++currentIndex;
            continue;
        }

        const size_t start =
            position;

        while (position < recordSize &&
               record[position] != '\0') {

            ++position;
        }

        if (currentIndex ==
            static_cast<unsigned int>(
                stringIndex)) {

            return std::string(
                reinterpret_cast<const char*>(
                    record + start
                ),
                position - start
            );
        }

        if (position >= recordSize)
            break;

        ++position;
        ++currentIndex;
    }

    return {};
}

// =====================================================================
// SMBIOS record size
// =====================================================================

static size_t si_dmi_record_size(
    const unsigned char* record,
    size_t remaining) {

    if (!record ||
        remaining < 4) {
        return 0;
    }

    const size_t formattedLength =
        static_cast<size_t>(
            record[1]
        );

    if (formattedLength < 4 ||
        formattedLength > remaining) {
        return 0;
    }

    size_t position =
        formattedLength;

    while (position + 1 < remaining) {

        if (record[position] == '\0' &&
            record[position + 1] == '\0') {

            return position + 2;
        }

        ++position;
    }

    return 0;
}

// =====================================================================
// SMBIOS structure-table source (the only platform-specific part)
// =====================================================================
//
// Both loaders produce the same thing: the raw SMBIOS *structure table*
// (a run of Type N records), with no container header. Everything after
// this point is platform independent and is exercised by
// tests/native/smbios_parse_test.cpp using hand-built tables.

// Why the firmware table could not be loaded. Surfaced to the backend through
// si_get_memory_hardware_status() so the UI can say what to do about it,
// instead of one vague "unavailable" for four different situations.
enum SiDmiReason {
    SI_DMI_OK = 0,
    SI_DMI_NOT_PRESENT = 1,        // no table on this system (many VMs, some ARM boards)
    SI_DMI_PERMISSION = 2,         // table exists but this user may not read it
    SI_DMI_STALE_SNAPSHOT = 3,     // saved snapshot is from an earlier boot
    SI_DMI_INVALID = 4             // present but unreadable / not SMBIOS
};

// open()/fopen() errno -> reason.
[[maybe_unused]] static int si_dmi_open_failure_reason(int err) {

    switch (err) {
        case EACCES:
        case EPERM:
            return SI_DMI_PERMISSION;

        case ENOENT:
        case ENOTDIR:
            return SI_DMI_NOT_PRESENT;

        default:
            return SI_DMI_INVALID;
    }
}

// Windows hands back a RawSMBIOSData container, not the bare table:
//
//   BYTE  Used20CallingMethod
//   BYTE  SMBIOSMajorVersion
//   BYTE  SMBIOSMinorVersion
//   BYTE  DmiRevision
//   DWORD Length                  <- number of table bytes that follow
//   BYTE  SMBIOSTableData[Length]
//
// This strips that 8-byte header. It is platform independent (and compiled
// everywhere) so it can be tested with hand-built buffers on any host.
// The header's Length is never trusted over the bytes actually received.
[[maybe_unused]] static bool si_dmi_extract_rsmb(
    const unsigned char* raw,
    size_t rawSize,
    std::vector<unsigned char>& table) {

    table.clear();

    if (!raw ||
        rawSize <= 8) {
        return false;
    }

    size_t tableLength =
        static_cast<size_t>(
            si_dmi_u32(
                raw + 4
            )
        );

    if (tableLength > rawSize - 8)
        tableLength = rawSize - 8;

    if (tableLength < 4)
        return false;

    table.assign(
        raw + 8,
        raw + 8 + tableLength
    );

    return true;
}

// =====================================================================
// Memory-only SMBIOS snapshot (Linux, for unprivileged use)
// =====================================================================
//
// Linux only lets root read the firmware table, because it also carries the
// machine's serial number and UUID. A small root helper therefore saves just
// the memory records (Type 16 + Type 17 + the end marker) to a world-readable
// file, and the unprivileged app reads that instead. Nothing else from the
// firmware table is ever copied.
//
// File layout (64-byte header, then the filtered structure table):
//
//   0..15   magic "SI-SMBIOS-MEM-01"
//   16..55  boot id of the boot that produced it (NUL padded)
//   56..59  table length, little endian
//   60..63  reserved (zero)
//
// The boot id lets the reader refuse a snapshot taken before the last
// restart (RAM can only be swapped across a power cycle), so an old file can
// never silently show modules that are no longer installed.
//
// The helpers below are pure (no I/O) so they are unit-tested on every host.

static const size_t SI_SNAP_HEADER = 64;
static const size_t SI_SNAP_BOOTID = 40;
static const char SI_SNAP_MAGIC[16] = {
    'S', 'I', '-', 'S', 'M', 'B', 'I', 'O', 'S', '-', 'M', 'E', 'M', '-', '0', '1'
};

enum SiSnapshotStatus {
    SI_SNAP_OK = 0,
    SI_SNAP_INVALID = 1,
    SI_SNAP_STALE = 2
};

// Keeps only Type 16, Type 17 and the end marker, byte for byte (string sets
// included). Returns false when the table has no memory records at all.
[[maybe_unused]] static bool si_dmi_filter_memory_records(
    const unsigned char* data,
    size_t size,
    std::vector<unsigned char>& out) {

    out.clear();

    if (!data ||
        size == 0) {
        return false;
    }

    bool haveMemory = false;

    size_t offset = 0;

    while (offset + 4 <= size) {

        const unsigned char type =
            data[offset];

        const size_t recordSize =
            si_dmi_record_size(
                data + offset,
                size - offset
            );

        if (recordSize == 0)
            break;

        if (type == 127)
            break;

        if (type == 16 ||
            type == 17) {

            out.insert(
                out.end(),
                data + offset,
                data + offset + recordSize
            );

            haveMemory = true;
        }

        offset += recordSize;
    }

    if (!haveMemory) {
        out.clear();
        return false;
    }

    // Terminate the table the way firmware does.
    static const unsigned char endRecord[] = {
        127, 4, 0xFF, 0xFF, 0, 0
    };

    out.insert(
        out.end(),
        endRecord,
        endRecord + sizeof(endRecord)
    );

    return true;
}

[[maybe_unused]] static void si_snapshot_encode(
    const std::string& bootId,
    const std::vector<unsigned char>& table,
    std::vector<unsigned char>& out) {

    out.assign(SI_SNAP_HEADER, 0);

    std::memcpy(
        out.data(),
        SI_SNAP_MAGIC,
        sizeof(SI_SNAP_MAGIC)
    );

    const size_t idLength =
        bootId.size() < SI_SNAP_BOOTID - 1
            ? bootId.size()
            : SI_SNAP_BOOTID - 1;

    std::memcpy(
        out.data() + 16,
        bootId.data(),
        idLength
    );

    const unsigned int length =
        static_cast<unsigned int>(table.size());

    for (int i = 0; i < 4; ++i) {
        out[56 + i] =
            static_cast<unsigned char>(
                (length >> (8 * i)) & 0xFF
            );
    }

    out.insert(
        out.end(),
        table.begin(),
        table.end()
    );
}

// `currentBootId` empty = the running boot id is unknown, so staleness cannot
// be judged and the snapshot is accepted.
[[maybe_unused]] static int si_snapshot_decode(
    const unsigned char* data,
    size_t size,
    const std::string& currentBootId,
    std::vector<unsigned char>& table) {

    table.clear();

    if (!data ||
        size < SI_SNAP_HEADER ||
        std::memcmp(
            data,
            SI_SNAP_MAGIC,
            sizeof(SI_SNAP_MAGIC)) != 0) {
        return SI_SNAP_INVALID;
    }

    const size_t length =
        static_cast<size_t>(
            si_dmi_u32(
                data + 56
            )
        );

    if (length < 4 ||
        length > size - SI_SNAP_HEADER) {
        return SI_SNAP_INVALID;
    }

    std::string snapshotBootId;

    for (size_t i = 0; i < SI_SNAP_BOOTID; ++i) {

        const char c =
            static_cast<char>(
                data[16 + i]
            );

        if (c == '\0')
            break;

        snapshotBootId.push_back(c);
    }

    if (!currentBootId.empty() &&
        snapshotBootId != currentBootId) {
        return SI_SNAP_STALE;
    }

    table.assign(
        data + SI_SNAP_HEADER,
        data + SI_SNAP_HEADER + length
    );

    return SI_SNAP_OK;
}

#ifdef _WIN32

// Windows: GetSystemFirmwareTable('RSMB'). No admin rights needed, and no
// wmic / PowerShell subprocess.
static bool si_dmi_load_table_ex(
    std::vector<unsigned char>& table,
    int& reason) {

    table.clear();

    reason = SI_DMI_NOT_PRESENT;

    const DWORD signature =
        (static_cast<DWORD>('R') << 24) |
        (static_cast<DWORD>('S') << 16) |
        (static_cast<DWORD>('M') << 8) |
        static_cast<DWORD>('B');

    const UINT size =
        GetSystemFirmwareTable(
            signature,
            0,
            nullptr,
            0
        );

    if (size == 0)
        return false;

    reason = SI_DMI_INVALID;

    // Header is 8 bytes; also a defensive upper bound.
    if (size <= 8 ||
        size > 16u * 1024u * 1024u) {
        return false;
    }

    std::vector<unsigned char> raw(size);

    const UINT got =
        GetSystemFirmwareTable(
            signature,
            0,
            raw.data(),
            size
        );

    if (got <= 8 ||
        got > size) {
        return false;
    }

    if (!si_dmi_extract_rsmb(
            raw.data(),
            got,
            table)) {
        return false;
    }

    reason = SI_DMI_OK;

    return true;
}

#else

// Reads a whole file, reporting errno when it cannot be opened.
static bool si_read_whole_file(
    const char* path,
    std::vector<unsigned char>& data,
    int& err) {

    data.clear();

    err = 0;

    FILE* file =
        std::fopen(path, "rb");

    if (!file) {
        err = errno;
        return false;
    }

    unsigned char chunk[4096];

    bool ok = true;

    for (;;) {

        const size_t got =
            std::fread(chunk, 1, sizeof(chunk), file);

        if (got > 0)
            data.insert(data.end(), chunk, chunk + got);

        // Defensive upper bound.
        if (data.size() > 16u * 1024u * 1024u) {
            ok = false;
            break;
        }

        if (got < sizeof(chunk)) {

            if (std::ferror(file))
                ok = false;

            break;
        }
    }

    std::fclose(file);

    if (!ok) {
        data.clear();
        err = EIO;
    }

    return ok;
}

static std::string si_current_boot_id() {

    std::vector<unsigned char> raw;

    int err = 0;

    if (!si_read_whole_file(
            "/proc/sys/kernel/random/boot_id",
            raw,
            err)) {
        return std::string();
    }

    std::string id(raw.begin(), raw.end());

    while (!id.empty() &&
           (id.back() == '\n' ||
            id.back() == '\r' ||
            id.back() == ' ')) {
        id.pop_back();
    }

    return id;
}

// Where the root helper saves the memory snapshot. SYSTEMINFO_SMBIOS_SNAPSHOT
// overrides it (used by tests and unusual installs).
static std::string si_snapshot_path() {

    const char* override_path =
        std::getenv("SYSTEMINFO_SMBIOS_SNAPSHOT");

    if (override_path &&
        override_path[0] != '\0') {
        return std::string(override_path);
    }

    return std::string("/var/lib/system-info/smbios-memory.bin");
}

static const char* const SI_LIVE_DMI_TABLE =
    "/sys/firmware/dmi/tables/DMI";

// Linux: the live firmware table first (works as root, or where the system
// grants read access); otherwise the memory-only snapshot saved by the root
// helper. `reason` says why nothing could be loaded.
static bool si_dmi_load_table_ex(
    std::vector<unsigned char>& table,
    int& reason) {

    table.clear();

    int liveError = 0;

    std::vector<unsigned char> raw;

    if (si_read_whole_file(
            SI_LIVE_DMI_TABLE,
            raw,
            liveError)) {

        if (raw.empty()) {
            reason = SI_DMI_INVALID;
            return false;
        }

        table.swap(raw);

        reason = SI_DMI_OK;

        return true;
    }

    std::vector<unsigned char> snapshot;

    int snapshotError = 0;

    if (si_read_whole_file(
            si_snapshot_path().c_str(),
            snapshot,
            snapshotError)) {

        const int status =
            si_snapshot_decode(
                snapshot.data(),
                snapshot.size(),
                si_current_boot_id(),
                table
            );

        if (status == SI_SNAP_OK) {
            reason = SI_DMI_OK;
            return true;
        }

        reason =
            status == SI_SNAP_STALE
                ? SI_DMI_STALE_SNAPSHOT
                : SI_DMI_INVALID;

        return false;
    }

    // No snapshot either: report why the live table was not readable.
    reason =
        si_dmi_open_failure_reason(
            liveError
        );

    return false;
}

#endif

static bool si_dmi_load_table(
    std::vector<unsigned char>& table) {

    int reason = SI_DMI_INVALID;

    return si_dmi_load_table_ex(
        table,
        reason
    );
}

// =====================================================================
// Type 17 memory-size conversion
// =====================================================================
//
// Type 17 Size:
//
//   0x0000      = empty
//   0xFFFF      = unknown
//   0x7FFF      = use Extended Size
//   bit 15 = 0  = MiB
//   bit 15 = 1  = KiB
//

static long long si_dmi_size_to_bytes(
    unsigned short sizeField,
    unsigned int extendedSizeField) {

    if (sizeField == 0)
        return 0;

    if (sizeField == 0xFFFF)
        return -1;

    if (sizeField == 0x7FFF) {

        if (extendedSizeField == 0)
            return -1;

        const unsigned long long bytes =
            static_cast<unsigned long long>(
                extendedSizeField
            ) *
            1024ULL *
            1024ULL;

        if (bytes >
            static_cast<unsigned long long>(
                LLONG_MAX)) {
            return -1;
        }

        return static_cast<long long>(
            bytes
        );
    }

    const unsigned long long raw =
        static_cast<unsigned long long>(
            sizeField & 0x7FFF
        );

    if (raw == 0)
        return 0;

    unsigned long long bytes = 0;

    if (sizeField & 0x8000) {

        // KiB
        bytes =
            raw * 1024ULL;
    }
    else {

        // MiB
        bytes =
            raw *
            1024ULL *
            1024ULL;
    }

    if (bytes >
        static_cast<unsigned long long>(
            LLONG_MAX)) {
        return -1;
    }

    return static_cast<long long>(
        bytes
    );
}

// =====================================================================
// SMBIOS display mappings
// =====================================================================

static std::string si_memory_form_factor(
    int value) {

    switch (value) {
        case 1:  return "Other";
        case 2:  return "Unknown";
        case 3:  return "SIMM";
        case 4:  return "SIP";
        case 5:  return "Chip";
        case 6:  return "DIP";
        case 7:  return "ZIP";
        case 8:  return "Proprietary Card";
        case 9:  return "DIMM";
        case 10: return "TSOP";
        case 11: return "Row of chips";
        case 12: return "RIMM";
        case 13: return "SODIMM";
        case 14: return "SRIMM";
        case 15: return "FB-DIMM";
        default: return {};
    }
}

static std::string si_memory_type(int value) {
    switch (value) {
        case 0x01: return "Other";
        case 0x02: return "Unknown";
        case 0x03: return "DRAM";
        case 0x04: return "EDRAM";
        case 0x05: return "VRAM";
        case 0x06: return "SRAM";
        case 0x07: return "RAM";
        case 0x08: return "ROM";
        case 0x09: return "Flash";
        case 0x0A: return "EEPROM";
        case 0x0B: return "FEPROM";
        case 0x0C: return "EPROM";
        case 0x0D: return "CDRAM";
        case 0x0E: return "3DRAM";
        case 0x0F: return "SDRAM";
        case 0x10: return "SGRAM";
        case 0x11: return "RDRAM";
        case 0x12: return "DDR";
        case 0x13: return "DDR2";
        case 0x14: return "DDR2 FB-DIMM";
        case 0x18: return "DDR3";
        case 0x19: return "FBD2";
        case 0x1A: return "DDR4";
        case 0x1B: return "LPDDR";
        case 0x1C: return "LPDDR2";
        case 0x1D: return "LPDDR3";
        case 0x1E: return "LPDDR4";
        case 0x1F: return "Logical non-volatile device";
        case 0x20: return "HBM";
        case 0x21: return "HBM2";
        case 0x22: return "DDR5";
        case 0x23: return "LPDDR5";
        case 0x24: return "HBM3";
        default:   return {};
    }
}

// =====================================================================
// SMBIOS ECC mapping
// =====================================================================
//
// Public contract:
//
//   0  = explicitly no ECC
//   1  = ECC / error correction exposed
//  -1  = unknown
//
// Type 16 standard values:
//
//   0x03 = None
//   0x04 = Parity
//   0x05 = Single-bit ECC
//   0x06 = Multi-bit ECC
//   0x07 = CRC
//
// Do not invent meanings for unsupported/reserved values.

static int si_dmi_ecc_value(
    int errorCorrection) {

    switch (errorCorrection) {

        case 0x03:
            return 0;

        case 0x05:
        case 0x06:
            return 1;

        default:
            return -1;
    }
}

// =====================================================================
// SMBIOS Type 16 + Type 17 parser
// =====================================================================

// `data`/`size` is a caller-supplied SMBIOS structure table (tests, or a
// provider that already holds one). With data == nullptr the table is
// loaded from the platform instead.
static bool si_dmi_read_memory_devices(
    const unsigned char* data,
    size_t size,
    std::vector<SiDmiMemoryArray>& arrays,
    std::vector<SiDmiMemoryModule>& modules) {

    arrays.clear();
    modules.clear();

    std::vector<unsigned char> table;

    if (data) {
        if (size == 0 ||
            size > 16u * 1024u * 1024u) {
            return false;
        }

        table.assign(data, data + size);
    }
    else if (!si_dmi_load_table(table)) {
        return false;
    }

    size_t position = 0;

    while (position + 4 <= table.size()) {

        const unsigned char* record =
            table.data() + position;

        const unsigned char type =
            record[0];

        const unsigned char length =
            record[1];

        const size_t remaining =
            table.size() - position;

        const size_t recordSize =
            si_dmi_record_size(
                record,
                remaining
            );

        if (recordSize == 0)
            break;

        if (length < 4 ||
            static_cast<size_t>(length) >
                recordSize) {
            break;
        }

        // SMBIOS Type 127 = End Of Table.
        if (type == 127)
            break;

        // =============================================================
        // Type 16: Physical Memory Array
        // =============================================================
        //
        // 0x04 Location
        // 0x05 Use
        // 0x06 Error Correction
        // 0x07 Maximum Capacity
        // 0x0B Error Information Handle
        // 0x0D Number Of Memory Devices
        //
        // If Maximum Capacity == 0x80000000, the extended 64-bit
        // capacity is stored at 0x0F and is expressed in bytes.
        //

        if (type == 16 &&
            length >= 0x0F) {

            SiDmiMemoryArray array;

            array.handle =
                si_dmi_u16(
                    record + 0x02
                );

            array.errorCorrection =
                static_cast<int>(
                    record[0x06]
                );

            const unsigned int
                maxCapacityKB =
                    si_dmi_u32(
                        record + 0x07
                    );

            if (maxCapacityKB ==
                0x80000000U) {

                if (length >= 0x17) {

                    const unsigned long long
                        extended =
                            si_dmi_u64(
                                record + 0x0F
                            );

                    if (extended > 0 &&
                        extended <=
                            static_cast<
                                unsigned long long>(
                                LLONG_MAX)) {

                        array.maxCapacityBytes =
                            static_cast<long long>(
                                extended
                            );
                    }
                }
            }
            else if (maxCapacityKB != 0 &&
                     maxCapacityKB !=
                         0xFFFFFFFFU) {

                const unsigned long long
                    bytes =
                        static_cast<
                            unsigned long long>(
                            maxCapacityKB
                        ) * 1024ULL;

                if (bytes <=
                    static_cast<
                        unsigned long long>(
                        LLONG_MAX)) {

                    array.maxCapacityBytes =
                        static_cast<long long>(
                            bytes
                        );
                }
            }

            const unsigned short
                slotCount =
                    si_dmi_u16(
                        record + 0x0D
                    );

            if (slotCount != 0 &&
                slotCount != 0xFFFF) {

                array.slotCount =
                    static_cast<int>(
                        slotCount
                    );
            }

            arrays.push_back(
                std::move(array)
            );
        }

        // =============================================================
        // Type 17: Memory Device
        // =============================================================
        //
        // 0x04 Physical Memory Array Handle
        // 0x08 Total Width
        // 0x0A Data Width
        // 0x0C Size
        // 0x0E Form Factor
        // 0x10 Device Locator
        // 0x11 Bank Locator
        // 0x12 Memory Type
        // 0x15 Speed
        // 0x17 Manufacturer
        // 0x18 Serial Number
        // 0x1A Part Number
        // 0x1B Attributes / Rank
        // 0x1C Extended Size
        // 0x20 Configured Memory Speed
        //

        if (type == 17 &&
            length >= 0x1B) {

            SiDmiMemoryModule module;

            module.arrayHandle =
                si_dmi_u16(
                    record + 0x04
                );

            const unsigned short
                sizeField =
                    si_dmi_u16(
                        record + 0x0C
                    );

            unsigned int extendedSize = 0;

            if (length >= 0x20) {

                extendedSize =
                    si_dmi_u32(
                        record + 0x1C
                    );
            }

            module.capacityBytes =
                si_dmi_size_to_bytes(
                    sizeField,
                    extendedSize
                );

            // Size == 0 means this is an empty slot.
            if (module.capacityBytes == 0) {

                position += recordSize;

                continue;
            }

            // ---------------------------------------------------------
            // Width
            // ---------------------------------------------------------

            const unsigned short
                totalWidth =
                    si_dmi_u16(
                        record + 0x08
                    );

            const unsigned short
                dataWidth =
                    si_dmi_u16(
                        record + 0x0A
                    );

            if (totalWidth != 0 &&
                totalWidth != 0xFFFF) {

                module.totalWidth =
                    static_cast<int>(
                        totalWidth
                    );
            }

            if (dataWidth != 0 &&
                dataWidth != 0xFFFF) {

                module.dataWidth =
                    static_cast<int>(
                        dataWidth
                    );
            }

            // ---------------------------------------------------------
            // Form factor / memory type
            // ---------------------------------------------------------

            module.formFactor =
                static_cast<int>(
                    record[0x0E]
                );

    module.memoryType =
    static_cast<int>(
        record[0x12]
    );


            // ---------------------------------------------------------
            // Speed
            // ---------------------------------------------------------

            if (length >= 0x17) {

                const unsigned short
                    speed =
                        si_dmi_u16(
                            record + 0x15
                        );

                if (speed != 0 &&
                    speed != 0xFFFF) {

                    module.speedMTs =
                        static_cast<long long>(
                            speed
                        );
                }
            }

            // ---------------------------------------------------------
            // Strings
            // ---------------------------------------------------------

            module.locator =
                si_dmi_string(
                    record,
                    recordSize,
                    record[0x10]
                );

            module.bankLocator =
                si_dmi_string(
                    record,
                    recordSize,
                    record[0x11]
                );

            module.manufacturer =
                si_dmi_string(
                    record,
                    recordSize,
                    record[0x17]
                );

            module.serialNumber =
                si_dmi_string(
                    record,
                    recordSize,
                    record[0x18]
                );

            module.partNumber =
                si_dmi_string(
                    record,
                    recordSize,
                    record[0x1A]
                );

            // ---------------------------------------------------------
            // Rank
            // ---------------------------------------------------------
            //
            // SMBIOS Type 17 Attributes:
            //
            //   bits 7-4 = reserved
            //   bits 3-0 = rank
            //
            // Rank 0 means unknown.
            //

            if (length >= 0x1C) {

                const unsigned char
                    attributes =
                        record[0x1B];

                const unsigned int
                    rank =
                        static_cast<unsigned int>(
                            attributes & 0x0F
                        );

                module.rank =
                    rank == 0
                        ? -1
                        : static_cast<int>(
                            rank
                        );
            }

            // ---------------------------------------------------------
            // Configured memory speed
            // ---------------------------------------------------------

            if (length >= 0x22) {

                const unsigned short
                    configuredSpeed =
                        si_dmi_u16(
                            record + 0x20
                        );

                if (configuredSpeed != 0 &&
                    configuredSpeed != 0xFFFF) {

                    module.configuredSpeedMTs =
                        static_cast<long long>(
                            configuredSpeed
                        );
                }
            }

            modules.push_back(
                std::move(module)
            );
        }

        position += recordSize;
    }

    return !arrays.empty() ||
           !modules.empty();
}

// =====================================================================
// Find installed module
// =====================================================================

static bool si_dmi_get_memory_module(
    const unsigned char* data,
    size_t size,
    int index,
    std::vector<SiDmiMemoryArray>& arrays,
    std::vector<SiDmiMemoryModule>& modules) {

    if (index < 0)
        return false;

    if (!si_dmi_read_memory_devices(
            data,
            size,
            arrays,
            modules)) {
        return false;
    }

    return index <
        static_cast<int>(
            modules.size()
        );
}

// =====================================================================
// Public DIMM API
// =====================================================================

static int si_memory_module_impl(
    const unsigned char* tbl,
    size_t len,
    int index,
    char* manufacturerOut,
    int manufacturerSize,
    char* partNumberOut,
    int partNumberSize,
    char* serialNumberOut,
    int serialNumberSize,
    char* locatorOut,
    int locatorSize,
    char* bankLocatorOut,
    int bankLocatorSize,
    char* formFactorOut,
    int formFactorSize,
    char* memoryTypeOut,
    int memoryTypeSize,
    long long* capacityBytesOut,
    long long* speedMTsOut,
    long long* configuredSpeedMTsOut,
    int* dataWidthOut,
    int* totalWidthOut,
    int* rankOut,
    int* eccOut) {

    // ---------------------------------------------------------------
    // Initialize all outputs first.
    // ---------------------------------------------------------------

    copy_out(
        manufacturerOut,
        manufacturerSize,
        {}
    );

    copy_out(
        partNumberOut,
        partNumberSize,
        {}
    );

    copy_out(
        serialNumberOut,
        serialNumberSize,
        {}
    );

    copy_out(
        locatorOut,
        locatorSize,
        {}
    );

    copy_out(
        bankLocatorOut,
        bankLocatorSize,
        {}
    );

    copy_out(
        formFactorOut,
        formFactorSize,
        {}
    );

    copy_out(
        memoryTypeOut,
        memoryTypeSize,
        {}
    );

    si_mem_put(
        capacityBytesOut,
        -1
    );

    si_mem_put(
        speedMTsOut,
        -1
    );

    si_mem_put(
        configuredSpeedMTsOut,
        -1
    );

    if (dataWidthOut)
        *dataWidthOut = -1;

    if (totalWidthOut)
        *totalWidthOut = -1;

    if (rankOut)
        *rankOut = -1;

    if (eccOut)
        *eccOut = -1;

    if (index < 0)
        return 0;

    try {
        std::vector<SiDmiMemoryArray>
            arrays;

        std::vector<SiDmiMemoryModule>
            modules;

        if (!si_dmi_get_memory_module(
                tbl,
                len,
                index,
                arrays,
                modules)) {
            return 0;
        }

        if (index >=
            static_cast<int>(
                modules.size())) {
            return 0;
        }

        const auto& module =
            modules[
                static_cast<size_t>(
                    index
                )
            ];

        copy_out(
            manufacturerOut,
            manufacturerSize,
            module.manufacturer
        );

        copy_out(
            partNumberOut,
            partNumberSize,
            module.partNumber
        );

        copy_out(
            serialNumberOut,
            serialNumberSize,
            module.serialNumber
        );

        copy_out(
            locatorOut,
            locatorSize,
            module.locator
        );

        copy_out(
            bankLocatorOut,
            bankLocatorSize,
            module.bankLocator
        );

        copy_out(
            formFactorOut,
            formFactorSize,
            si_memory_form_factor(
                module.formFactor
            )
        );

        copy_out(
            memoryTypeOut,
            memoryTypeSize,
            si_memory_type(
                module.memoryType
            )
        );

        si_mem_put(
            capacityBytesOut,
            module.capacityBytes
        );

        si_mem_put(
            speedMTsOut,
            module.speedMTs
        );

        si_mem_put(
            configuredSpeedMTsOut,
            module.configuredSpeedMTs
        );

        if (dataWidthOut)
            *dataWidthOut =
                module.dataWidth;

        if (totalWidthOut)
            *totalWidthOut =
                module.totalWidth;

        if (rankOut)
            *rankOut =
                module.rank;

        // ECC belongs to the physical memory array.
        for (const auto& array :
             arrays) {

            if (array.handle !=
                module.arrayHandle) {
                continue;
            }

            if (eccOut) {

                *eccOut =
                    si_dmi_ecc_value(
                        array.errorCorrection
                    );
            }

            break;
        }

        return 1;
    }
    catch (...) {
        return 0;
    }
}

// =====================================================================
// Physical RAM hardware summary
// =====================================================================

static int si_memory_hardware_summary_impl(
    const unsigned char* tbl,
    size_t len,
    long long* installedBytesOut,
    int* moduleCountOut,
    int* slotCountOut,
    long long* maxCapacityBytesOut,
    long long* maxModuleCapacityBytesOut) {

    si_mem_put(
        installedBytesOut,
        -1
    );

    if (moduleCountOut)
        *moduleCountOut = -1;

    if (slotCountOut)
        *slotCountOut = -1;

    si_mem_put(
        maxCapacityBytesOut,
        -1
    );

    si_mem_put(
        maxModuleCapacityBytesOut,
        -1
    );

    try {
        std::vector<SiDmiMemoryArray>
            arrays;

        std::vector<SiDmiMemoryModule>
            modules;

        if (!si_dmi_read_memory_devices(
                tbl,
                len,
                arrays,
                modules)) {
            return 0;
        }

        // ------------------------------------------------------------
        // Installed physical capacity
        // ------------------------------------------------------------

        long long installed = 0;

        // Type 16 arrays with no populated Type 17 devices (some VMs) say
        // nothing about how much RAM is installed. Reporting 0 there would
        // be a fabricated zero, so the total stays unknown.
        bool installedKnown = !modules.empty();

        for (const auto& module :
             modules) {

            if (module.capacityBytes < 0) {

                installedKnown = false;

                continue;
            }

            if (installed >
                LLONG_MAX -
                    module.capacityBytes) {

                installedKnown = false;

                break;
            }

            installed +=
                module.capacityBytes;
        }

        if (installedKnown) {

            si_mem_put(
                installedBytesOut,
                installed
            );
        }

        // Number of populated Type 17 devices.
        if (moduleCountOut) {

            *moduleCountOut =
                static_cast<int>(
                    modules.size()
                );
        }

        // ------------------------------------------------------------
        // Type 16 array capacity / slot count
        // ------------------------------------------------------------
        //
        // Important:
        //
        // We only report the aggregate when every discovered Type 16
        // array provides a valid value.
        //
        // Reporting "16 GB" from one known array while silently
        // ignoring another unknown array would be misleading.
        //

        long long maxCapacity = 0;

        bool maxCapacityKnown =
            !arrays.empty();

        int slotCount = 0;

        bool slotCountKnown =
            !arrays.empty();

        for (const auto& array :
             arrays) {

            if (array.maxCapacityBytes < 0) {

                maxCapacityKnown =
                    false;
            }
            else if (
                maxCapacity >
                LLONG_MAX -
                    array.maxCapacityBytes) {

                maxCapacityKnown =
                    false;
            }
            else {

                maxCapacity +=
                    array.maxCapacityBytes;
            }

            if (array.slotCount < 0) {

                slotCountKnown =
                    false;
            }
            else if (
                slotCount >
                INT_MAX -
                    array.slotCount) {

                slotCountKnown =
                    false;
            }
            else {

                slotCount +=
                    array.slotCount;
            }
        }

        if (maxCapacityKnown) {

            si_mem_put(
                maxCapacityBytesOut,
                maxCapacity
            );
        }

        if (slotCountOut &&
            slotCountKnown) {

            *slotCountOut =
                slotCount;
        }

        // ------------------------------------------------------------
        // Maximum capacity of one module
        // ------------------------------------------------------------
        //
        // Deliberately unknown.
        //
        // Type 16 tells us the maximum capacity of the physical
        // memory array. It does NOT safely give a per-slot maximum.
        //
        // Never calculate:
        //
        //     max array capacity / number of slots
        //
        // because that would be an inference.
        //

        si_mem_put(
            maxModuleCapacityBytesOut,
            -1
        );

        return 1;
    }
    catch (...) {
        return 0;
    }
}

// =====================================================================
// Public entry points
// =====================================================================

int si_get_memory_module(
    int index,
    char* manufacturerOut, int manufacturerSize,
    char* partNumberOut, int partNumberSize,
    char* serialNumberOut, int serialNumberSize,
    char* locatorOut, int locatorSize,
    char* bankLocatorOut, int bankLocatorSize,
    char* formFactorOut, int formFactorSize,
    char* memoryTypeOut, int memoryTypeSize,
    long long* capacityBytesOut,
    long long* speedMTsOut,
    long long* configuredSpeedMTsOut,
    int* dataWidthOut,
    int* totalWidthOut,
    int* rankOut,
    int* eccOut) {

    return si_memory_module_impl(
        nullptr, 0, index,
        manufacturerOut, manufacturerSize, partNumberOut, partNumberSize,
        serialNumberOut, serialNumberSize, locatorOut, locatorSize,
        bankLocatorOut, bankLocatorSize, formFactorOut, formFactorSize,
        memoryTypeOut, memoryTypeSize, capacityBytesOut, speedMTsOut,
        configuredSpeedMTsOut, dataWidthOut, totalWidthOut, rankOut, eccOut);
}

int si_get_memory_module_from_table(
    const unsigned char* table,
    int tableSize,
    int index,
    char* manufacturerOut, int manufacturerSize,
    char* partNumberOut, int partNumberSize,
    char* serialNumberOut, int serialNumberSize,
    char* locatorOut, int locatorSize,
    char* bankLocatorOut, int bankLocatorSize,
    char* formFactorOut, int formFactorSize,
    char* memoryTypeOut, int memoryTypeSize,
    long long* capacityBytesOut,
    long long* speedMTsOut,
    long long* configuredSpeedMTsOut,
    int* dataWidthOut,
    int* totalWidthOut,
    int* rankOut,
    int* eccOut) {

    // A null/empty table must NOT fall through to the live platform table:
    // this entry point is "parse exactly what I gave you".
    const bool usable = table && tableSize > 0;

    return si_memory_module_impl(
        usable ? table : reinterpret_cast<const unsigned char*>(""),
        usable ? static_cast<size_t>(tableSize) : 0,
        index,
        manufacturerOut, manufacturerSize, partNumberOut, partNumberSize,
        serialNumberOut, serialNumberSize, locatorOut, locatorSize,
        bankLocatorOut, bankLocatorSize, formFactorOut, formFactorSize,
        memoryTypeOut, memoryTypeSize, capacityBytesOut, speedMTsOut,
        configuredSpeedMTsOut, dataWidthOut, totalWidthOut, rankOut, eccOut);
}

int si_get_memory_hardware_summary(
    long long* installedBytesOut,
    int* moduleCountOut,
    int* slotCountOut,
    long long* maxCapacityBytesOut,
    long long* maxModuleCapacityBytesOut) {

    return si_memory_hardware_summary_impl(
        nullptr, 0,
        installedBytesOut, moduleCountOut, slotCountOut,
        maxCapacityBytesOut, maxModuleCapacityBytesOut);
}

int si_get_memory_hardware_summary_from_table(
    const unsigned char* table,
    int tableSize,
    long long* installedBytesOut,
    int* moduleCountOut,
    int* slotCountOut,
    long long* maxCapacityBytesOut,
    long long* maxModuleCapacityBytesOut) {

    const bool usable = table && tableSize > 0;

    return si_memory_hardware_summary_impl(
        usable ? table : reinterpret_cast<const unsigned char*>(""),
        usable ? static_cast<size_t>(tableSize) : 0,
        installedBytesOut, moduleCountOut, slotCountOut,
        maxCapacityBytesOut, maxModuleCapacityBytesOut);
}

// ---------------------------------------------------------------------
// Why physical memory details are (not) available
// ---------------------------------------------------------------------

int si_get_memory_hardware_status() {

    try {

        std::vector<unsigned char> table;

        int reason = SI_DMI_INVALID;

        if (si_dmi_load_table_ex(
                table,
                reason)) {
            return SI_DMI_OK;
        }

        return reason;
    }
    catch (...) {
        return SI_DMI_INVALID;
    }
}

// ---------------------------------------------------------------------
// Root-side snapshot writer
// ---------------------------------------------------------------------

#ifdef _WIN32

int si_write_memory_smbios_snapshot(
    const char* path) {

    (void)path;

    // Windows reads the firmware table without elevation; no snapshot needed.
    return -5;
}

#else

// Filters `raw` down to the memory records and writes the snapshot file.
// Split from the public entry point so it can be tested without root and
// without a real firmware table. Return codes as documented in the header.
static int si_snapshot_write_from_table(
    const std::vector<unsigned char>& raw,
    const char* path) {

    try {

        std::vector<unsigned char> memory;

        if (!si_dmi_filter_memory_records(
                raw.data(),
                raw.size(),
                memory)) {
            return -3;
        }

        std::vector<unsigned char> file;

        si_snapshot_encode(
            si_current_boot_id(),
            memory,
            file
        );

        const std::string target =
            (path && path[0] != '\0')
                ? std::string(path)
                : si_snapshot_path();

        // Create the folder (0755: everyone may read the snapshot inside).
        const size_t slash =
            target.find_last_of('/');

        if (slash != std::string::npos &&
            slash > 0) {

            const std::string directory =
                target.substr(0, slash);

            std::error_code ec;

            std::filesystem::create_directories(
                directory,
                ec
            );

            std::filesystem::permissions(
                directory,
                std::filesystem::perms::owner_all |
                    std::filesystem::perms::group_read |
                    std::filesystem::perms::group_exec |
                    std::filesystem::perms::others_read |
                    std::filesystem::perms::others_exec,
                ec
            );
        }

        // Write to a temporary file and rename it into place, so a reader
        // never sees a half-written snapshot.
        const std::string temporary =
            target + ".tmp";

        ::unlink(temporary.c_str());

        const int fd =
            ::open(
                temporary.c_str(),
                O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,
                0644
            );

        if (fd < 0)
            return -4;

        size_t written = 0;

        bool ok = true;

        while (written < file.size()) {

            const ssize_t n =
                ::write(
                    fd,
                    file.data() + written,
                    file.size() - written
                );

            if (n <= 0) {
                ok = false;
                break;
            }

            written += static_cast<size_t>(n);
        }

        // umask must not make the snapshot unreadable to the app.
        if (ok &&
            ::fchmod(fd, 0644) != 0) {
            ok = false;
        }

        if (ok &&
            ::fsync(fd) != 0) {
            ok = false;
        }

        ::close(fd);

        if (!ok ||
            ::rename(
                temporary.c_str(),
                target.c_str()) != 0) {

            ::unlink(temporary.c_str());

            return -4;
        }

        return 1;
    }
    catch (...) {
        return -4;
    }
}

int si_write_memory_smbios_snapshot(
    const char* path) {

    try {

        std::vector<unsigned char> raw;

        int err = 0;

        if (!si_read_whole_file(
                SI_LIVE_DMI_TABLE,
                raw,
                err)) {

            const int reason =
                si_dmi_open_failure_reason(err);

            if (reason == SI_DMI_PERMISSION)
                return -1;

            if (reason == SI_DMI_NOT_PRESENT)
                return -2;

            return -3;
        }

        return si_snapshot_write_from_table(
            raw,
            path
        );
    }
    catch (...) {
        return -4;
    }
}

#endif
