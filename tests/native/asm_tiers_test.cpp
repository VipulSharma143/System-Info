// Tier selection and the portable fallback. Run twice by ctest: once normally, once with SYSTEMINFO_NO_ASM=1 (argument
// "no-asm"), which must select the portable tier and still give identical answers.
#include "../../native/include/native_engine.h"

#include <chrono>
#include <cstdio>
#include <cstring>
#include <vector>

static int g_failures = 0, g_checks = 0;
#define CHECK(cond, what) do { ++g_checks; if (!(cond)) { ++g_failures; std::printf("FAIL: %s\n", what); } } while (0)

static void kernels_match_reference() {
    const long long lens[] = {1, 2, 7, 8, 9, 31, 33, 1000, 4099};
    for (long long n : lens) {
        std::vector<float> a(n + 3), b(n + 3), o(n + 3, -1.f);
        std::vector<int> ia(n + 3);
        std::vector<unsigned long long> w(n + 3);
        for (long long i = 0; i < n + 3; ++i) { a[i] = float(i % 13) - 6; b[i] = float(i % 7) * 0.5f; ia[i] = int(i * 2654435761u); w[i] = i * 0x9E3779B97F4A7C15ULL; }
        for (int off = 0; off < 3; ++off) {          // misaligned starts
            si_vec_add_f32(a.data() + off, b.data() + off, o.data() + off, n);
            bool ok = o[off + n] == -1.f || off + n >= n + 3;
            for (long long i = 0; i < n; ++i) ok = ok && o[off + i] == a[off + i] + b[off + i];
            CHECK(ok, "vector add matches and respects the end");
            double dot = 0; long long sum = 0; unsigned long long x = 0;
            int mn = ia[off], mx = ia[off];
            for (long long i = 0; i < n; ++i) { dot += double(a[off + i]) * b[off + i]; sum += ia[off + i]; x ^= w[off + i]; mn = ia[off + i] < mn ? ia[off + i] : mn; mx = ia[off + i] > mx ? ia[off + i] : mx; }
            const double got = si_dot_f32(a.data() + off, b.data() + off, n);
            CHECK(got - dot < 1e-3 * (1 + (dot < 0 ? -dot : dot)) && dot - got < 1e-3 * (1 + (dot < 0 ? -dot : dot)), "dot matches");
            CHECK(si_sum_i32(ia.data() + off, n) == sum, "sum matches");
            CHECK(si_xor_u64(w.data() + off, n) == x, "xor matches");
            int gmn = 0, gmx = 0;
            CHECK(si_minmax_i32(ia.data() + off, n, &gmn, &gmx) == 1 && gmn == mn && gmx == mx, "minmax matches");
        }
    }
    std::vector<unsigned char> s(1000), d(1000, 0), ov(1000);
    for (size_t i = 0; i < s.size(); ++i) { s[i] = (unsigned char)(i * 31 + 5); ov[i] = s[i]; }
    CHECK(si_memcpy(d.data(), s.data(), 1000) == 1 && d == s, "memcpy matches");
    CHECK(si_memcpy(ov.data() + 10, ov.data(), 500) == 1 && std::memcmp(ov.data() + 10, s.data(), 500) == 0, "overlapping memcpy behaves like memmove");
    CHECK(si_memcpy(nullptr, s.data(), 5) == 0 && si_memcpy(d.data(), s.data(), -1) == 0, "bad memcpy arguments are refused");
    CHECK(si_kernel_selftest() == 0, "the full selftest passes");
}

template <class F> static double seconds(F f) {
    const auto t0 = std::chrono::steady_clock::now();
    f();
    return std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
}

// Informational: what the assembly buys over the portable path on THIS machine. Printed, never asserted, because
// throughput is hardware-dependent and must not make CI flaky.
static void report_benchmark() {
    const long long n = 1 << 20;
    std::vector<int> ia(n, 3);
    std::vector<float> a(n, 1.5f), b(n, 2.f), o(n);
    volatile long long sink = 0;
    const int reps = 200;
    const int isa = si_active_isa();
    const double sumAsm = seconds([&] { for (int r = 0; r < reps; ++r) sink = si_sum_i32(ia.data(), n); });
    const double addAsm = seconds([&] { for (int r = 0; r < reps; ++r) si_vec_add_f32(a.data(), b.data(), o.data(), n); });
    si_force_portable(1);
    const double sumC = seconds([&] { for (int r = 0; r < reps; ++r) sink = si_sum_i32(ia.data(), n); });
    const double addC = seconds([&] { for (int r = 0; r < reps; ++r) si_vec_add_f32(a.data(), b.data(), o.data(), n); });
    (void)sink;
    std::printf("info: tier %d vs portable (x faster): sum %.2f  add %.2f\n", isa, sumC / sumAsm, addC / addAsm);
}

int main(int argc, char** argv) {
    const bool expectPortable = argc > 1 && std::strcmp(argv[1], "no-asm") == 0;
    const int isa = si_active_isa();
    CHECK(isa >= 0 && isa <= 2, "the tier is 0, 1 or 2");
    CHECK(si_asm_demotions() == 0, "no tier was demoted on a healthy machine");
    if (expectPortable) CHECK(isa == 0, "SYSTEMINFO_NO_ASM selects the portable tier");
    kernels_match_reference();
    if (!expectPortable) {
        report_benchmark();
        CHECK(si_active_isa() == 0, "si_force_portable switches to the portable tier at runtime");
        kernels_match_reference();
    }
    std::printf("asm_tiers_test(%s): %d checks, %d failures\n", expectPortable ? "no-asm" : "default", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
