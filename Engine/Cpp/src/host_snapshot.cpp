// host_snapshot.cpp — one native call returns the frequently needed live host metrics together.
//
// Before: the backend opened /proc/meminfo with ReadAllLines + three LINQ scans for RAM, opened /proc/stat again for
// CPU, and read the temperature through a separate P/Invoke, each with its own allocations and string splitting.
// Now: one P/Invoke, two persistent file descriptors read with pread() into stack buffers (no open/close, no heap),
// a hand-rolled parser (host_parse.h, unit-tested with fixture text), and a validity mask so a field the platform
// cannot report is marked absent instead of silently zero.
#include "internal.h"
#include "host_parse.h"

#include <chrono>
#include <mutex>

#ifdef _WIN32
#  ifndef NOMINMAX
#    define NOMINMAX
#  endif
#  include <windows.h>
#else
#  include <fcntl.h>
#  include <unistd.h>
#endif

unsigned int si_host_snapshot_size() { return static_cast<unsigned int>(sizeof(SiHostSnapshot)); }

#ifndef _WIN32
namespace {

std::mutex g_mutex;
int g_stat_fd = -1;
int g_mem_fd = -1;

// Reads up to cap-1 bytes from the start of a /proc file. A descriptor that fails (the file vanished, EBADF) is closed
// and reopened once, so a long-running service survives odd states instead of reporting nothing forever.
long read_proc(int& fd, const char* path, char* buf, size_t cap) {
    for (int attempt = 0; attempt < 2; ++attempt) {
        if (fd < 0) {
            fd = ::open(path, O_RDONLY | O_CLOEXEC);
            if (fd < 0) return -1;
        }
        const ssize_t n = ::pread(fd, buf, cap - 1, 0);
        if (n > 0) { buf[n] = '\0'; return static_cast<long>(n); }
        ::close(fd);
        fd = -1;
    }
    return -1;
}

}  // namespace
#endif

int si_read_host_snapshot(SiHostSnapshot* out) {
    if (!out || out->struct_size != sizeof(SiHostSnapshot)) return -1;

    const unsigned int size = out->struct_size;
    *out = SiHostSnapshot{};
    out->struct_size = size;
    out->sampled_unix_ms = static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());

    try {
#ifdef _WIN32
        FILETIME idle{}, kernel{}, user{};
        if (GetSystemTimes(&idle, &kernel, &user)) {
            auto to64 = [](const FILETIME& f) { return (static_cast<uint64_t>(f.dwHighDateTime) << 32) | f.dwLowDateTime; };
            const uint64_t i = to64(idle), total = to64(kernel) + to64(user);   // kernel time includes idle time
            if (total >= i) {
                out->cpu_total_ticks = total;
                out->cpu_busy_ticks = total - i;
                out->valid_mask |= SI_SNAP_CPU_TICKS;
            }
        }
        MEMORYSTATUSEX mem{};
        mem.dwLength = sizeof mem;
        if (GlobalMemoryStatusEx(&mem) && mem.ullTotalPhys > 0) {
            out->mem_total_kb = mem.ullTotalPhys / 1024;
            out->mem_available_kb = mem.ullAvailPhys / 1024;
            out->mem_free_kb = mem.ullAvailPhys / 1024;
            out->valid_mask |= SI_SNAP_MEMORY;
        }
#else
        std::lock_guard<std::mutex> lock(g_mutex);
        char buf[8192];

        // The aggregate row is the first line; 512 bytes is far more than it needs (the rest of /proc/stat can be huge).
        if (const long n = read_proc(g_stat_fd, "/proc/stat", buf, 512); n > 0) {
            uint64_t busy = 0, total = 0;
            if (si_parse::parse_stat_cpu_line(buf, static_cast<size_t>(n), busy, total)) {
                out->cpu_busy_ticks = busy;
                out->cpu_total_ticks = total;
                out->valid_mask |= SI_SNAP_CPU_TICKS;
            }
        }
        if (const long n = read_proc(g_mem_fd, "/proc/meminfo", buf, sizeof buf); n > 0) {
            const si_parse::MemFields m = si_parse::parse_meminfo(buf, static_cast<size_t>(n));
            if (m.have_total && m.total_kb > 0) {
                out->mem_total_kb = m.total_kb;
                // MemAvailable exists since kernel 3.14; without it free memory is the honest lower bound.
                out->mem_available_kb = m.have_available ? m.available_kb : (m.have_free ? m.free_kb : 0);
                out->mem_free_kb = m.have_free ? m.free_kb : 0;
                if (m.have_available || m.have_free) out->valid_mask |= SI_SNAP_MEMORY;
                if (m.have_swap_total && m.have_swap_free) {
                    out->swap_total_kb = m.swap_total_kb;
                    out->swap_free_kb = m.swap_free_kb;
                    out->valid_mask |= SI_SNAP_SWAP;
                }
            }
        }
#endif
        double celsius = 0;
        if (si_cpu_temperature(&celsius, nullptr, 0) == 1) {
            out->cpu_temperature_c = celsius;
            out->valid_mask |= SI_SNAP_CPU_TEMP;
        }
    } catch (...) {
        return -1;
    }
    return out->valid_mask != 0 ? 1 : 0;
}
