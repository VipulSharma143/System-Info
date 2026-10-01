// simd_dispatch.cpp — CPU feature detection and runtime dispatch for the
// Assembly kernels in assembly/vector_kernels.asm.
//
// Dispatch order: AVX2 -> SSE2 (x86-64 baseline; always available).
// AVX2 is only selected when CPUID reports it AND the OS has enabled YMM
// state (OSXSAVE + XCR0 bits 1..2). Checking CPUID alone is not enough:
// a CPU can support AVX2 while the OS/hypervisor masks it, and executing
// a VEX instruction then faults.
#include "../include/native_engine.h"
#include <algorithm>
#include <cstdint>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

#if defined(_MSC_VER)
#include <intrin.h>
static void cpuid_(int leaf, int sub, unsigned r[4]) { int t[4]; __cpuidex(t, leaf, sub); for (int i = 0; i < 4; i++) r[i] = (unsigned)t[i]; }
static unsigned long long xgetbv0() { return _xgetbv(0); }
#else
#include <cpuid.h>
static void cpuid_(int leaf, int sub, unsigned r[4]) { __cpuid_count(leaf, sub, r[0], r[1], r[2], r[3]); }
static unsigned long long xgetbv0() { unsigned lo, hi; __asm__ volatile("xgetbv" : "=a"(lo), "=d"(hi) : "c"(0)); return ((unsigned long long)hi << 32) | lo; }
#endif

// Assembly entry points (System V or Windows x64 ABI, selected at assemble time).
extern "C" {
void  si_vec_add_f32_sse2(const float*, const float*, float*, size_t);
void  si_vec_add_f32_avx2(const float*, const float*, float*, size_t);
float si_dot_f32_sse2(const float*, const float*, size_t);
float si_dot_f32_avx2(const float*, const float*, size_t);
long long si_sum_i32_sse2(const int*, size_t);
long long si_sum_i32_avx2(const int*, size_t);
void si_minmax_i32_sse2(const int*, size_t, int*, int*);
void si_minmax_i32_avx2(const int*, size_t, int*, int*);
void si_memcpy_sse2(void*, const void*, size_t);
void si_memcpy_avx2(void*, const void*, size_t);
unsigned long long si_xor_u64_sse2(const unsigned long long*, size_t);
unsigned long long si_xor_u64_avx2(const unsigned long long*, size_t);
}

namespace {
struct Features { long long mask = 0; char vendor[13] = {0}; };

Features detect() {
    Features f;
    unsigned r[4];
    cpuid_(0, 0, r);
    unsigned maxLeaf = r[0];
    std::memcpy(f.vendor + 0, &r[1], 4);
    std::memcpy(f.vendor + 4, &r[3], 4);
    std::memcpy(f.vendor + 8, &r[2], 4);
    if (maxLeaf < 1) return f;
    cpuid_(1, 0, r);
    unsigned ecx = r[2], edx = r[3];
    auto set = [&](bool c, long long bit) { if (c) f.mask |= bit; };
    set(edx & (1u << 25), SI_FEAT_SSE);
    set(edx & (1u << 26), SI_FEAT_SSE2);
    set(ecx & (1u << 0),  SI_FEAT_SSE3);
    set(ecx & (1u << 9),  SI_FEAT_SSSE3);
    set(ecx & (1u << 19), SI_FEAT_SSE41);
    set(ecx & (1u << 20), SI_FEAT_SSE42);
    bool osxsave = ecx & (1u << 27);
    bool ymmOk = false;
    if (osxsave) ymmOk = (xgetbv0() & 0x6) == 0x6;
    bool avx = (ecx & (1u << 28)) && ymmOk;
    set(avx, SI_FEAT_AVX);
    set(avx && (ecx & (1u << 12)), SI_FEAT_FMA);
    if (maxLeaf >= 7) {
        cpuid_(7, 0, r);
        set(avx && (r[1] & (1u << 5)), SI_FEAT_AVX2);
    }
    return f;
}
const Features& features() { static const Features f = detect(); return f; }
bool useAvx2() { return (features().mask & SI_FEAT_AVX2) != 0; }
}

// ---- reference implementations (also used for verification) ----
static unsigned long long ref_xor(const unsigned long long* a, size_t n) { unsigned long long x = 0; for (size_t i = 0; i < n; i++) x ^= a[i]; return x; }
static void ref_add(const float* a, const float* b, float* o, size_t n) { for (size_t i = 0; i < n; i++) o[i] = a[i] + b[i]; }
static double ref_dot(const float* a, const float* b, size_t n) { double s = 0; for (size_t i = 0; i < n; i++) s += (double)a[i] * b[i]; return s; }
static long long ref_sum(const int* a, size_t n) { long long s = 0; for (size_t i = 0; i < n; i++) s += a[i]; return s; }

extern "C" {

long long si_get_cpu_features() { return features().mask; }

int si_get_cpu_vendor(char* out, int size) {
    if (!out || size <= 0) return 0;
    std::strncpy(out, features().vendor, (size_t)size - 1);
    out[size - 1] = '\0';
    return (int)std::strlen(out);
}

int si_active_isa() { return useAvx2() ? 2 : 1; }   // 2 = AVX2, 1 = SSE2

void si_vec_add_f32(const float* a, const float* b, float* out, long long n) {
    if (n <= 0 || !a || !b || !out) return;
    useAvx2() ? si_vec_add_f32_avx2(a, b, out, (size_t)n) : si_vec_add_f32_sse2(a, b, out, (size_t)n);
}
float si_dot_f32(const float* a, const float* b, long long n) {
    if (n <= 0 || !a || !b) return 0.0f;
    return useAvx2() ? si_dot_f32_avx2(a, b, (size_t)n) : si_dot_f32_sse2(a, b, (size_t)n);
}
long long si_sum_i32(const int* a, long long n) {
    if (n <= 0 || !a) return 0;
    return useAvx2() ? si_sum_i32_avx2(a, (size_t)n) : si_sum_i32_sse2(a, (size_t)n);
}

long long si_minmax_i32(const int* a, long long n, int* minOut, int* maxOut) {
    if (n <= 0 || !a || !minOut || !maxOut) return 0;
    useAvx2() ? si_minmax_i32_avx2(a, (size_t)n, minOut, maxOut) : si_minmax_i32_sse2(a, (size_t)n, minOut, maxOut);
    return 1;
}

// memcpy with defined behaviour for every input: overlapping regions (which the
// assembly kernels do not support) fall back to memmove; bad arguments return 0.
int si_memcpy(void* dst, const void* src, long long n) {
    if (n < 0 || (n > 0 && (!dst || !src))) return 0;
    if (n == 0) return 1;
    auto d = reinterpret_cast<uintptr_t>(dst), s = reinterpret_cast<uintptr_t>(src);
    if (d == s) return 1;
    if (d < s + (uintptr_t)n && s < d + (uintptr_t)n) { std::memmove(dst, src, (size_t)n); return 1; }
    useAvx2() ? si_memcpy_avx2(dst, src, (size_t)n) : si_memcpy_sse2(dst, src, (size_t)n);
    return 1;
}

unsigned long long si_xor_u64(const unsigned long long* a, long long nwords) {
    if (nwords <= 0 || !a) return 0;
    return useAvx2() ? si_xor_u64_avx2(a, (size_t)nwords) : si_xor_u64_sse2(a, (size_t)nwords);
}

// Verifies every kernel that this CPU can run against the C++ reference,
// across boundary lengths and deliberately misaligned pointers.
// Returns 0 on success; otherwise a bitmask: 1=add, 2=dot, 4=sum, 16=minmax,
// 32=memcpy, 64=xor checksum (bit 8 set additionally if the AVX2 path failed).
int si_kernel_selftest() {
    const size_t lens[] = {0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 33, 1000, 4099};
    const size_t maxN = 4099 + 8;
    std::vector<float> fa(maxN + 4), fb(maxN + 4), fo(maxN + 4), fr(maxN + 4);
    std::vector<int> ia(maxN + 4);
    uint32_t s = 12345;
    auto rnd = [&]() { s = s * 1664525u + 1013904223u; return s; };
    for (size_t i = 0; i < fa.size(); i++) {
        fa[i] = (float)((int)(rnd() % 2001) - 1000) / 8.0f;
        fb[i] = (float)((int)(rnd() % 2001) - 1000) / 8.0f;
        ia[i] = (int)rnd();   // full int32 range: exercises sign extension and 64-bit accumulation
    }
    int fail = 0;
    for (int isa = 1; isa <= (useAvx2() ? 2 : 1); isa++) {
        for (size_t off = 0; off < 4; off++) {          // off != 0 -> unaligned pointers
            for (size_t n : lens) {
                const float* a = fa.data() + off; const float* b = fb.data() + off;
                int* ip = ia.data() + off;
                ref_add(a, b, fr.data(), n);
                std::fill(fo.begin(), fo.end(), -1.0f);
                if (isa == 2) si_vec_add_f32_avx2(a, b, fo.data() + off, n); else si_vec_add_f32_sse2(a, b, fo.data() + off, n);
                for (size_t i = 0; i < n; i++) if (fo[off + i] != fr[i]) { fail |= 1 | (isa == 2 ? 8 : 0); break; }
                // guard: element after the end must be untouched
                if (fo[off + n] != -1.0f) fail |= 1 | (isa == 2 ? 8 : 0);

                double rd = ref_dot(a, b, n);
                float gd = isa == 2 ? si_dot_f32_avx2(a, b, n) : si_dot_f32_sse2(a, b, n);
                if (std::fabs((double)gd - rd) > 1e-3 * (1.0 + std::fabs(rd))) fail |= 2 | (isa == 2 ? 8 : 0);

                long long rs = ref_sum(ip, n);
                long long gs = isa == 2 ? si_sum_i32_avx2(ip, n) : si_sum_i32_sse2(ip, n);
                if (gs != rs) fail |= 4 | (isa == 2 ? 8 : 0);

                if (n > 0) {
                    int rmin = ip[0], rmax = ip[0];
                    for (size_t i = 1; i < n; i++) { rmin = std::min(rmin, ip[i]); rmax = std::max(rmax, ip[i]); }
                    int gmin = 0x5a5a5a5a, gmax = 0x5a5a5a5a;
                    if (isa == 2) si_minmax_i32_avx2(ip, n, &gmin, &gmax); else si_minmax_i32_sse2(ip, n, &gmin, &gmax);
                    if (gmin != rmin || gmax != rmax) fail |= 16 | (isa == 2 ? 8 : 0);
                } else {   // n == 0 must not touch the outputs or read the input
                    int gmin = 111, gmax = 222;
                    if (isa == 2) si_minmax_i32_avx2(ip, 0, &gmin, &gmax); else si_minmax_i32_sse2(ip, 0, &gmin, &gmax);
                    if (gmin != 111 || gmax != 222) fail |= 16 | (isa == 2 ? 8 : 0);
                }

                // memcpy: guard bytes before and after the destination must survive.
                {
                    const size_t bytes = n * 3 + off;                   // odd byte counts, all tail lengths
                    std::vector<unsigned char> src(bytes + 1), dst(bytes + 64, 0xCD), want(bytes + 64, 0xCD);
                    for (size_t i = 0; i < src.size(); i++) src[i] = (unsigned char)(i * 131 + 7);
                    std::memcpy(want.data() + 16, src.data(), bytes);
                    if (isa == 2) si_memcpy_avx2(dst.data() + 16, src.data(), bytes); else si_memcpy_sse2(dst.data() + 16, src.data(), bytes);
                    if (dst != want) fail |= 32 | (isa == 2 ? 8 : 0);
                }

                // xor checksum over 64-bit words (misaligned start via byte offset)
                {
                    const unsigned long long* w = reinterpret_cast<const unsigned long long*>(reinterpret_cast<const unsigned char*>(ia.data()) + off);
                    size_t words = std::min(n, (maxN * 4 - off) / 8);
                    unsigned long long g = isa == 2 ? si_xor_u64_avx2(w, words) : si_xor_u64_sse2(w, words);
                    if (g != ref_xor(w, words)) fail |= 64 | (isa == 2 ? 8 : 0);
                }
            }
        }
    }
    return fail;
}

// Throughput of each kernel in GB/s (bytes read+written / seconds) so the UI
// or CLI can show the real effect of the dispatch. Returns 1 on success.
int si_kernel_benchmark(long long elements, int repeats, double* addGBps, double* dotGBps, double* sumGBps) {
    if (elements < 16 || repeats < 1 || elements > (1LL << 28)) return 0;
    std::vector<float> a((size_t)elements, 1.5f), b((size_t)elements, 2.0f), o((size_t)elements);
    std::vector<int> ia((size_t)elements, 3);
    using clk = std::chrono::steady_clock;
    volatile float sinkF = 0; volatile long long sinkL = 0;
    auto t0 = clk::now();
    for (int r = 0; r < repeats; r++) si_vec_add_f32(a.data(), b.data(), o.data(), elements);
    auto t1 = clk::now();
    for (int r = 0; r < repeats; r++) sinkF = si_dot_f32(a.data(), b.data(), elements);
    auto t2 = clk::now();
    for (int r = 0; r < repeats; r++) sinkL = si_sum_i32(ia.data(), elements);
    auto t3 = clk::now();
    (void)sinkF; (void)sinkL;
    auto secs = [](clk::time_point x, clk::time_point y) { return std::chrono::duration<double>(y - x).count(); };
    double n = (double)elements * repeats;
    if (addGBps) *addGBps = secs(t0, t1) > 0 ? n * 12.0 / secs(t0, t1) / 1e9 : 0.0;
    if (dotGBps) *dotGBps = secs(t1, t2) > 0 ? n * 8.0 / secs(t1, t2) / 1e9 : 0.0;
    if (sumGBps) *sumGBps = secs(t2, t3) > 0 ? n * 4.0 / secs(t2, t3) / 1e9 : 0.0;
    return 1;
}

// Sustained memory throughput using the Assembly kernels. Buffers default to
// well beyond typical L3 so the figures reflect DRAM, not cache. copyGBps
// counts bytes moved once (src read + dst write are not double counted, the
// convention most bandwidth tools use); readGBps is a pure streaming read.
int si_memory_bandwidth(long long bytes, int repeats, double* copyGBps, double* readGBps) {
    if (bytes < 4096 || bytes > (1LL << 31) || repeats < 1) return 0;
    const size_t words = (size_t)bytes / 8;
    std::vector<unsigned long long> a, b;
    try { a.assign(words, 0x0123456789abcdefULL); b.assign(words, 0); }
    catch (...) { return 0; }                       // not enough memory: report, don't crash
    using clk = std::chrono::steady_clock;
    volatile unsigned long long sink = 0;
    si_memcpy(b.data(), a.data(), (long long)(words * 8));      // warm-up: page in both buffers
    auto t0 = clk::now();
    for (int r = 0; r < repeats; r++) si_memcpy(b.data(), a.data(), (long long)(words * 8));
    auto t1 = clk::now();
    for (int r = 0; r < repeats; r++) sink = si_xor_u64(a.data(), (long long)words);
    auto t2 = clk::now();
    (void)sink;
    auto secs = [](clk::time_point x, clk::time_point y) { return std::chrono::duration<double>(y - x).count(); };
    double moved = (double)words * 8.0 * repeats;
    if (copyGBps) *copyGBps = secs(t0, t1) > 0 ? moved / secs(t0, t1) / 1e9 : 0.0;
    if (readGBps) *readGBps = secs(t1, t2) > 0 ? moved / secs(t1, t2) / 1e9 : 0.0;
    return 1;
}

} // extern "C"
