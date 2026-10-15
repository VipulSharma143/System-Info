// series_engine.cpp — the series engine: statistics, trend and threshold scans over double-precision series.
//
// The inner loops are the Assembly kernels in Engine/Assembly/analytics/ (AVX2 and SSE2 versions). This file owns what
// the assembly must not: argument checking, the portable fallback, the choice of tier, chunking (so no allocation is
// needed), the run/spike logic built from the scan kernels, and the selftest that decides whether a tier is trusted.
// The tier is the one decided by simd_dispatch.cpp (si_active_isa), so the kill switch SYSTEMINFO_NO_ASM=1 and the
// demotion of a tier that fails its selftest apply here as well.
#include "../include/native_engine.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

extern "C" {
void   si_series_stats_f64_sse2(const double*, size_t, SiSeriesStats*);
void   si_series_stats_f64_avx2(const double*, size_t, SiSeriesStats*);
struct SiSeriesRegress { double sx, sy, sxy, sxx; };   // layout shared with series_stats.asm
void   si_series_regress_f64_sse2(const double*, const double*, size_t, SiSeriesRegress*);
void   si_series_regress_f64_avx2(const double*, const double*, size_t, SiSeriesRegress*);
size_t si_series_count_ge_f64_avx2(const double*, size_t, const double*);
size_t si_series_find_ge_f64_sse2(const double*, size_t, size_t, const double*);
size_t si_series_find_ge_f64_avx2(const double*, size_t, size_t, const double*);
size_t si_series_find_nge_f64_sse2(const double*, size_t, size_t, const double*);
size_t si_series_find_nge_f64_avx2(const double*, size_t, size_t, const double*);

int si_series_selftest_impl(int isa);   // called by si_kernel_selftest_impl (simd_dispatch.cpp)
}

namespace {

// ---- portable kernels: plain C++, used when assembly is unavailable, disabled or demoted; also the selftest reference ----
void port_stats(const double* a, size_t n, SiSeriesStats* o) {
    double sum = 0, lo = a[0], hi = a[0];
    for (size_t i = 0; i < n; i++) { sum += a[i]; lo = std::min(lo, a[i]); hi = std::max(hi, a[i]); }
    o->sum = sum; o->min = lo; o->max = hi;
}
void port_regress(const double* x, const double* y, size_t n, SiSeriesRegress* o) {
    double sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (size_t i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxy += y[i] * x[i]; sxx += x[i] * x[i]; }
    o->sx = sx; o->sy = sy; o->sxy = sxy; o->sxx = sxx;
}
// value >= threshold is false for NaN, in every tier.
size_t port_count_ge(const double* a, size_t n, const double* t) { size_t c = 0; for (size_t i = 0; i < n; i++) c += (a[i] >= *t); return c; }
size_t port_find_ge(const double* a, size_t n, size_t start, const double* t) { for (size_t i = start; i < n; i++) if (a[i] >= *t) return i; return n; }
size_t port_find_nge(const double* a, size_t n, size_t start, const double* t) { for (size_t i = start; i < n; i++) if (!(a[i] >= *t)) return i; return n; }

// ---- tier dispatch (2 = AVX2, 1 = SSE2, anything else = portable) ----
void k_stats(const double* a, size_t n, SiSeriesStats* o) {
    switch (si_active_isa()) { case 2: si_series_stats_f64_avx2(a, n, o); break; case 1: si_series_stats_f64_sse2(a, n, o); break; default: port_stats(a, n, o); }
}
void k_regress(const double* x, const double* y, size_t n, SiSeriesRegress* o) {
    switch (si_active_isa()) { case 2: si_series_regress_f64_avx2(x, y, n, o); break; case 1: si_series_regress_f64_sse2(x, y, n, o); break; default: port_regress(x, y, n, o); }
}
size_t k_count_ge(const double* a, size_t n, const double* t) {
    // SSE2 has no count kernel (it was slower than this loop); tier 1 and tier 0 both use the portable one.
    return si_active_isa() == 2 ? si_series_count_ge_f64_avx2(a, n, t) : port_count_ge(a, n, t);
}
size_t k_find_ge(const double* a, size_t n, size_t s, const double* t) {
    switch (si_active_isa()) { case 2: return si_series_find_ge_f64_avx2(a, n, s, t); case 1: return si_series_find_ge_f64_sse2(a, n, s, t); default: return port_find_ge(a, n, s, t); }
}
size_t k_find_nge(const double* a, size_t n, size_t s, const double* t) {
    switch (si_active_isa()) { case 2: return si_series_find_nge_f64_avx2(a, n, s, t); case 1: return si_series_find_nge_f64_sse2(a, n, s, t); default: return port_find_nge(a, n, s, t); }
}

}  // namespace

extern "C" {

int si_series_stats(const double* a, long long n, SiSeriesStats* out) {
    if (n <= 0 || !a || !out) return 0;
    k_stats(a, static_cast<size_t>(n), out);
    return 1;
}

int si_series_slope(const double* x, const double* y, long long n, double* slopeOut) {
    if (n < 2 || !x || !y || !slopeOut) return 0;
    // Shift by the first point and sum in fixed-size chunks: no allocation, and the sums stay small and accurate.
    constexpr size_t kChunk = 2048;
    double xs[kChunk], ys[kChunk];
    const double x0 = x[0], y0 = y[0];
    double sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (size_t done = 0; done < static_cast<size_t>(n); ) {
        const size_t m = std::min(kChunk, static_cast<size_t>(n) - done);
        for (size_t i = 0; i < m; i++) { xs[i] = x[done + i] - x0; ys[i] = y[done + i] - y0; }
        SiSeriesRegress r;
        k_regress(xs, ys, m, &r);
        sx += r.sx; sy += r.sy; sxy += r.sxy; sxx += r.sxx;
        done += m;
    }
    const double dn = static_cast<double>(n);
    const double den = dn * sxx - sx * sx;
    const double slope = (dn * sxy - sx * sy) / den;
    if (den == 0.0 || !std::isfinite(slope)) return 0;
    *slopeOut = slope;
    return 1;
}

long long si_series_count_ge(const double* a, long long n, double threshold) {
    if (n <= 0 || !a) return 0;
    return static_cast<long long>(k_count_ge(a, static_cast<size_t>(n), &threshold));
}

long long si_series_find_runs(const double* a, long long n, double threshold, long long minLen, long long* out, long long capPairs) {
    if (n <= 0 || !a) return 0;
    const size_t len = static_cast<size_t>(n);
    long long runs = 0;
    size_t i = 0;
    while (i < len) {
        const size_t start = k_find_ge(a, len, i, &threshold);
        if (start >= len) break;
        const size_t end = k_find_nge(a, len, start + 1, &threshold);   // first value after the run (len if it runs to the end)
        if (static_cast<long long>(end - start) >= minLen) {
            if (out && runs < capPairs) { out[2 * runs] = static_cast<long long>(start); out[2 * runs + 1] = static_cast<long long>(end - 1); }
            ++runs;
        }
        i = end;
    }
    return runs;
}

long long si_series_collect_ge(const double* a, long long n, double threshold, const unsigned char* skip, long long* outIdx, long long cap) {
    if (n <= 0 || !a) return 0;
    const size_t len = static_cast<size_t>(n);
    long long count = 0;
    size_t i = 0;
    while (i < len) {
        const size_t idx = k_find_ge(a, len, i, &threshold);
        if (idx >= len) break;
        if (!skip || !skip[idx]) {
            if (outIdx && count < cap) outIdx[count] = static_cast<long long>(idx);
            ++count;
        }
        i = idx + 1;
    }
    return count;
}

// Checks one assembly tier (1 = SSE2, 2 = AVX2) against the portable code across boundary lengths and misaligned
// pointers. Returns 0 when everything matches, otherwise a bitmask: 1 = stats, 2 = regression sums, 4 = count,
// 8 = find first at/above, 16 = find first not at/above.
int si_series_selftest_impl(int isa) {
    const size_t lens[] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 100, 1000, 4099};
    const size_t maxN = 4099 + 8;
    std::vector<double> a(maxN + 4), b(maxN + 4), withNan(maxN + 4);
    uint32_t seed = 987654321u;
    auto rnd = [&]() { seed = seed * 1664525u + 1013904223u; return seed; };
    for (size_t i = 0; i < a.size(); i++) {
        a[i] = static_cast<double>(static_cast<int>(rnd() % 20001) - 10000) / 100.0;     // -100.00 .. 100.00
        b[i] = static_cast<double>(static_cast<int>(rnd() % 20001) - 10000) / 7.0;
        withNan[i] = (rnd() % 5 == 0) ? std::nan("") : a[i];                              // about one in five is missing
    }
    int fail = 0;
    auto near = [](double got, double want) { return std::fabs(got - want) <= 1e-9 * (1.0 + std::fabs(want)); };

    for (size_t off = 0; off < 4; off++) {
        for (size_t n : lens) {
            const double* pa = a.data() + off;
            const double* pb = b.data() + off;
            const double* pn = withNan.data() + off;
            if (n > 0) {
                SiSeriesStats want{}, got{-1, -1, -1};
                port_stats(pa, n, &want);
                if (isa == 2) si_series_stats_f64_avx2(pa, n, &got); else si_series_stats_f64_sse2(pa, n, &got);
                if (!near(got.sum, want.sum) || got.min != want.min || got.max != want.max) fail |= 1;

                SiSeriesRegress rw{}, rg{-1, -1, -1, -1};
                port_regress(pa, pb, n, &rw);
                if (isa == 2) si_series_regress_f64_avx2(pa, pb, n, &rg); else si_series_regress_f64_sse2(pa, pb, n, &rg);
                if (!near(rg.sx, rw.sx) || !near(rg.sy, rw.sy) || !near(rg.sxy, rw.sxy) || !near(rg.sxx, rw.sxx)) fail |= 2;
            } else {   // n == 0 must leave the outputs alone
                SiSeriesStats g{11, 22, 33};
                SiSeriesRegress r{1, 2, 3, 4};
                if (isa == 2) { si_series_stats_f64_avx2(pa, 0, &g); si_series_regress_f64_avx2(pa, pb, 0, &r); }
                else { si_series_stats_f64_sse2(pa, 0, &g); si_series_regress_f64_sse2(pa, pb, 0, &r); }
                if (g.sum != 11 || g.min != 22 || g.max != 33) fail |= 1;
                if (r.sx != 1 || r.sy != 2 || r.sxy != 3 || r.sxx != 4) fail |= 2;
            }

            for (const double thr : {-50.0, 0.0, 25.5, 99.99, 1000.0}) {
                for (const double* src : {pa, pn}) {   // with and without NaN
                    const size_t wantCount = port_count_ge(src, n, &thr);
                    const size_t gotCount = isa == 2 ? si_series_count_ge_f64_avx2(src, n, &thr) : port_count_ge(src, n, &thr);
                    if (gotCount != wantCount) fail |= 4;
                    for (const size_t start : {size_t{0}, size_t{1}, n / 2, n ? n - 1 : 0, n, n + 3}) {
                        const size_t wg = port_find_ge(src, n, start, &thr), wn = port_find_nge(src, n, start, &thr);
                        const size_t gg = isa == 2 ? si_series_find_ge_f64_avx2(src, n, start, &thr) : si_series_find_ge_f64_sse2(src, n, start, &thr);
                        const size_t gn = isa == 2 ? si_series_find_nge_f64_avx2(src, n, start, &thr) : si_series_find_nge_f64_sse2(src, n, start, &thr);
                        if (gg != wg) fail |= 8;
                        if (gn != wn) fail |= 16;
                    }
                }
            }
        }
    }
    return fail;
}

}  // extern "C"
