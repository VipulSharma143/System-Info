// cpu_detail.cpp — the CPU tab's native side: processor identity from CPUID, topology folded from the per-logical
// processor query, and ONE JSON document (stable facts + live sensors/policy/activity) published through
// si_cpu_detail_json().
//
// What this file deliberately does not do: per-processor load, clocks and the headline CPU temperature. Those are
// sampled once by the overlay engine and the backend merges them in, so the CPU tab and the Overlay tab always show
// the same numbers. Every number that cannot be read is null in the JSON — never 0.
#include "../include/native_engine.h"
#include "cpu_detail.h"
#include "internal.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <map>
#include <mutex>
#include <set>

#if defined(__x86_64__) || defined(__i386__) || defined(_M_X64) || defined(_M_IX86)
#define SI_X86 1
#if defined(_MSC_VER)
#include <intrin.h>
#else
#include <cpuid.h>
#endif
#endif

namespace si {

std::string cpuTrim(std::string s) {
    while (!s.empty() && (s.back() == '\n' || s.back() == '\r' || s.back() == ' ' || s.back() == '\t' || s.back() == '\0')) s.pop_back();
    size_t i = 0;
    while (i < s.size() && (s[i] == ' ' || s[i] == '\t')) i++;
    return s.substr(i);
}

// ---------------------------------------------------------------------------------------------------- CPUID
#ifdef SI_X86
namespace {

struct Regs { unsigned a = 0, b = 0, c = 0, d = 0; };

Regs cpuid(unsigned leaf, unsigned sub = 0) {
    Regs r;
#if defined(_MSC_VER)
    int x[4]; __cpuidex(x, (int)leaf, (int)sub);
    r.a = (unsigned)x[0]; r.b = (unsigned)x[1]; r.c = (unsigned)x[2]; r.d = (unsigned)x[3];
#else
    __cpuid_count(leaf, sub, r.a, r.b, r.c, r.d);
#endif
    return r;
}

unsigned long long xcr0() {
#if defined(_MSC_VER)
    return _xgetbv(0);
#else
    unsigned lo, hi;
    __asm__ volatile("xgetbv" : "=a"(lo), "=d"(hi) : "c"(0));
    return ((unsigned long long)hi << 32) | lo;
#endif
}

std::string fourChars(unsigned v) { return std::string((const char*)&v, 4); }

}  // namespace

void fillFromCpuid(CpuDetailInfo& info) {
    const Regs l0 = cpuid(0);
    const unsigned maxLeaf = l0.a;
    info.vendor = cpuTrim(fourChars(l0.b) + fourChars(l0.d) + fourChars(l0.c));
#if defined(__x86_64__) || defined(_M_X64)
    info.architecture = "x86-64";
#else
    info.architecture = "x86";
#endif
    if (maxLeaf < 1) return;

    const Regs l1 = cpuid(1);
    unsigned family = (l1.a >> 8) & 0xF, model = (l1.a >> 4) & 0xF;
    if (family == 0xF) family += (l1.a >> 20) & 0xFF;
    if ((((l1.a >> 8) & 0xF) == 0x6) || (((l1.a >> 8) & 0xF) == 0xF)) model |= ((l1.a >> 16) & 0xF) << 4;
    info.family = (int)family; info.modelId = (int)model; info.stepping = (int)(l1.a & 0xF);
    info.hypervisor = (l1.c >> 31) & 1 ? 1 : 0;

    // Marketing name (leaves 0x80000002-4); the OS name wins where the platform has one.
    const Regs ext = cpuid(0x80000000u);
    if (ext.a >= 0x80000004u) {
        std::string brand;
        for (unsigned leaf = 0x80000002u; leaf <= 0x80000004u; leaf++) {
            const Regs r = cpuid(leaf);
            brand += fourChars(r.a) + fourChars(r.b) + fourChars(r.c) + fourChars(r.d);
        }
        info.model = cpuTrim(brand.substr(0, brand.find('\0')));
    }

    // Instruction sets. AVX-family bits only count when the OS has enabled the matching register state.
    const bool osxsave = (l1.c >> 27) & 1;
    const unsigned long long x = osxsave ? xcr0() : 0;
    const bool ymm = (x & 0x6) == 0x6, zmm = (x & 0xE6) == 0xE6;
    Regs l7; if (maxLeaf >= 7) l7 = cpuid(7, 0);
    auto add = [&](bool on, const char* name) { if (on) info.features.push_back(name); };
    add((l1.d >> 25) & 1, "SSE");
    add((l1.d >> 26) & 1, "SSE2");
    add((l1.c >> 0) & 1, "SSE3");
    add((l1.c >> 9) & 1, "SSSE3");
    add((l1.c >> 19) & 1, "SSE4.1");
    add((l1.c >> 20) & 1, "SSE4.2");
    add(((l1.c >> 28) & 1) && ymm, "AVX");
    add(((l7.b >> 5) & 1) && ymm, "AVX2");
    add(((l1.c >> 12) & 1) && ymm, "FMA3");
    add(((l1.c >> 29) & 1) && ymm, "F16C");
    add(((l7.b >> 16) & 1) && zmm, "AVX-512");
    add(((l7.c >> 11) & 1) && zmm, "AVX-512 VNNI");
    add((l7.b >> 3) & 1, "BMI1");
    add((l7.b >> 8) & 1, "BMI2");
    add((l1.c >> 23) & 1, "POPCNT");
    add((l1.c >> 25) & 1, "AES-NI");
    add((l7.b >> 29) & 1, "SHA");
    add((l1.c >> 30) & 1, "RDRAND");
    add((l7.b >> 18) & 1, "RDSEED");
    add((l7.b >> 19) & 1, "ADX");
    const bool vmx = (l1.c >> 5) & 1;
    bool svm = false;
    if (ext.a >= 0x80000001u) svm = (cpuid(0x80000001u).c >> 2) & 1;
    add(vmx, "VT-x");
    add(svm, "AMD-V");

    // Intel reports base / maximum clock in leaf 0x16 (not under a hypervisor, where it describes the host or nothing).
    if (maxLeaf >= 0x16 && info.hypervisor == 0) {
        const Regs l16 = cpuid(0x16);
        if ((l16.a & 0xFFFF) > 0) { info.baseMhz = (double)(l16.a & 0xFFFF); info.baseSource = "cpuid"; }
        if ((l16.b & 0xFFFF) > 0) { info.maxMhz = (double)(l16.b & 0xFFFF); info.maxSource = "cpuid"; }
    }
}
#else
void fillFromCpuid(CpuDetailInfo& info) {
#if defined(__aarch64__) || defined(_M_ARM64)
    info.architecture = "ARM64";
#elif defined(__arm__) || defined(_M_ARM)
    info.architecture = "ARM";
#endif
}
#endif

// ---------------------------------------------------------------------------------------------------- topology
void fillTopology(CpuDetailInfo& info) {
    info.logical.clear();
    for (int i = 0; i < 4096; i++) {
        int coreId = -1, cls = -1, count = -1;
        if (si_get_cpu_logical_info(i, &coreId, &cls, &count) != 1) break;
        CpuLogical l;
        l.coreKey = coreId;
        if (cls >= 0 && count >= 2) l.kind = cls == count - 1 ? 2 : (cls == 0 && count >= 3 ? 0 : 1);
        info.logical.push_back(l);
    }

    int physical = -1, logical = -1, packages = -1;
    si_get_cpu_topology(&physical, &logical, &packages);
    info.packages = packages;
    info.logicalProcessors = info.logical.empty() ? logical : (int)info.logical.size();

    std::set<int> keys;
    bool allKnown = !info.logical.empty();
    for (const auto& l : info.logical) { if (l.coreKey < 0) allKnown = false; else keys.insert(l.coreKey); }
    info.physicalCores = allKnown ? (int)keys.size() : physical;

    // Hybrid split, counted in physical cores (a P-core with Hyper-Threading is one core, two threads).
    bool hybrid = false;
    for (const auto& l : info.logical) if (l.kind >= 0) hybrid = true;
    if (hybrid && allKnown) {
        std::map<int, int> kindOf;
        for (const auto& l : info.logical) kindOf.emplace(l.coreKey, l.kind);
        int n[3] = {0, 0, 0};
        for (const auto& kv : kindOf) if (kv.second >= 0 && kv.second <= 2) n[kv.second]++;
        info.lowPowerCores = n[0] > 0 ? n[0] : -1;                          // a class this CPU does not have is unknown, not "0 of them"
        info.efficiencyCores = n[1]; info.performanceCores = n[2];
    }
}

// ---------------------------------------------------------------------------------------------------- JSON
namespace {

class Json {
public:
    std::string s;
    void key(const char* k) { comma(); str(k); s += ':'; need = false; }
    void open(char c) { comma(); s += c; need = false; }
    void close(char c) { s += c; need = true; }
    void num(double v, int dec = 1) {
        comma(); need = true;
        if (!cpuKnown(v)) { s += "null"; return; }
        char b[48]; std::snprintf(b, sizeof b, "%.*f", dec, v); s += b;
    }
    void integer(long long v) { comma(); need = true; if (v < 0) s += "null"; else s += std::to_string(v); }
    void i64(long long v) { comma(); need = true; s += std::to_string(v); }
    void boolean(bool v) { comma(); need = true; s += v ? "true" : "false"; }
    void text(const std::string& v) { comma(); need = true; if (v.empty()) s += "null"; else str(v); }
    void nul() { comma(); need = true; s += "null"; }
private:
    bool need = false;
    void comma() { if (need) s += ','; }
    void str(const std::string& v) {
        s += '"';
        for (unsigned char c : v) {
            if (c == '"') s += "\\\"";
            else if (c == '\\') s += "\\\\";
            else if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); s += b; }
            else s += (char)c;
        }
        s += '"';
    }
};

const char* kindName(int k) { return k == 2 ? "performance" : k == 1 ? "efficiency" : k == 0 ? "low-power" : nullptr; }

long long epochMs() { return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count(); }

std::string build(const CpuDetailInfo& in, const CpuDetailLive& lv) {
    Json j;
    j.open('{');
    j.key("schema"); j.i64(1);
    j.key("sampledAtMs"); j.i64(epochMs());
#ifdef _WIN32
    j.key("platform"); j.text("windows");
#else
    j.key("platform"); j.text("linux");
#endif

    j.key("identity"); j.open('{');
    j.key("model"); j.text(in.model);
    j.key("vendor"); j.text(in.vendor);
    j.key("architecture"); j.text(in.architecture);
    j.key("family"); j.integer(in.family);
    j.key("modelId"); j.integer(in.modelId);
    j.key("stepping"); j.integer(in.stepping);
    j.key("virtualized"); if (in.hypervisor < 0) j.nul(); else j.boolean(in.hypervisor == 1);
    j.close('}');

    j.key("topology"); j.open('{');
    j.key("packages"); j.integer(in.packages);
    j.key("physicalCores"); j.integer(in.physicalCores);
    j.key("logicalProcessors"); j.integer(in.logicalProcessors);
    j.key("performanceCores"); j.integer(in.performanceCores);
    j.key("efficiencyCores"); j.integer(in.efficiencyCores);
    j.key("lowPowerCores"); j.integer(in.lowPowerCores);
    j.close('}');

    j.key("logical"); j.open('[');
    for (const auto& l : in.logical) {
        j.open('{');
        j.key("coreKey"); j.integer(l.coreKey);
        j.key("kind"); const char* k = kindName(l.kind); if (k) j.text(k); else j.nul();
        j.close('}');
    }
    j.close(']');

    j.key("frequency"); j.open('{');
    j.key("baseMhz"); j.num(in.baseMhz, 0);
    j.key("baseSource"); j.text(in.baseSource);
    j.key("maxMhz"); j.num(in.maxMhz, 0);
    j.key("maxSource"); j.text(in.maxSource);
    j.key("minMhz"); j.num(in.minMhz, 0);
    j.key("policyMaxMhz"); j.num(lv.policyMaxMhz, 0);
    j.key("governor"); j.text(lv.governor);
    j.key("driver"); j.text(lv.driver);
    j.key("preference"); j.text(lv.preference);
    j.key("boost"); if (lv.boost < 0) j.nul(); else j.boolean(lv.boost == 1);
    j.close('}');

    j.key("caches"); j.open('[');
    for (const auto& c : in.caches) {
        j.open('{');
        j.key("level"); j.i64(c.level);
        j.key("type"); j.text(c.type);
        j.key("totalBytes"); j.integer(c.totalBytes);
        j.key("instances"); j.i64(c.instances);
        j.key("perInstanceBytes"); j.integer(c.perInstanceBytes);
        j.close('}');
    }
    j.close(']');

    j.key("features"); j.open('[');
    for (const auto& f : in.features) j.text(f);
    j.close(']');

    j.key("sensors"); j.open('[');
    for (const auto& s : lv.sensors) {
        j.open('{');
        j.key("label"); j.text(s.label);
        j.key("kind"); j.text(s.kind);
        j.key("coreKey"); j.integer(s.coreKey);
        j.key("tempC"); j.num(s.tempC);
        j.key("highC"); j.num(s.highC);
        j.key("criticalC"); j.num(s.critC);
        j.close('}');
    }
    j.close(']');
    j.key("sensorsNote"); j.text(lv.sensorNote);

    j.key("power"); j.open('{');
    j.key("packageWatts"); j.num(lv.packageWatts);
    j.key("limit1Watts"); j.num(lv.limit1Watts);
    j.key("limit2Watts"); j.num(lv.limit2Watts);
    j.key("source"); j.text(lv.powerSource);
    j.key("note"); j.text(lv.powerNote);
    j.close('}');

    j.key("throttle"); j.open('{');
    j.key("packageEvents"); j.integer(lv.packageThrottle);
    j.key("coreEvents"); j.integer(lv.coreThrottle);
    j.close('}');

    j.key("time"); j.open('{');
    j.key("userPercent"); j.num(lv.userPct);
    j.key("systemPercent"); j.num(lv.systemPct);
    j.key("idlePercent"); j.num(lv.idlePct);
    j.key("iowaitPercent"); j.num(lv.iowaitPct);
    j.key("irqPercent"); j.num(lv.irqPct);
    j.key("stealPercent"); j.num(lv.stealPct);
    j.close('}');

    j.key("system"); j.open('{');
    j.key("load1"); j.num(lv.load1, 2);
    j.key("load5"); j.num(lv.load5, 2);
    j.key("load15"); j.num(lv.load15, 2);
    j.key("runnableTasks"); j.num(lv.runnable, 0);
    j.key("queueLength"); j.num(lv.queueLength, 0);
    j.key("threads"); j.num(lv.threads, 0);
    j.key("processes"); j.num(lv.processes, 0);
    j.key("contextSwitchesPerSec"); j.num(lv.contextSwitchesPerSec, 0);
    j.key("interruptsPerSec"); j.num(lv.interruptsPerSec, 0);
    j.key("systemCallsPerSec"); j.num(lv.systemCallsPerSec, 0);
    j.close('}');

    j.close('}');
    return std::move(j.s);
}

// One source for the life of the process (rates need the previous sample). Calls closer together than MIN_GAP_MS
// reuse the last document, so a second reader cannot shrink the interval a rate is computed over.
class Engine {
public:
    void setRoot(const std::string& root) {
        std::lock_guard<std::mutex> g(m);
        this->root = root; src.reset(); json.clear(); infoRead = false;
    }
    int snapshot(char* buf, int cap) {
        std::lock_guard<std::mutex> g(m);
        const auto now = std::chrono::steady_clock::now();
        if (json.empty() || now - last >= std::chrono::milliseconds(MIN_GAP_MS)) {
            if (!src) src = makeCpuDetailSource(root);
            if (!src) return 0;
            if (!infoRead) {
                info = CpuDetailInfo();
                fillFromCpuid(info);
                src->readInfo(info);
                infoRead = true;
            }
            CpuDetailLive live;
            src->readLive(live);
            json = build(info, live);
            last = now;
        }
        const int n = (int)json.size();
        if (!buf || cap < n + 1) return -(n + 1);
        std::memcpy(buf, json.data(), (size_t)n);
        buf[n] = 0;
        return n;
    }
private:
    static constexpr int MIN_GAP_MS = 300;
    std::mutex m;
    std::string root, json;
    std::unique_ptr<CpuDetailSource> src;
    CpuDetailInfo info;
    bool infoRead = false;
    std::chrono::steady_clock::time_point last;
};

Engine& engine() { static Engine e; return e; }

}  // namespace
}  // namespace si

// Exports. Nothing may throw across the C boundary.
extern "C" {
int si_cpu_detail_json(char* buffer, int capacity) {
    try { return si::engine().snapshot(buffer, capacity); } catch (...) { return 0; }
}
void si_cpu_detail_set_root(const char* root) {
    try { si::engine().setRoot(root ? root : ""); } catch (...) {}
}
}
