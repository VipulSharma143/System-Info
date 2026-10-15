// Series engine: the public functions against naive reference code, every assembly tier called directly, NaN handling,
// slope accuracy with a large offset, and a guard-page check that no kernel reads outside [a, a + n).
#include "../include/native_engine.h"
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <vector>
#if defined(__linux__)
#include <sys/mman.h>
#include <unistd.h>
#endif

extern "C" {
struct SiSeriesRegress { double sx, sy, sxy, sxx; };
void   si_series_stats_f64_sse2(const double*, size_t, SiSeriesStats*);
void   si_series_stats_f64_avx2(const double*, size_t, SiSeriesStats*);
void   si_series_regress_f64_sse2(const double*, const double*, size_t, SiSeriesRegress*);
void   si_series_regress_f64_avx2(const double*, const double*, size_t, SiSeriesRegress*);
size_t si_series_count_ge_f64_avx2(const double*, size_t, const double*);
size_t si_series_find_ge_f64_sse2(const double*, size_t, size_t, const double*);
size_t si_series_find_ge_f64_avx2(const double*, size_t, size_t, const double*);
size_t si_series_find_nge_f64_sse2(const double*, size_t, size_t, const double*);
size_t si_series_find_nge_f64_avx2(const double*, size_t, size_t, const double*);
}

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::printf("FAILED: %s (line %d)\n", #cond, __LINE__); ++failures; } } while (0)

static uint32_t seed = 20261015u;
static uint32_t rnd() { seed = seed * 1664525u + 1013904223u; return seed; }
static bool near(double got, double want, double rel = 1e-9) { return std::fabs(got - want) <= rel * (1.0 + std::fabs(want)); }

struct RunRef { long long s, e; };
static std::vector<RunRef> naive_runs(const std::vector<double>& a, double thr, long long minLen) {
    std::vector<RunRef> runs; long long start = -1;
    for (long long i = 0; i < (long long)a.size(); i++) {
        const bool above = a[i] >= thr;
        if (above && start < 0) start = i;
        else if (!above && start >= 0) { if (i - start >= minLen) runs.push_back({start, i - 1}); start = -1; }
    }
    if (start >= 0 && (long long)a.size() - start >= minLen) runs.push_back({start, (long long)a.size() - 1});
    return runs;
}

static void test_arguments() {
    SiSeriesStats st{}; double v[3] = {1, 2, 3}; double slope = 0;
    CHECK(si_series_stats(nullptr, 3, &st) == 0);
    CHECK(si_series_stats(v, 0, &st) == 0);
    CHECK(si_series_stats(v, -1, &st) == 0);
    CHECK(si_series_stats(v, 3, nullptr) == 0);
    CHECK(si_series_stats(v, 3, &st) == 1 && st.sum == 6 && st.min == 1 && st.max == 3);
    double one = 7.5; CHECK(si_series_stats(&one, 1, &st) == 1 && st.sum == 7.5 && st.min == 7.5 && st.max == 7.5);
    CHECK(si_series_slope(v, v, 1, &slope) == 0);
    CHECK(si_series_slope(nullptr, v, 3, &slope) == 0);
    double flat[3] = {5, 5, 5};
    CHECK(si_series_slope(flat, v, 3, &slope) == 0);                 // no spread in x: no slope
    CHECK(si_series_slope(v, v, 3, &slope) == 1 && near(slope, 1.0));
    CHECK(si_series_count_ge(nullptr, 3, 0) == 0 && si_series_count_ge(v, 0, 0) == 0);
    CHECK(si_series_find_runs(nullptr, 3, 0, 1, nullptr, 0) == 0);
    CHECK(si_series_collect_ge(v, 0, 0, nullptr, nullptr, 0) == 0);
}

static void test_against_reference() {
    for (int round = 0; round < 60; round++) {
        const size_t n = (round < 40) ? (size_t)(rnd() % 300) + 1 : (size_t)(rnd() % 20000) + 1;
        std::vector<double> a(n), b(n), c(n);
        for (size_t i = 0; i < n; i++) {
            a[i] = (double)((int)(rnd() % 20001) - 10000) / 100.0;
            b[i] = (double)((int)(rnd() % 2001) - 1000) / 10.0;
            c[i] = (rnd() % 6 == 0) ? std::nan("") : (double)(rnd() % 101);     // 0..100 with gaps
        }
        SiSeriesStats st{};
        CHECK(si_series_stats(a.data(), (long long)n, &st) == 1);
        double sum = 0, lo = a[0], hi = a[0];
        for (double v : a) { sum += v; lo = std::fmin(lo, v); hi = std::fmax(hi, v); }
        CHECK(near(st.sum, sum) && st.min == lo && st.max == hi);

        // slope against a centred two-pass computation in long double
        std::vector<double> x(n);
        for (size_t i = 0; i < n; i++) x[i] = (double)i * 1.0 + 1.7e9;           // large offset, like Unix seconds
        double got = 0;
        const int ok = si_series_slope(x.data(), b.data(), (long long)n, &got);
        if (n >= 2) {
            long double mx = 0, my = 0, num = 0, den = 0;
            for (size_t i = 0; i < n; i++) { mx += x[i]; my += b[i]; }
            mx /= n; my /= n;
            for (size_t i = 0; i < n; i++) { num += (x[i] - mx) * (b[i] - my); den += (x[i] - mx) * (x[i] - mx); }
            CHECK(ok == 1 && near(got, (double)(num / den), 1e-9));
        } else CHECK(ok == 0);

        for (double thr : {0.0, 50.0, 90.0, 101.0}) {
            long long want = 0; for (double v : c) want += (v >= thr);
            CHECK(si_series_count_ge(c.data(), (long long)n, thr) == want);
            for (long long minLen : {1LL, 2LL, 5LL, 30LL}) {
                const auto ref = naive_runs(c, thr, minLen);
                std::vector<long long> out(2 * (ref.size() + 1), -7);
                const long long found = si_series_find_runs(c.data(), (long long)n, thr, minLen, out.data(), (long long)ref.size() + 1);
                CHECK(found == (long long)ref.size());
                for (size_t k = 0; k < ref.size() && k < out.size() / 2; k++) CHECK(out[2 * k] == ref[k].s && out[2 * k + 1] == ref[k].e);
                // capacity smaller than the number of runs: the full count is still reported
                if (ref.size() >= 2) {
                    long long small[2] = {-1, -1};
                    CHECK(si_series_find_runs(c.data(), (long long)n, thr, minLen, small, 1) == (long long)ref.size());
                    CHECK(small[0] == ref[0].s && small[1] == ref[0].e);
                }
            }
            std::vector<unsigned char> skip(n);
            for (size_t i = 0; i < n; i++) skip[i] = (rnd() % 4 == 0);
            std::vector<long long> want_idx;
            for (size_t i = 0; i < n; i++) if (c[i] >= thr && !skip[i]) want_idx.push_back((long long)i);
            std::vector<long long> got_idx(want_idx.size() + 1);
            CHECK(si_series_collect_ge(c.data(), (long long)n, thr, skip.data(), got_idx.data(), (long long)got_idx.size()) == (long long)want_idx.size());
            got_idx.resize(want_idx.size());
            CHECK(got_idx == want_idx);
            long long total = 0; for (double v : c) total += (v >= thr);
            CHECK(si_series_collect_ge(c.data(), (long long)n, thr, nullptr, nullptr, 0) == total);
        }
    }
}

static void test_slope_accuracy() {
    // y = 3.5 * seconds + 1e9 over a day of seconds: the offset must not eat the slope
    const size_t n = 86400;
    std::vector<double> x(n), y(n);
    for (size_t i = 0; i < n; i++) { x[i] = 1.7e9 + (double)i; y[i] = 1e9 + 3.5 * (double)i; }
    double slope = 0;
    CHECK(si_series_slope(x.data(), y.data(), (long long)n, &slope) == 1 && near(slope, 3.5, 1e-9));
    for (size_t i = 0; i < n; i++) y[i] = 42.0;
    CHECK(si_series_slope(x.data(), y.data(), (long long)n, &slope) == 1 && std::fabs(slope) < 1e-12);
}

static void test_nan_semantics() {
    const double nan = std::nan("");
    std::vector<double> a = {nan, 50, 60, nan, 70, 80, 90, nan, nan, 95};
    CHECK(si_series_count_ge(a.data(), (long long)a.size(), 50) == 6);       // NaN is never >= anything
    long long runs[8];
    const long long found = si_series_find_runs(a.data(), (long long)a.size(), 50, 1, runs, 4);
    CHECK(found == 3);
    CHECK(runs[0] == 1 && runs[1] == 2 && runs[2] == 4 && runs[3] == 6);    // a NaN ends a run
    long long all[8] = {0};
    CHECK(si_series_find_runs(a.data(), (long long)a.size(), 50, 1, all, 4) == 3 && all[4] == 9 && all[5] == 9);
    CHECK(si_series_find_runs(a.data(), (long long)a.size(), 50, 2, all, 4) == 2);   // minimum length drops the single value at the end
}

static void test_tiers_directly() {
    // Every tier on the same data as the dispatcher: SSE2 always, AVX2 when this CPU and OS have it.
    const bool avx2 = (si_get_cpu_features() & SI_FEAT_AVX2) != 0;
    std::vector<double> a(1003), b(1003);
    for (size_t i = 0; i < a.size(); i++) { a[i] = (double)((int)(rnd() % 2001) - 1000) / 8.0; b[i] = (double)(rnd() % 977) / 3.0; }
    for (size_t n : {1u, 2u, 3u, 4u, 5u, 7u, 8u, 9u, 63u, 64u, 65u, 1000u}) {
        SiSeriesStats ref{}, s2{}, s3{};
        double sum = 0, lo = a[1], hi = a[1];
        for (size_t i = 0; i < n; i++) { sum += a[1 + i]; lo = std::fmin(lo, a[1 + i]); hi = std::fmax(hi, a[1 + i]); }   // offset 1: misaligned
        si_series_stats_f64_sse2(a.data() + 1, n, &s2);
        CHECK(near(s2.sum, sum) && s2.min == lo && s2.max == hi);
        if (avx2) { si_series_stats_f64_avx2(a.data() + 1, n, &s3); CHECK(near(s3.sum, sum) && s3.min == lo && s3.max == hi); }
        (void)ref;
        SiSeriesRegress r2{}, r3{};
        double sx = 0, sy = 0, sxy = 0, sxx = 0;
        for (size_t i = 0; i < n; i++) { sx += a[1 + i]; sy += b[1 + i]; sxy += b[1 + i] * a[1 + i]; sxx += a[1 + i] * a[1 + i]; }
        si_series_regress_f64_sse2(a.data() + 1, b.data() + 1, n, &r2);
        CHECK(near(r2.sx, sx) && near(r2.sy, sy) && near(r2.sxy, sxy) && near(r2.sxx, sxx));
        if (avx2) { si_series_regress_f64_avx2(a.data() + 1, b.data() + 1, n, &r3); CHECK(near(r3.sx, sx) && near(r3.sy, sy) && near(r3.sxy, sxy) && near(r3.sxx, sxx)); }
    }
}

#if defined(__linux__)
// An array that ends exactly at the end of a mapped page: any read past the last element faults.
static void test_no_overread() {
    const size_t page = (size_t)sysconf(_SC_PAGESIZE);
    const bool avx2 = (si_get_cpu_features() & SI_FEAT_AVX2) != 0;
    for (size_t n : {1u, 2u, 3u, 4u, 5u, 6u, 7u, 8u, 9u, 31u, 33u}) {
        char* map = (char*)mmap(nullptr, 2 * page, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
        if (map == MAP_FAILED) { std::puts("mmap unavailable; over-read check skipped"); return; }
        mprotect(map + page, page, PROT_NONE);
        double* a = (double*)(map + page) - n;
        double* b = (double*)(map + page) - n;
        for (size_t i = 0; i < n; i++) a[i] = (double)i + 1.0;
        const double thr = 3.0;
        SiSeriesStats st{}; SiSeriesRegress rg{};
        si_series_stats_f64_sse2(a, n, &st); si_series_regress_f64_sse2(a, b, n, &rg);
        (void)si_series_find_ge_f64_sse2(a, n, 0, &thr);
        (void)si_series_find_nge_f64_sse2(a, n, 0, &thr);
        (void)si_series_find_ge_f64_sse2(a, n, n / 2, &thr);
        if (avx2) {
            si_series_stats_f64_avx2(a, n, &st); si_series_regress_f64_avx2(a, b, n, &rg);
            (void)si_series_count_ge_f64_avx2(a, n, &thr);
            (void)si_series_find_ge_f64_avx2(a, n, 0, &thr);
            (void)si_series_find_nge_f64_avx2(a, n, 0, &thr);
            (void)si_series_find_ge_f64_avx2(a, n, n / 2, &thr);
        }
        SiSeriesStats pub{}; double slope = 0;
        si_series_stats(a, (long long)n, &pub);
        (void)si_series_slope(a, b, (long long)n, &slope);
        (void)si_series_count_ge(a, (long long)n, thr);
        munmap(map, 2 * page);
    }
}
#else
static void test_no_overread() {}
#endif

int main() {
    test_arguments();
    test_against_reference();
    test_slope_accuracy();
    test_nan_semantics();
    test_tiers_directly();
    test_no_overread();
    CHECK(si_kernel_selftest() == 0);   // the selftest that guards the tier decision covers these kernels too
    if (failures == 0) std::printf("series_engine_test OK (isa tier %d)\n", si_active_isa());
    return failures == 0 ? 0 : 1;
}
