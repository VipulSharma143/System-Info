// sysfs.h — small readers for /proc and /sys files shared by the Linux platform files.
#pragma once

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace fs = std::filesystem;

// ---------------------------------------------------------------------
// Generic Linux helpers
// ---------------------------------------------------------------------

inline bool read_int(
    const std::string& path,
    long long& out) {

    std::ifstream file(path);

    if (!file)
        return false;

    return static_cast<bool>(
        file >> out
    );
}

inline std::string read_line(
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

inline std::vector<std::string> sorted_children(
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

// Where the kernel exposes the raw firmware table (readable by root only).
inline constexpr const char* SI_LIVE_DMI_TABLE =
    "/sys/firmware/dmi/tables/DMI";
