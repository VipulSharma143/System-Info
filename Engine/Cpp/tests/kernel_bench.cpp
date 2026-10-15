// kernel_bench.cpp — measures every Assembly kernel tier against the portable C++ loop it falls back to.
// Not a pass/fail test: it prints median-of-runs throughput (GB/s of input read, plus output written for add) per
// working-set size so a kernel is only kept, changed or added when the numbers justify it. Built only with
// -DBUILD_NATIVE_BENCH=ON; it links the object library because the per-tier entry points are not exported.
#include "../include/native_engine.h"
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <vector>

extern "C" {
void  si_vec_add_f32_sse2(const float*, const float*, float*, size_t);
void  si_vec_add_f32_avx2(const float*, const float*, float*, size_t);
float si_dot_f32_sse2(const float*, const float*, size_t);
float si_dot_f32_avx2(const float*, const float*, size_t);
long long si_sum_i32_sse2(const int*, size_t);
long long si_sum_i32_avx2(const int*, size_t);
void si_minmax_i32_sse2(const int*, size_t, int*, int*);
void si_minmax_i32_avx2(const int*, size_t, int*, int*);
unsigned long long si_xor_u64_sse2(const unsigned long long*, size_t);
unsigned long long si_xor_u64_avx2(const unsigned long long*, size_t);
void si_stats_f32_sse2(const float*, size_t, SiStatsF32*);
void si_stats_f32_avx2(const float*, size_t, SiStatsF32*);
// Series (analytics) kernels, double precision.
struct SiSeriesRegress { double sx, sy, sxy, sxx; };
void   si_series_stats_f64_sse2(const double*, size_t, SiSeriesStats*);
void   si_series_stats_f64_avx2(const double*, size_t, SiSeriesStats*);
void   si_series_regress_f64_sse2(const double*, const double*, size_t, SiSeriesRegress*);
void   si_series_regress_f64_avx2(const double*, const double*, size_t, SiSeriesRegress*);
size_t si_series_count_ge_f64_avx2(const double*, size_t, const double*);
size_t si_series_find_ge_f64_sse2(const double*, size_t, size_t, const double*);
size_t si_series_find_ge_f64_avx2(const double*, size_t, size_t, const double*);
}

// Portable fallbacks, identical to the ones in simd_dispatch.cpp.
#if defined(_MSC_VER)
#define NOINL __declspec(noinline)
#else
#define NOINL __attribute__((noinline))
#endif
NOINL static void port_add(const float* a, const float* b, float* o, size_t n) { for (size_t i = 0; i < n; i++) o[i] = a[i] + b[i]; }
NOINL static float port_dot(const float* a, const float* b, size_t n) { double s = 0; for (size_t i = 0; i < n; i++) s += (double)a[i] * b[i]; return (float)s; }
NOINL static long long port_sum(const int* a, size_t n) { long long s = 0; for (size_t i = 0; i < n; i++) s += a[i]; return s; }
NOINL static void port_minmax(const int* a, size_t n, int* mn, int* mx) { int lo = a[0], hi = a[0]; for (size_t i = 1; i < n; i++) { lo = std::min(lo, a[i]); hi = std::max(hi, a[i]); } *mn = lo; *mx = hi; }
NOINL static unsigned long long port_xor(const unsigned long long* a, size_t n) { unsigned long long x = 0; for (size_t i = 0; i < n; i++) x ^= a[i]; return x; }
NOINL static void port_stats(const float* a, size_t n, SiStatsF32* s) {
    float sum = 0, mx = n ? a[0] : 0; int cnt = 0;
    for (size_t i = 0; i < n; i++) { sum += a[i]; if (a[i] > mx) mx = a[i]; if (a[i] >= s->threshold) cnt++; }
    s->sum = sum; s->max = mx; s->count = cnt;
}

NOINL static void port_sstats(const double* a, size_t n, SiSeriesStats* o) { double sum = 0, lo = a[0], hi = a[0]; for (size_t i = 0; i < n; i++) { sum += a[i]; lo = std::min(lo, a[i]); hi = std::max(hi, a[i]); } o->sum = sum; o->min = lo; o->max = hi; }
NOINL static void port_sregress(const double* x, const double* y, size_t n, SiSeriesRegress* o) { double sx = 0, sy = 0, sxy = 0, sxx = 0; for (size_t i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxy += y[i] * x[i]; sxx += x[i] * x[i]; } o->sx = sx; o->sy = sy; o->sxy = sxy; o->sxx = sxx; }
NOINL static size_t port_scount(const double* a, size_t n, const double* t) { size_t c = 0; for (size_t i = 0; i < n; i++) c += (a[i] >= *t); return c; }
NOINL static size_t port_sfind(const double* a, size_t n, size_t s, const double* t) { for (size_t i = s; i < n; i++) if (a[i] >= *t) return i; return n; }

using clk = std::chrono::steady_clock;
static volatile double g_sink;

// Median of 7 timed batches; each batch repeats the call until ~20 ms have passed.
static double seconds_per_call(const std::function<void()>& f) {
    f();   // warm caches and page tables
    std::vector<double> runs;
    for (int k = 0; k < 7; k++) {
        long long reps = 1; double el = 0;
        for (;;) {
            auto t0 = clk::now();
            for (long long r = 0; r < reps; r++) f();
            el = std::chrono::duration<double>(clk::now() - t0).count();
            if (el > 0.02) break;
            reps *= 2;
        }
        runs.push_back(el / (double)reps);
    }
    std::sort(runs.begin(), runs.end());
    return runs[runs.size() / 2];
}

int main(int argc, char** argv) {
    const bool avx2 = (si_get_cpu_features() & SI_FEAT_AVX2) != 0;
    const char* only = argc > 1 ? argv[1] : nullptr;
    const long long sizes[] = {4096, 65536, 4LL << 20, 64LL << 20};   // elements: 16 KB, 256 KB, 16 MB, 256 MB
    std::printf("avx2=%d\n%-8s %10s %10s %10s %10s   (GB/s, higher is better; bytes touched per call / time)\n",
                (int)avx2, "kernel", "elems", "portable", "sse2", "avx2");
    for (long long n : sizes) {
        std::vector<float> a((size_t)n), b((size_t)n), o((size_t)n);
        std::vector<int> ia((size_t)n);
        unsigned s = 7;
        for (long long i = 0; i < n; i++) { s = s * 1664525u + 1013904223u; a[i] = (float)(s % 1000) / 8.0f; b[i] = (float)((s >> 8) % 1000) / 8.0f; ia[i] = (int)s; }
        const unsigned long long* w = reinterpret_cast<const unsigned long long*>(ia.data());
        const size_t words = (size_t)n / 2;
        int mn, mx; SiStatsF32 st{0, 0, 10.0f, 0};
        auto row = [&](const char* name, double bytes, std::function<void()> p, std::function<void()> x, std::function<void()> y) {
            if (only && std::strcmp(only, name) != 0) return;
            double tp = seconds_per_call(p), tx = seconds_per_call(x), ty = avx2 ? seconds_per_call(y) : 0;
            std::printf("%-8s %10lld %10.2f %10.2f %10.2f\n", name, n, bytes / tp / 1e9, bytes / tx / 1e9, avx2 ? bytes / ty / 1e9 : 0.0);
        };
        const double fb = (double)n * 4;
        row("add",    fb * 3, [&] { port_add(a.data(), b.data(), o.data(), n); }, [&] { si_vec_add_f32_sse2(a.data(), b.data(), o.data(), n); }, [&] { si_vec_add_f32_avx2(a.data(), b.data(), o.data(), n); });
        row("dot",    fb * 2, [&] { g_sink = port_dot(a.data(), b.data(), n); }, [&] { g_sink = si_dot_f32_sse2(a.data(), b.data(), n); }, [&] { g_sink = si_dot_f32_avx2(a.data(), b.data(), n); });
        row("sum",    fb,     [&] { g_sink = (double)port_sum(ia.data(), n); }, [&] { g_sink = (double)si_sum_i32_sse2(ia.data(), n); }, [&] { g_sink = (double)si_sum_i32_avx2(ia.data(), n); });
        row("minmax", fb,     [&] { port_minmax(ia.data(), n, &mn, &mx); g_sink = mn + mx; }, [&] { si_minmax_i32_sse2(ia.data(), n, &mn, &mx); g_sink = mn + mx; }, [&] { si_minmax_i32_avx2(ia.data(), n, &mn, &mx); g_sink = mn + mx; });
        row("xor",    fb,     [&] { g_sink = (double)port_xor(w, words); }, [&] { g_sink = (double)si_xor_u64_sse2(w, words); }, [&] { g_sink = (double)si_xor_u64_avx2(w, words); });
        row("stats",  fb,     [&] { port_stats(a.data(), n, &st); g_sink = st.sum; }, [&] { si_stats_f32_sse2(a.data(), n, &st); g_sink = st.sum; }, [&] { si_stats_f32_avx2(a.data(), n, &st); g_sink = st.sum; });

        if (n <= (16LL << 20)) {   // series kernels work on doubles (8 bytes per element); skipped at the 512 MB size
            std::vector<double> da((size_t)n), db((size_t)n);
            for (long long i = 0; i < n; i++) { da[i] = (double)(i % 100); db[i] = (double)((i * 7) % 1000) / 3.0; }
            SiSeriesStats ss{}; SiSeriesRegress sr{};
            const double never = 1e9;   // a quiet series: the scans read all of it
            const double db8 = (double)n * 8;
            row("s_stats",   db8,     [&] { port_sstats(da.data(), n, &ss); g_sink = ss.sum; }, [&] { si_series_stats_f64_sse2(da.data(), n, &ss); g_sink = ss.sum; }, [&] { si_series_stats_f64_avx2(da.data(), n, &ss); g_sink = ss.sum; });
            row("s_regress", db8 * 2, [&] { port_sregress(da.data(), db.data(), n, &sr); g_sink = sr.sxy; }, [&] { si_series_regress_f64_sse2(da.data(), db.data(), n, &sr); g_sink = sr.sxy; }, [&] { si_series_regress_f64_avx2(da.data(), db.data(), n, &sr); g_sink = sr.sxy; });
            row("s_count",   db8,     [&] { g_sink = (double)port_scount(da.data(), n, &never); }, [&] { g_sink = (double)port_scount(da.data(), n, &never); }, [&] { g_sink = (double)si_series_count_ge_f64_avx2(da.data(), n, &never); });
            row("s_find",    db8,     [&] { g_sink = (double)port_sfind(da.data(), n, 0, &never); }, [&] { g_sink = (double)si_series_find_ge_f64_sse2(da.data(), n, 0, &never); }, [&] { g_sink = (double)si_series_find_ge_f64_avx2(da.data(), n, 0, &never); });
        }
    }
    return 0;
}
