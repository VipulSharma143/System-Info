// hardware_info.cpp — CPU topology, storage volumes and fan sensors.
//
// Contract shared by every function here:
//   * plain C ABI, 32/64-bit widths explicit (byte counts are long long);
//   * never throws across the boundary (every filesystem call uses the
//     error_code overloads; the rest is wrapped);
//   * "unknown" is reported as -1 / return 0 — never as a fabricated zero;
//   * caller-supplied buffers are size-checked and always NUL-terminated.
#include "../include/native_engine.h"
#include <cctype>
#include <cstring>
#include <string>
#include <vector>

static int copy_out(char* dst, int size, const std::string& src) {
    if (!dst || size <= 0) return 0;
    size_t n = src.size() < (size_t)(size - 1) ? src.size() : (size_t)(size - 1);
    std::memcpy(dst, src.data(), n);
    dst[n] = '\0';
    return (int)n;
}

#ifdef _WIN32
// =====================================================================
// Windows
// =====================================================================
#include <windows.h>

static int popcount64(ULONG_PTR m) { int c = 0; while (m) { m &= m - 1; c++; } return c; }

int si_get_cpu_topology(int* physicalCores, int* logicalCores, int* packages) {
    if (physicalCores) *physicalCores = -1;
    if (logicalCores) *logicalCores = -1;
    if (packages) *packages = -1;
    try {
        DWORD len = 0;
        GetLogicalProcessorInformationEx(RelationAll, nullptr, &len);
        if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || len == 0) return 0;
        std::vector<char> buf(len);
        if (!GetLogicalProcessorInformationEx(RelationAll, reinterpret_cast<PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(buf.data()), &len)) return 0;
        int cores = 0, logical = 0, pkgs = 0;
        for (DWORD off = 0; off < len;) {
            auto* info = reinterpret_cast<PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(buf.data() + off);
            if (info->Size == 0) break;
            if (info->Relationship == RelationProcessorCore) {
                cores++;
                // Count across processor groups: machines with >64 logical CPUs span several.
                for (WORD g = 0; g < info->Processor.GroupCount; g++) logical += popcount64(info->Processor.GroupMask[g].Mask);
            } else if (info->Relationship == RelationProcessorPackage) {
                pkgs++;
            }
            off += info->Size;
        }
        if (cores <= 0) return 0;
        if (physicalCores) *physicalCores = cores;
        if (logicalCores) *logicalCores = logical > 0 ? logical : -1;
        if (packages) *packages = pkgs > 0 ? pkgs : -1;
        return 1;
    } catch (...) { return 0; }
}

int si_get_storage_volume(int index, char* mountOut, int mountSize, char* fsOut, int fsSize,
                          long long* totalBytes, long long* freeBytes) {
    if (index < 0) return 0;
    try {
        DWORD mask = GetLogicalDrives();
        int seen = 0;
        for (int i = 0; i < 26; i++) {
            if (!(mask & (1u << i))) continue;
            char root[4] = { (char)('A' + i), ':', '\\', 0 };
            UINT type = GetDriveTypeA(root);
            if (type != DRIVE_FIXED && type != DRIVE_REMOVABLE) continue;
            ULARGE_INTEGER avail{}, total{}, freeAll{};
            // Fails for an empty card reader / optical slot: skip it rather than report 0 bytes.
            if (!GetDiskFreeSpaceExA(root, &avail, &total, &freeAll)) continue;
            if (seen++ != index) continue;
            char fsName[64] = {0};
            GetVolumeInformationA(root, nullptr, 0, nullptr, nullptr, nullptr, fsName, sizeof fsName);
            copy_out(mountOut, mountSize, root);
            copy_out(fsOut, fsSize, fsName);
            if (totalBytes) *totalBytes = (long long)total.QuadPart;
            if (freeBytes) *freeBytes = (long long)avail.QuadPart;
            return 1;
        }
    } catch (...) {}
    return 0;
}

// Windows exposes no vendor-neutral fan RPM API (it needs WMI on some OEM
// firmware or a signed kernel driver). Reporting "none" is the honest answer.
int si_get_fan(int, char*, int, int*) { return 0; }

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

static bool read_int(const std::string& path, long long& out) {
    std::ifstream f(path);
    return static_cast<bool>(f >> out);
}
static std::string read_line(const std::string& path) {
    std::ifstream f(path);
    std::string s;
    std::getline(f, s);
    return s;
}
static std::vector<std::string> sorted_children(const std::string& dir) {
    std::vector<std::string> out;
    std::error_code ec;
    fs::directory_iterator it(dir, fs::directory_options::skip_permission_denied, ec);
    for (fs::directory_iterator end; !ec && it != end; it.increment(ec)) out.push_back(it->path().string());
    std::sort(out.begin(), out.end());
    return out;
}

int si_get_cpu_topology(int* physicalCores, int* logicalCores, int* packages) {
    if (physicalCores) *physicalCores = -1;
    if (logicalCores) *logicalCores = -1;
    if (packages) *packages = -1;
    try {
        std::set<std::pair<long long, long long>> cores;   // (package, core) of online CPUs
        std::set<long long> pkgs;
        int logical = 0;
        bool topologyKnown = false;
        for (const auto& path : sorted_children("/sys/devices/system/cpu")) {
            const std::string name = fs::path(path).filename().string();
            if (name.size() < 4 || name.compare(0, 3, "cpu") != 0 ||
                !std::all_of(name.begin() + 3, name.end(), [](unsigned char c) { return std::isdigit(c); })) continue;
            long long online = 1;
            if (read_int(path + "/online", online) && online == 0) continue;   // cpu0 has no "online" file: always on
            logical++;
            long long core, pkg;
            if (read_int(path + "/topology/core_id", core) && read_int(path + "/topology/physical_package_id", pkg)) {
                topologyKnown = true;
                cores.insert({ pkg, core });
                pkgs.insert(pkg);
            }
        }
        if (logical == 0) {                                     // no sysfs (container, exotic kernel)
            long n = sysconf(_SC_NPROCESSORS_ONLN);
            if (n <= 0) return 0;
            logical = (int)n;
        }
        if (logicalCores) *logicalCores = logical;
        if (topologyKnown) {
            // Some VMs report package/core ids of -1 for every CPU; that is "unknown", not 1 core.
            bool bogus = std::any_of(cores.begin(), cores.end(), [](const auto& c) { return c.second < 0 || c.first < 0; });
            if (!bogus) {
                if (physicalCores) *physicalCores = (int)cores.size();
                if (packages) *packages = (int)pkgs.size();
            }
        }
        return 1;
    } catch (...) { return 0; }
}

static std::string unescape_mount(const std::string& s) {      // /proc/mounts encodes ' ' as \040 etc.
    std::string out;
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '\\' && i + 3 < s.size() + 0 && std::isdigit((unsigned char)s[i + 1]) &&
            std::isdigit((unsigned char)s[i + 2]) && std::isdigit((unsigned char)s[i + 3])) {
            out += (char)((s[i + 1] - '0') * 64 + (s[i + 2] - '0') * 8 + (s[i + 3] - '0'));
            i += 3;
        } else out += s[i];
    }
    return out;
}

struct Volume { std::string mount, fstype; };

// Real, block-device-backed filesystems only: pseudo filesystems (proc, sysfs,
// tmpfs, cgroup...) and snap/loop squashfs images are noise for a storage view.
// Bind mounts of an already listed device are collapsed.
static std::vector<Volume> list_volumes() {
    std::vector<Volume> vols;
    std::set<std::string> seenDevices;
    std::ifstream f("/proc/mounts");
    std::string line;
    while (std::getline(f, line)) {
        std::istringstream iss(line);
        std::string dev, mount, type;
        if (!(iss >> dev >> mount >> type)) continue;
        if (dev.compare(0, 5, "/dev/") != 0 || dev.compare(0, 9, "/dev/loop") == 0) continue;
        if (type == "squashfs" || type == "iso9660" || type == "udf") continue;
        if (!seenDevices.insert(dev).second) continue;
        vols.push_back({ unescape_mount(mount), type });
    }
    return vols;
}

int si_get_storage_volume(int index, char* mountOut, int mountSize, char* fsOut, int fsSize,
                          long long* totalBytes, long long* freeBytes) {
    if (index < 0) return 0;
    try {
        int seen = 0;
        for (const auto& v : list_volumes()) {
            struct statvfs st{};
            if (statvfs(v.mount.c_str(), &st) != 0 || st.f_blocks == 0) continue;   // unreadable mount: skip, don't report 0
            if (seen++ != index) continue;
            copy_out(mountOut, mountSize, v.mount);
            copy_out(fsOut, fsSize, v.fstype);
            // f_frsize is the unit of f_blocks/f_bavail. Multiply in 64-bit: a 4 TB volume overflows 32 bits.
            if (totalBytes) *totalBytes = (long long)((unsigned long long)st.f_blocks * st.f_frsize);
            if (freeBytes) *freeBytes = (long long)((unsigned long long)st.f_bavail * st.f_frsize);
            return 1;
        }
    } catch (...) {}
    return 0;
}

int si_get_fan(int index, char* labelOut, int labelSize, int* rpmOut) {
    if (index < 0) return 0;
    try {
        int seen = 0;
        for (const auto& hw : sorted_children("/sys/class/hwmon")) {
            const std::string chip = read_line(hw + "/name");
            for (const auto& file : sorted_children(hw)) {
                const std::string base = fs::path(file).filename().string();
                if (base.compare(0, 3, "fan") != 0 || base.size() < 10 || base.compare(base.size() - 6, 6, "_input") != 0) continue;
                long long rpm;
                if (!read_int(file, rpm) || rpm < 0) continue;              // unreadable node: not a fan we can report
                if (seen++ != index) continue;
                const std::string stem = file.substr(0, file.size() - 6);
                std::string label = read_line(stem + "_label");
                if (label.empty()) label = (chip.empty() ? std::string("hwmon") : chip) + " " + base.substr(0, base.size() - 6);
                copy_out(labelOut, labelSize, label);
                if (rpmOut) *rpmOut = (int)rpm;
                return 1;
            }
        }
    } catch (...) {}
    return 0;
}
#endif
