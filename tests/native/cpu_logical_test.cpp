// Per-logical-processor identity and hybrid (P/E core) detection.
// The parser and a fake /sys tree prove the hybrid logic without needing a hybrid CPU; the live read only checks
// that the real machine's answer is self-consistent.
#include "../../native/include/native_engine.h"
#include "../../native/src/cpu_list.h"

#include <cstdio>
#include <cstdlib>
#include <set>
#include <string>

#ifndef _WIN32
#include <filesystem>
#include <fstream>
namespace fs = std::filesystem;
#endif

static int failures = 0;

#define CHECK(cond)                                                          \
    do {                                                                     \
        if (!(cond)) {                                                       \
            std::printf("FAIL line %d: %s\n", __LINE__, #cond);              \
            ++failures;                                                      \
        }                                                                    \
    } while (0)

static void test_parser() {
    CHECK((parse_cpu_list("0-3") == std::set<int>{0, 1, 2, 3}));
    CHECK((parse_cpu_list("0,2,4-5\n") == std::set<int>{0, 2, 4, 5}));
    CHECK(parse_cpu_list("").empty());
    CHECK(parse_cpu_list("abc").empty());
    CHECK((parse_cpu_list("1,x,3") == std::set<int>{1, 3}));
    CHECK((parse_cpu_list("5-2,7") == std::set<int>{7}));
}

static void test_live_consistency() {
    int physical = -1, logical = -1, packages = -1;
    CHECK(si_get_cpu_topology(&physical, &logical, &packages) == 1);

    int count = 0;
    std::set<int> cores;
    std::set<int> classes;
    int firstClassCount = -1;

    for (int i = 0; i < 4096; ++i) {
        int coreId, cls, classCount;
        if (!si_get_cpu_logical_info(i, &coreId, &cls, &classCount))
            break;
        ++count;
        if (coreId >= 0)
            cores.insert(coreId);
        CHECK((cls == -1) == (classCount == -1));
        if (cls >= 0) {
            CHECK(cls < classCount);
            classes.insert(cls);
        }
        if (i == 0)
            firstClassCount = classCount;
    }

    CHECK(count == logical);
    if (physical > 0 && !cores.empty())
        CHECK(static_cast<int>(cores.size()) == physical);
    if (firstClassCount > 0)
        CHECK(static_cast<int>(classes.size()) == firstClassCount);

    int coreId, cls, classCount;
    CHECK(si_get_cpu_logical_info(-1, &coreId, &cls, &classCount) == 0);
    CHECK(si_get_cpu_logical_info(count, &coreId, &cls, &classCount) == 0);
    CHECK(cls == -1 && classCount == -1 && coreId == -1);
}

#ifndef _WIN32
static void write(const fs::path& path, const std::string& text) {
    fs::create_directories(path.parent_path());
    std::ofstream(path) << text << "\n";
}

// 4 P-core threads (2 cores x 2), 2 E-cores: cpu0-3 P, cpu4-5 E.
static void build_cpu(const fs::path& root, int cpu, int core) {
    const auto base = root / "devices/system/cpu" / ("cpu" + std::to_string(cpu));
    write(base / "topology/core_id", std::to_string(core));
    write(base / "topology/physical_package_id", "0");
}

static void test_fake_hybrid() {
    const fs::path root = fs::temp_directory_path() / "si_cpu_logical_test";
    fs::remove_all(root);

    for (int cpu = 0; cpu < 4; ++cpu) build_cpu(root, cpu, cpu / 2);
    build_cpu(root, 4, 8);
    build_cpu(root, 5, 9);
    build_cpu(root, 10, 10);   // numeric order: cpu10 must come after cpu5, not after cpu1
    write(root / "devices/cpu_core/cpus", "0-3");
    write(root / "devices/cpu_atom/cpus", "4-5,10");

    setenv("SYSTEMINFO_SYSFS_ROOT", root.c_str(), 1);

    int coreId, cls, classCount;
    CHECK(si_get_cpu_logical_info(0, &coreId, &cls, &classCount) == 1);
    CHECK(cls == 1 && classCount == 2);
    const int core0 = coreId;
    CHECK(si_get_cpu_logical_info(1, &coreId, &cls, &classCount) == 1);
    CHECK(coreId == core0);                       // SMT sibling shares the core id
    CHECK(si_get_cpu_logical_info(2, &coreId, &cls, &classCount) == 1);
    CHECK(coreId != core0);
    CHECK(cls == 1);                              // cpu2 is still a P-core (cpu10 must not sort before it)
    CHECK(si_get_cpu_logical_info(4, &coreId, &cls, &classCount) == 1);
    CHECK(cls == 0 && classCount == 2);           // cpu4 is an E-core
    CHECK(si_get_cpu_logical_info(6, &coreId, &cls, &classCount) == 1);
    CHECK(cls == 0);                              // index 6 is cpu10, last in numeric order
    CHECK(si_get_cpu_logical_info(7, &coreId, &cls, &classCount) == 0);

    // Only one kind of core: not hybrid, so no class is reported.
    fs::remove_all(root / "devices/cpu_atom");
    CHECK(si_get_cpu_logical_info(0, &coreId, &cls, &classCount) == 1);
    CHECK(cls == -1 && classCount == -1);

    unsetenv("SYSTEMINFO_SYSFS_ROOT");
    fs::remove_all(root);
}
#endif

int main() {
    test_parser();
    test_live_consistency();
#ifndef _WIN32
    test_fake_hybrid();
#endif
    if (failures) {
        std::printf("%d failure(s)\n", failures);
        return 1;
    }
    std::printf("cpu_logical_test: ok\n");
    return 0;
}
