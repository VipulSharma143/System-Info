// Host snapshot: the /proc parsers against fixture text (identical on every machine) and a live sanity read that only
// asserts properties true on ANY healthy system (never a specific CPU model, RAM size or temperature).
#include "../../native/include/native_engine.h"
#include "../../native/src/host_parse.h"

#include <cstdio>
#include <chrono>
#include <cstring>
#include <string>
#include <thread>

static int g_failures = 0, g_checks = 0;
#define CHECK(cond, what) do { ++g_checks; if (!(cond)) { ++g_failures; std::printf("FAIL: %s\n", what); } } while (0)

static void parsers() {
    uint64_t busy = 0, total = 0;
    const std::string stat = "cpu  1000 50 500 8000 200 10 20 5 0 0\ncpu0 500 25 250 4000 100 5 10 2 0 0\nintr 1 2 3\n";
    CHECK(si_parse::parse_stat_cpu_line(stat.data(), stat.size(), busy, total), "aggregate cpu line parses");
    CHECK(total == 1000 + 50 + 500 + 8000 + 200 + 10 + 20 + 5, "total is the first eight fields");
    CHECK(busy == total - 8000 - 200, "busy excludes idle and iowait");

    const std::string old = "cpu  4 0 2 90\n";
    CHECK(si_parse::parse_stat_cpu_line(old.data(), old.size(), busy, total) && total == 96 && busy == 6, "a four-field (old kernel) line works");

    for (const char* bad : {"cpu0 1 2 3 4\n", "cpu  \n", "cpu  1 2 3\n", "intr 1 2 3 4\n", "cpu  a b c d\n", ""}) {
        CHECK(!si_parse::parse_stat_cpu_line(bad, std::strlen(bad), busy, total), "malformed stat line is rejected");
    }
    const std::string huge = "cpu  18446744073709551615 1 1 1 1 1 1 1\n";
    CHECK(!si_parse::parse_stat_cpu_line(huge.data(), huge.size(), busy, total), "an overflowing sum is rejected, not wrapped");

    const std::string mem =
        "MemTotal:       16314192 kB\nMemFree:         1200000 kB\nMemAvailable:    9000000 kB\nBuffers:  1 kB\n"
        "SwapTotal:       2097148 kB\nSwapFree:        2000000 kB\nHugePages_Total:       0\n";
    auto m = si_parse::parse_meminfo(mem.data(), mem.size());
    CHECK(m.have_total && m.total_kb == 16314192 && m.have_available && m.available_kb == 9000000 && m.have_free && m.free_kb == 1200000, "meminfo fields");
    CHECK(m.have_swap_total && m.swap_total_kb == 2097148 && m.have_swap_free && m.swap_free_kb == 2000000, "swap fields");

    const std::string nokey = "MemTotal: 100 kB\nMemFreeX: 5 kB\n";
    m = si_parse::parse_meminfo(nokey.data(), nokey.size());
    CHECK(m.have_total && !m.have_free && !m.have_available, "a key that merely starts with MemFree is not MemFree");
    m = si_parse::parse_meminfo("garbage", 7);
    CHECK(!m.have_total, "garbage yields no fields");
    m = si_parse::parse_meminfo("MemTotal:  \n", 12);
    CHECK(!m.have_total, "a key without a number is absent, not zero");
}

static void live() {
    SiHostSnapshot s{};
    CHECK(si_read_host_snapshot(nullptr) == -1, "null pointer is rejected");
    CHECK(si_read_host_snapshot(&s) == -1, "an unset struct_size is rejected");
    CHECK(si_host_snapshot_size() == sizeof(SiHostSnapshot), "the library and the header agree on the struct size");

    s.struct_size = sizeof s;
    const int status = si_read_host_snapshot(&s);
    CHECK(status == 0 || status == 1, "a valid call returns 0 or 1");
    CHECK(s.struct_size == sizeof s && s.sampled_unix_ms > 1'700'000'000'000ULL, "struct_size is kept and the timestamp is set");
    if (status == 0) { CHECK(s.valid_mask == 0, "status 0 means nothing is valid"); return; }

    if (s.valid_mask & SI_SNAP_MEMORY) {
        CHECK(s.mem_total_kb > 0 && s.mem_available_kb <= s.mem_total_kb && s.mem_free_kb <= s.mem_total_kb, "memory figures are consistent");
    } else {
        CHECK(s.mem_total_kb == 0, "an invalid memory block is zeroed, never half-filled");
    }
    if (s.valid_mask & SI_SNAP_SWAP) CHECK(s.swap_free_kb <= s.swap_total_kb, "swap figures are consistent");
    if (s.valid_mask & SI_SNAP_CPU_TEMP) CHECK(s.cpu_temperature_c > 0 && s.cpu_temperature_c < 125, "a reported temperature is plausible");
    else CHECK(s.cpu_temperature_c == 0, "an absent temperature is 0 with its bit clear");

    if (s.valid_mask & SI_SNAP_CPU_TICKS) {
        SiHostSnapshot a = s, b{};
        b.struct_size = sizeof b;
        std::this_thread::sleep_for(std::chrono::milliseconds(60));
        CHECK(si_read_host_snapshot(&b) >= 0, "second read works");
        CHECK(b.cpu_total_ticks >= a.cpu_total_ticks && b.cpu_busy_ticks >= a.cpu_busy_ticks, "tick counters never go backwards");
        CHECK(b.cpu_busy_ticks <= b.cpu_total_ticks, "busy never exceeds total");
    }

    // Hammer it from several threads: no crash, no torn struct_size, and descriptors survive.
    std::thread t[4];
    int bad[4] = {};
    for (int i = 0; i < 4; ++i)
        t[i] = std::thread([&bad, i] {
            for (int k = 0; k < 500; ++k) {
                SiHostSnapshot x{};
                x.struct_size = sizeof x;
                if (si_read_host_snapshot(&x) < 0 || x.struct_size != sizeof x) ++bad[i];
            }
        });
    for (auto& th : t) th.join();
    CHECK(bad[0] + bad[1] + bad[2] + bad[3] == 0, "concurrent snapshot reads are safe");
}

int main() {
    parsers();
    live();
    std::printf("host_snapshot_test: %d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
