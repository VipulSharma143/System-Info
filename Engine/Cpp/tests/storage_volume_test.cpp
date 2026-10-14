// The index-based storage listing: one consistent scan per listing, the same answer on a repeat, nothing past the end.
#include "../include/native_engine.h"
#include <cstdio>
#include <string>
#include <vector>

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::printf("FAILED: %s (line %d)\n", #cond, __LINE__); ++failures; } } while (0)

struct Vol { std::string mount, fs; long long total = 0, free = 0; };

static std::vector<Vol> list_all() {
    std::vector<Vol> out;
    for (int i = 0; i < 128; ++i) {
        char mount[512], fs[64];
        long long total = -1, free = -1;
        if (si_get_storage_volume(i, mount, sizeof mount, fs, sizeof fs, &total, &free) != 1)
            break;
        out.push_back({mount, fs, total, free});
    }
    return out;
}

int main() {
    const auto first = list_all();
    const auto second = list_all();
    CHECK(first.size() == second.size());
    for (size_t i = 0; i < first.size() && i < second.size(); ++i) {
        CHECK(first[i].mount == second[i].mount && first[i].fs == second[i].fs && first[i].total == second[i].total);
        CHECK(!first[i].mount.empty() && first[i].total > 0);
        CHECK(first[i].free >= 0 && first[i].free <= first[i].total);
    }

    char mount[64], fs[16];
    long long total = 0, free = 0;
    CHECK(si_get_storage_volume(-1, mount, sizeof mount, fs, sizeof fs, &total, &free) == 0);
    CHECK(si_get_storage_volume(static_cast<int>(first.size()), mount, sizeof mount, fs, sizeof fs, &total, &free) == 0);
    CHECK(si_get_storage_volume(100000, mount, sizeof mount, fs, sizeof fs, &total, &free) == 0);
    if (!first.empty()) {   // null out-pointers and tiny buffers are accepted
        char tiny[2];
        CHECK(si_get_storage_volume(0, tiny, sizeof tiny, nullptr, 0, nullptr, nullptr) == 1);
        CHECK(tiny[1] == '\0');
    }

    if (failures == 0) std::printf("storage_volume_test OK (%zu volumes)\n", first.size());
    return failures == 0 ? 0 : 1;
}
