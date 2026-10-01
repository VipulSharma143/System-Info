// Native engine tests. Built by CMake when -DBUILD_NATIVE_TESTS=ON and run
// with `ctest`. Exercises the Assembly kernels through the public C ABI.
#include "../../native/include/native_engine.h"
#include <cstdio>
#include <cstring>
#include <vector>

static int failures = 0;
#define CHECK(cond, msg) do { if (!(cond)) { std::printf("FAIL: %s\n", msg); failures++; } } while (0)

int main() {
    char vendor[16] = {0};
    CHECK(si_get_cpu_vendor(vendor, sizeof vendor) > 0, "cpu vendor readable");

    long long f = si_get_cpu_features();
    CHECK((f & SI_FEAT_SSE2) != 0, "SSE2 is x86-64 baseline and must be reported");
    if (f & SI_FEAT_AVX2) CHECK((f & SI_FEAT_AVX) != 0, "AVX2 implies AVX");
    CHECK(si_active_isa() == ((f & SI_FEAT_AVX2) ? 2 : 1), "dispatch matches detected features");

    // Every kernel vs the C++ reference: lengths 0..4099, misaligned pointers, both ISAs.
    CHECK(si_kernel_selftest() == 0, "assembly kernels match the reference implementation");

    // Regression: run_simd_comparison rounds down to a multiple of 4, so n < 4 reached the
    // SIMD loop with 0 iterations, which used to underflow its counter and spin forever.
    // (A hang here fails the test via the ctest TIMEOUT rather than stalling CI.)
    for (long long n : {-5LL, 0LL, 1LL, 3LL, 4LL, 7LL, 1000LL}) {
        double s = -1, v = -1; long long r = -1;
        run_simd_comparison(n, &s, &v);
        run_cpu_benchmark(n, &r);
        CHECK(s >= 0 && v >= 0, "benchmark rates are never negative");
    }
    run_simd_comparison(10, nullptr, nullptr);       // null outputs must not crash
    CHECK(run_cpu_benchmark(10, nullptr) >= 0, "null result pointer is tolerated");

    // Public wrappers must tolerate bad input instead of crashing.
    CHECK(si_sum_i32(nullptr, 10) == 0 && si_dot_f32(nullptr, nullptr, 10) == 0.0f, "null pointers are rejected");
    si_vec_add_f32(nullptr, nullptr, nullptr, 10);
    CHECK(si_sum_i32(reinterpret_cast<const int*>(&f), -1) == 0, "negative length is rejected");

    // 64-bit accumulation: 3 elements of INT32_MAX must not overflow 32 bits.
    int big[3] = {2147483647, 2147483647, 2147483647};
    CHECK(si_sum_i32(big, 3) == 3LL * 2147483647LL, "int32 sum accumulates in 64 bits");

    // ---- topology / storage / fans: values must be plausible or explicitly unknown ----
    int phys = 0, logical = 0, pk = 0;
    CHECK(si_get_cpu_topology(&phys, &logical, &pk) == 1, "cpu topology available");
    CHECK(logical >= 1, "at least one logical CPU");
    CHECK(phys == -1 || (phys >= 1 && phys <= logical), "physical cores unknown (-1) or within 1..logical");
    CHECK(si_get_cpu_topology(nullptr, nullptr, nullptr) == 1, "null outputs tolerated");

    int volumes = 0;
    char mount[256], fsType[64];
    long long total = -1, freeB = -1;
    for (int i = 0; i < 64 && si_get_storage_volume(i, mount, sizeof mount, fsType, sizeof fsType, &total, &freeB); i++) {
        volumes++;
        CHECK(mount[0] != '\0' && total > 0 && freeB >= 0 && freeB <= total, "volume has sane 64-bit sizes");
    }
    CHECK(si_get_storage_volume(-1, mount, sizeof mount, fsType, sizeof fsType, &total, &freeB) == 0, "negative volume index rejected");
    char tiny[3];
    if (volumes > 0) { CHECK(si_get_storage_volume(0, tiny, sizeof tiny, nullptr, 0, nullptr, nullptr) == 1 && std::strlen(tiny) <= 2, "tiny buffer truncated, NUL terminated"); }

    char label[128]; int rpm = -1;
    for (int i = 0; i < 64 && si_get_fan(i, label, sizeof label, &rpm); i++) CHECK(rpm >= 0 && label[0] != '\0', "fan has label and non-negative rpm");

    // ---- kernels through the public API ----
    int mn = 0, mx = 0;
    int vals[9] = {5, -2, 9, -7, 3, 100, -100, 0, 42};
    CHECK(si_minmax_i32(vals, 9, &mn, &mx) == 1 && mn == -100 && mx == 100, "minmax");
    CHECK(si_minmax_i32(vals, 0, &mn, &mx) == 0 && si_minmax_i32(nullptr, 3, &mn, &mx) == 0, "minmax rejects bad input");
    char over[16] = "abcdefghijklmno";
    CHECK(si_memcpy(over + 2, over, 8) == 1 && std::strcmp(over, "ababcdefghklmno") == 0, "overlapping copy behaves like memmove");
    CHECK(si_memcpy(nullptr, over, 4) == 0 && si_memcpy(over, over, -1) == 0 && si_memcpy(nullptr, nullptr, 0) == 1, "memcpy argument handling");
    std::vector<unsigned long long> words(1001);
    unsigned long long ref = 0;
    for (size_t i = 0; i < words.size(); i++) { words[i] = 0x9e3779b97f4a7c15ULL * (i + 1); ref ^= words[i]; }
    CHECK(si_xor_u64(words.data(), (long long)words.size()) == ref, "xor checksum matches reference");
    double copyGB = 0, readGB = 0;
    CHECK(si_memory_bandwidth(8 << 20, 2, &copyGB, &readGB) == 1 && copyGB > 0 && readGB > 0, "bandwidth benchmark runs");
    CHECK(si_memory_bandwidth(10, 1, &copyGB, &readGB) == 0, "bandwidth rejects tiny buffers");

    if (failures) std::printf("%d check(s) FAILED\n", failures);
    else std::printf("all native tests passed (%s, isa=%d)\n", vendor, si_active_isa());
    return failures ? 1 : 0;
}
