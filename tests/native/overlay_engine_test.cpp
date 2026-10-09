// Overlay engine: the assembly statistics kernel against a reference, and the whole engine (sampling, per-source
// attribution, history, honest "unavailable") against a fake /proc + /sys tree — no hardware, same result anywhere.
#include "../../native/include/native_engine.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <chrono>
#include <random>
#include <thread>
#include <string>
#include <vector>

namespace fs = std::filesystem;
static int g_failures = 0, g_checks = 0;
#define CHECK(cond, what) do { ++g_checks; if (!(cond)) { ++g_failures; std::printf("FAIL: %s\n", what); } } while (0)

static void write(const fs::path& p, const std::string& text) { fs::create_directories(p.parent_path()); std::ofstream(p) << text << "\n"; }

static std::string snapshot() {
    std::vector<char> buf(1 << 16);
    int n = si_overlay_snapshot_json(buf.data(), (int)buf.size());
    if (n < 0) { buf.resize((size_t)-n); n = si_overlay_snapshot_json(buf.data(), (int)buf.size()); }
    return n > 0 ? std::string(buf.data(), (size_t)n) : std::string();
}
// Value right after `"key":` (first occurrence at or after `from`); "" when absent.
static std::string value(const std::string& j, const std::string& key, size_t from = 0) {
    size_t p = j.find("\"" + key + "\":", from);
    if (p == std::string::npos) return "";
    p += key.size() + 3;
    size_t e = p;
    if (j[e] == '"') { e = j.find('"', e + 1) + 1; } else while (e < j.size() && j[e] != ',' && j[e] != '}' && j[e] != ']') e++;
    return j.substr(p, e - p);
}

static void stats_kernel() {
    std::mt19937 rng(7);
    for (int round = 0; round < 2; round++) {          // run again under SYSTEMINFO_NO_ASM=1 (see CMake) for the portable tier
        for (int n : {0, 1, 3, 4, 7, 8, 9, 15, 16, 17, 64, 255, 1000}) {
            std::vector<float> a((size_t)n);
            for (auto& v : a) v = (float)(rng() % 10001) / 100.0f;
            double sum = -1, mx = -1; long long cnt = -1;
            CHECK(si_stats_f32(a.data(), n, 10.0f, &sum, &mx, &cnt) == 1, "stats call succeeds");
            double rs = 0, rm = 0; long long rc = 0;
            for (float v : a) { rs += v; rm = std::fmax(rm, v); if (v >= 10.0f) rc++; }
            CHECK(std::fabs(sum - rs) <= 1e-3 * (1 + std::fabs(rs)), "stats sum matches reference");
            CHECK(mx == rm, "stats max is exact");
            CHECK(cnt == rc, "stats count is exact");
        }
    }
    double s, m; long long c;
    float bad[4] = {50.0f, NAN, INFINITY, 20.0f};
    CHECK(si_stats_f32(bad, 4, 10.0f, &s, &m, &c) == 1 && m == 50.0 && c == 2 && s == 70.0, "non-finite inputs are treated as 0");
    CHECK(si_stats_f32(nullptr, 3, 1.0f, &s, &m, &c) == 0, "null input with n > 0 is rejected");
    CHECK(si_kernel_selftest() == 0, "kernel self-test (including stats) passes");
}

static void line(std::ofstream& f, const char* tag, long user, long idle) { f << tag << " " << user << " 0 0 " << idle << " 0 0 0 0 0 0\n"; }
static void proc_stat(const fs::path& root, long u0, long i0, long u1, long i1) {
    fs::create_directories(root / "proc");
    std::ofstream f(root / "proc" / "stat");
    line(f, "cpu ", u0 + u1, i0 + i1);
    line(f, "cpu0", u0, i0);
    line(f, "cpu1", u1, i1);
    f << "intr 1\n";
}

// The fake /proc + /sys tree only drives the Linux sources; the Windows engine reads the real OS (see live_machine).
#ifndef _WIN32
static void engine_with_fake_tree() {
    fs::path root = fs::temp_directory_path() / ("si-overlay-" + std::to_string(std::rand()));
    fs::remove_all(root);
    proc_stat(root, 100, 900, 0, 1000);

    // CPU sensor + clocks
    write(root / "sys/class/hwmon/hwmon0/name", "coretemp");
    write(root / "sys/class/hwmon/hwmon0/temp1_input", "61000");
    write(root / "sys/class/hwmon/hwmon0/temp1_label", "Package id 0");
    write(root / "sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq", "3000000");
    write(root / "sys/devices/system/cpu/cpu1/cpufreq/scaling_cur_freq", "1000000");

    // card0: AMD discrete (RX 6600, 8 GiB), card1: NVIDIA with no NVML on this machine, card1-DP-1: a connector (ignored)
    auto d0 = root / "sys/class/drm/card0/device";
    write(d0 / "vendor", "0x1002"); write(d0 / "device", "0x73ff"); write(d0 / "uevent", "DRIVER=amdgpu\nPCI_SLOT_NAME=0000:03:00.0");
    write(d0 / "gpu_busy_percent", "37"); write(d0 / "mem_info_vram_total", "8589934592"); write(d0 / "mem_info_vram_used", "2147483648");
    write(d0 / "mem_info_gtt_total", "16000000000"); write(d0 / "mem_info_gtt_used", "100000000");
    write(d0 / "hwmon/hwmon3/temp1_input", "58000"); write(d0 / "hwmon/hwmon3/power1_average", "45000000");
    write(d0 / "hwmon/hwmon3/power1_cap", "100000000"); write(d0 / "hwmon/hwmon3/freq1_input", "2200000000");
    auto d1 = root / "sys/class/drm/card1/device";
    write(d1 / "vendor", "0x10de"); write(d1 / "device", "0x2882"); write(d1 / "uevent", "DRIVER=nvidia\nPCI_SLOT_NAME=0000:01:00.0");
    write(root / "sys/class/drm/card1-DP-1/status", "disconnected");

    CHECK(si_overlay_start(0, root.string().c_str()) == 1, "engine starts in manual mode");
    CHECK(snapshot().empty(), "no snapshot before the first sample");
    CHECK(si_overlay_sample_now() == 1, "first sample");
    std::string first = snapshot();
    CHECK(!first.empty(), "snapshot exists after a sample");
    CHECK(value(first, "usagePercent") == "null", "first CPU sample has no baseline: load is unknown, not 0");
    CHECK(value(first, "logicalProcessors") == "0", "no per-core numbers without a baseline");

    proc_stat(root, 150, 950, 0, 1050);   // cpu0: 50 busy / 100 total, cpu1: 0 busy / 50
    CHECK(si_overlay_sample_now() == 1, "second sample");
    std::string j = snapshot();
    CHECK(value(j, "seq") == "2", "sequence advances");
    CHECK(value(j, "logicalProcessors") == "2", "two logical processors");
    size_t cpu = j.find("\"cpu\":");
    CHECK(value(j, "usagePercent", cpu) == "33.3", "whole-machine load is computed from tick deltas");
    CHECK(value(j, "busiestCorePercent", cpu) == "50.0", "busiest core comes from the kernel");
    CHECK(value(j, "activeCores", cpu) == "1", "one core above the activity threshold");
    CHECK(value(j, "temperatureC", cpu) == "61.0" && value(j, "temperatureSource", cpu) == "\"coretemp\"", "CPU temperature from the real sensor, with its name");
    CHECK(value(j, "clockMhz", cpu) == "2000", "average clock from cpufreq");

    size_t g = j.find("\"gpus\":");
    size_t amd = j.find("gpu-1002", g);
    CHECK(amd != std::string::npos, "AMD adapter listed with a stable id");
    CHECK(value(j, "kind", amd) == "\"discrete\"", "8 GiB card is discrete");
    CHECK(value(j, "utilizationPercent", amd) == "37.0", "AMD load from gpu_busy_percent");
    CHECK(value(j, "temperatureC", amd) == "58.0", "AMD temperature from hwmon");
    CHECK(value(j, "memoryPercent", amd) == "25.0", "VRAM percent from used / total");
    CHECK(value(j, "powerWatts", amd) == "45.0" && value(j, "powerLimitWatts", amd) == "100.0", "AMD power and cap");
    CHECK(value(j, "coreClockMhz", amd) == "2200", "AMD core clock");
    size_t nv = j.find("gpu-10de", g);
    CHECK(nv != std::string::npos, "NVIDIA adapter listed");
    CHECK(value(j, "utilizationPercent", nv) == "null" && value(j, "temperatureC", nv) == "null", "no NVML: numbers are null, never 0");
    CHECK(value(j, "note", nv).find("NVIDIA telemetry unavailable") != std::string::npos, "the card says why");
    int listed = 0;
    for (size_t p = j.find("\"id\":\"gpu-"); p != std::string::npos && p < j.find("\"history\":"); p = j.find("\"id\":\"gpu-", p + 1)) listed++;
    CHECK(listed == 2, "only real adapters are listed (the connector node is ignored)");

    size_t h = j.find("\"history\":");
    CHECK(h != std::string::npos && j.find("\"gpus\":{", h) != std::string::npos, "history carries a series per adapter");
    CHECK(value(j, "isa") != "" && value(j, "cycleMs") != "", "engine reports its own tier and cycle time");

    // Buffer protocol: too small -> negative needed size, nothing written past the end.
    char tiny[16];
    CHECK(si_overlay_snapshot_json(tiny, sizeof tiny) < 0, "a too-small buffer reports the needed size");
    si_overlay_stop();
    CHECK(si_overlay_sample_now() == 0, "stopped engine does not sample");
    fs::remove_all(root);
}

#endif

static void live_machine() {
    CHECK(si_overlay_start(0, nullptr) == 1, "engine starts on the real machine");
    si_overlay_sample_now();
    std::vector<unsigned> burn(1 << 20);
    volatile unsigned sink = 0;
    for (int r = 0; r < 40; r++) for (auto& b : burn) { b = b * 3 + 1; sink = sink + b; }      // give the CPU something to measure
    si_overlay_sample_now();
    std::string j = snapshot();
    CHECK(!j.empty() && j.front() == '{' && j.back() == '}', "live snapshot is a JSON object");
    size_t ram = j.find("\"ram\":");
    CHECK(std::atof(value(j, "totalBytes", ram).c_str()) > 1e8, "RAM total is real");
    double pct = std::atof(value(j, "usedPercent", ram).c_str());
    CHECK(pct > 0 && pct <= 100, "RAM percent is within range");
    si_overlay_stop();

    // Threaded mode keeps producing new snapshots by itself.
    CHECK(si_overlay_start(60, nullptr) == 1, "threaded engine starts");
    std::string a; for (int i = 0; i < 50 && a.empty(); i++) { std::this_thread::sleep_for(std::chrono::milliseconds(20)); a = snapshot(); }
    long s1 = std::atol(value(a, "seq").c_str());
    std::this_thread::sleep_for(std::chrono::milliseconds(400));
    long s2 = std::atol(value(snapshot(), "seq").c_str());
    CHECK(!a.empty() && s2 > s1, "background thread keeps sampling");
    si_overlay_stop();
}

int main() {
    stats_kernel();
#ifndef _WIN32
    engine_with_fake_tree();
#endif
    live_machine();
    std::printf("%d checks, %d failures (asm tier %d)\n", g_checks, g_failures, si_active_isa());
    return g_failures ? 1 : 0;
}
