// Linux storage volumes (/proc/mounts + statvfs).
#include "../../src/internal.h"
#include "sysfs.h"

#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <set>
#include <sstream>
#include <sys/statvfs.h>
#include <unistd.h>
#include <vector>

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

namespace {

struct VolumeEntry {
    std::string mount;
    std::string fstype;
    long long totalBytes = 0;
    long long freeBytes = 0;
};

// The index-based API means a caller lists the volumes by asking for index 0, 1, 2, ... until one is missing. Scanning
// /proc/mounts and running statvfs on every mount for each of those calls made one listing cost N+1 full scans, so a listing
// is scanned once (when index 0 is asked for) and the following indexes are answered from that same moment. The copy also
// makes the whole listing consistent. A caller that asks for a later index first, or long after, gets a fresh scan.
std::mutex g_volumeMutex;
std::vector<VolumeEntry> g_volumes;
std::chrono::steady_clock::time_point g_volumesTaken;
bool g_volumesValid = false;
constexpr std::chrono::milliseconds kVolumeListingMaxAge{1500};

std::vector<VolumeEntry> scan_volumes() {
    std::vector<VolumeEntry> entries;
    for (const auto& volume : list_volumes()) {
        struct statvfs status{};
        if (statvfs(volume.mount.c_str(), &status) != 0 || status.f_blocks == 0)
            continue;
        entries.push_back({
            volume.mount,
            volume.fstype,
            static_cast<long long>(static_cast<unsigned long long>(status.f_blocks) * status.f_frsize),
            static_cast<long long>(static_cast<unsigned long long>(status.f_bavail) * status.f_frsize)});
    }
    return entries;
}

}  // namespace

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
        std::lock_guard<std::mutex> lock(g_volumeMutex);

        const auto now = std::chrono::steady_clock::now();
        if (index == 0 || !g_volumesValid || now - g_volumesTaken > kVolumeListingMaxAge) {
            g_volumes = scan_volumes();
            g_volumesTaken = now;
            g_volumesValid = true;
        }

        if (static_cast<std::size_t>(index) >= g_volumes.size())
            return 0;

        const VolumeEntry& volume = g_volumes[static_cast<std::size_t>(index)];
        copy_out(mountOut, mountSize, volume.mount);
        copy_out(fsOut, fsSize, volume.fstype);
        if (totalBytes)
            *totalBytes = volume.totalBytes;
        if (freeBytes)
            *freeBytes = volume.freeBytes;
        return 1;
    }
    catch (...) {
    }

    return 0;
}
