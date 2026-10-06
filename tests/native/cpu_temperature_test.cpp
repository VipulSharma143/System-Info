// CPU temperature selection against fake sysfs trees in a temporary directory: no hardware, no root, and the same
// result on any machine or CI runner. Covers the "stuck at 28 C" regression (generic ACPI zone chosen, or a value
// remembered instead of read) and the honest "no sensor" answer.
#include "../../native/include/native_engine.h"

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>

namespace fs = std::filesystem;

static int g_failures = 0;
static int g_checks = 0;
#define CHECK(cond, what) do { ++g_checks; if (!(cond)) { ++g_failures; std::printf("FAIL: %s\n", what); } } while (0)

static void write(const fs::path& p, const std::string& text) {
    fs::create_directories(p.parent_path());
    std::ofstream(p) << text << "\n";
}

struct Reading { int status; double celsius; std::string source; };

static Reading read_at(const fs::path& root) {
    Reading r{};
    char source[64] = {};
    r.status = si_cpu_temperature_at(root.string().c_str(), &r.celsius, source, sizeof source);
    r.source = source;
    return r;
}

int main() {
    const fs::path base = fs::temp_directory_path() / ("si-temp-test-" + std::to_string(std::rand()) + "-" + std::to_string(reinterpret_cast<std::uintptr_t>(&g_failures)));
    fs::remove_all(base);

    // Bad arguments are reported, never dereferenced.
    char buf[16];
    double c = 0;
    CHECK(si_cpu_temperature_at(nullptr, &c, buf, sizeof buf) == -1, "null root is an argument error");
    CHECK(si_cpu_temperature_at("/nonexistent-root", nullptr, buf, sizeof buf) == -1, "null output is an argument error");

    // An empty / missing tree is "no sensor", not zero degrees.
    {
        const auto r = read_at(base / "empty");
        CHECK(r.status == 0 && r.source.empty(), "an empty sysfs has no CPU sensor");
    }

    // THE REGRESSION: only the generic ACPI zone exists. It must not be presented as the CPU.
    {
        const fs::path root = base / "acpi-only";
        write(root / "class/thermal/thermal_zone0/type", "acpitz");
        write(root / "class/thermal/thermal_zone0/temp", "27800");
        write(root / "class/hwmon/hwmon0/name", "acpitz");
        write(root / "class/hwmon/hwmon0/temp1_input", "27800");
        const auto r = read_at(root);
        CHECK(r.status == 0, "the generic acpitz zone is never a CPU temperature");
    }

    // Intel coretemp: package label wins over per-core values, and the value is read live on every call.
    {
        const fs::path root = base / "intel";
        const fs::path hw = root / "class/hwmon/hwmon2";
        write(root / "class/thermal/thermal_zone0/type", "acpitz");
        write(root / "class/thermal/thermal_zone0/temp", "27800");
        write(hw / "name", "coretemp");
        write(hw / "temp1_input", "67000"); write(hw / "temp1_label", "Package id 0");
        write(hw / "temp2_input", "71000"); write(hw / "temp2_label", "Core 0");
        auto r = read_at(root);
        CHECK(r.status == 1 && r.celsius == 67.0 && r.source == "coretemp", "coretemp package temperature, not the ACPI zone");

        write(hw / "temp1_input", "82500");
        r = read_at(root);
        CHECK(r.status == 1 && r.celsius == 82.5, "the next call sees the new value (nothing is cached)");
        write(hw / "temp1_input", "41000");
        r = read_at(root);
        CHECK(r.celsius == 41.0, "and again when it falls");
    }

    // AMD: Tdie preferred over Tctl (Tctl carries an offset on some parts).
    {
        const fs::path root = base / "amd";
        const fs::path hw = root / "class/hwmon/hwmon0";
        write(hw / "name", "k10temp");
        write(hw / "temp1_input", "71000"); write(hw / "temp1_label", "Tctl");
        write(hw / "temp2_input", "65000"); write(hw / "temp2_label", "Tdie");
        auto r = read_at(root);
        CHECK(r.status == 1 && r.celsius == 65.0 && r.source == "k10temp", "k10temp prefers Tdie");
        fs::remove(hw / "temp2_input"); fs::remove(hw / "temp2_label");
        r = read_at(root);
        CHECK(r.status == 1 && r.celsius == 71.0, "falls back to Tctl when Tdie disappears (rediscovery)");
    }

    // Only per-core values: the hottest core is the package figure.
    {
        const fs::path root = base / "cores-only";
        const fs::path hw = root / "class/hwmon/hwmon1";
        write(hw / "name", "coretemp");
        write(hw / "temp2_input", "55000"); write(hw / "temp2_label", "Core 0");
        write(hw / "temp3_input", "61000"); write(hw / "temp3_label", "Core 1");
        auto r = read_at(root);
        CHECK(r.status == 1 && r.celsius == 61.0, "hottest core stands in for a missing package label");
        write(hw / "temp3_input", "48000");
        r = read_at(root);
        CHECK(r.celsius == 55.0, "and follows the cores live");
    }

    // x86_pkg_temp thermal zone is a real package sensor; generic zones around it are ignored.
    {
        const fs::path root = base / "zone";
        write(root / "class/thermal/thermal_zone0/type", "acpitz");
        write(root / "class/thermal/thermal_zone0/temp", "27000");
        write(root / "class/thermal/thermal_zone3/type", "x86_pkg_temp");
        write(root / "class/thermal/thermal_zone3/temp", "55000");
        const auto r = read_at(root);
        CHECK(r.status == 1 && r.celsius == 55.0 && r.source == "thermal-zone", "x86_pkg_temp zone, skipping acpitz");
    }

    // Broken sensors (0, negative, absurd) are skipped instead of reported.
    {
        const fs::path root = base / "broken";
        const fs::path hw = root / "class/hwmon/hwmon0";
        write(hw / "name", "coretemp");
        write(hw / "temp1_input", "0"); write(hw / "temp1_label", "Package id 0");
        CHECK(read_at(root).status == 0, "a 0 C reading is a broken sensor");
        write(hw / "temp1_input", "-273150");
        CHECK(read_at(root).status == 0, "a negative reading is a broken sensor");
        write(hw / "temp1_input", "255000");
        CHECK(read_at(root).status == 0, "an absurd reading is a broken sensor");
        write(hw / "temp1_input", "58000");
        CHECK(read_at(root).celsius == 58.0, "a sane reading is accepted again");
    }

    // Tiny output buffer: truncated and terminated, never overflowed.
    {
        const fs::path root = base / "small";
        write(root / "class/hwmon/hwmon0/name", "coretemp");
        write(root / "class/hwmon/hwmon0/temp1_input", "50000");
        write(root / "class/hwmon/hwmon0/temp1_label", "Package id 0");
        char tiny[4] = {'x', 'x', 'x', 'x'};
        double v = 0;
        CHECK(si_cpu_temperature_at((root).string().c_str(), &v, tiny, sizeof tiny) == 1 && tiny[3] == '\0', "a tiny source buffer is terminated");
    }

    // The legacy double API agrees with the new one on this machine (either a real value or -1, never a stale default).
    {
        double live = 0;
        char src[32];
        const int status = si_cpu_temperature(&live, src, sizeof src);
        const double legacy = get_cpu_temperature();
        CHECK(status == 1 ? (legacy > 0) : (legacy == -1.0), "legacy get_cpu_temperature agrees with si_cpu_temperature");
    }

    fs::remove_all(base);
    std::printf("cpu_temperature_test: %d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
