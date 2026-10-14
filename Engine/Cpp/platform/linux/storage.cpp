// Linux storage volumes (/proc/mounts + statvfs).
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
