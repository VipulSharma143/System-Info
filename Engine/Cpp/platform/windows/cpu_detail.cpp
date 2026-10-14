// cpu_detail.cpp (Windows) — what the CPU tab shows beyond the overlay engine's live samples.
//   Registry (CentralProcessor\0)  processor name, vendor, family/model/stepping
//   CallNtPowerInformation         base clock (loaded at run time from powrprof.dll)
//   GetLogicalProcessorInformationEx  cache hierarchy (topology and hybrid split come from si_get_cpu_logical_info)
//   NtQuerySystemInformation       where processor time went (user / kernel / DPC / interrupt), interrupts per second
//   PDH                            context switches, system calls, run queue, threads, processes, package power
//
// Windows has no built-in per-core or package temperature, a maximum boost clock, a frequency governor or thermal
// throttle counters, so those stay null with a reason. The headline CPU temperature is not read here: the overlay
// engine owns it.
#include "../../src/cpu_detail.h"
#include "../../src/internal.h"

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <pdh.h>
#include <pdhmsg.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <set>
#include <vector>

namespace si {
namespace {

using sclk = std::chrono::steady_clock;

std::string narrow(const wchar_t* w) {
    if (!w) return {};
    const int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    if (n <= 1) return {};
    std::string s((size_t)n - 1, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w, -1, &s[0], n, nullptr, nullptr);
    return s;
}

const wchar_t* const CPU_KEY = L"HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0";

bool regText(const wchar_t* name, std::string& out) {
    wchar_t buf[256];
    DWORD size = sizeof buf;
    if (RegGetValueW(HKEY_LOCAL_MACHINE, CPU_KEY, name, RRF_RT_REG_SZ, nullptr, buf, &size) != ERROR_SUCCESS) return false;
    out = cpuTrim(narrow(buf));
    return !out.empty();
}

bool regDword(const wchar_t* name, DWORD& out) {
    DWORD size = sizeof out;
    return RegGetValueW(HKEY_LOCAL_MACHINE, CPU_KEY, name, RRF_RT_REG_DWORD, nullptr, &out, &size) == ERROR_SUCCESS;
}

// PDH: one query, a few counters. A counter that cannot be added is simply absent (its value stays unknown).
class Pdh {
public:
    ~Pdh() { if (q) PdhCloseQuery(q); }
    bool open() { return PdhOpenQueryW(nullptr, 0, &q) == ERROR_SUCCESS; }
    PDH_HCOUNTER add(const wchar_t* path) {
        PDH_HCOUNTER h = nullptr;
        return PdhAddEnglishCounterW(q, path, 0, &h) == ERROR_SUCCESS ? h : nullptr;
    }
    bool collect() { const PDH_STATUS s = PdhCollectQueryData(q); return s == ERROR_SUCCESS || s == (PDH_STATUS)PDH_NO_DATA; }
    bool value(PDH_HCOUNTER h, double& out) {
        if (!h) return false;
        PDH_FMT_COUNTERVALUE v;
        if (PdhGetFormattedCounterValue(h, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, nullptr, &v) != ERROR_SUCCESS) return false;
        if (v.CStatus != PDH_CSTATUS_VALID_DATA && v.CStatus != PDH_CSTATUS_NEW_DATA) return false;
        out = v.doubleValue;
        return true;
    }
    bool array(PDH_HCOUNTER h, std::vector<std::pair<std::string, double>>& out) {
        out.clear();
        if (!h) return false;
        DWORD bytes = 0, count = 0;
        PDH_STATUS s = PdhGetFormattedCounterArrayW(h, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, &bytes, &count, nullptr);
        if (s != (PDH_STATUS)PDH_MORE_DATA || bytes == 0) return false;
        std::vector<unsigned char> buf(bytes);
        auto* items = reinterpret_cast<PDH_FMT_COUNTERVALUE_ITEM_W*>(buf.data());
        s = PdhGetFormattedCounterArrayW(h, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, &bytes, &count, items);
        if (s != ERROR_SUCCESS) return false;
        for (DWORD i = 0; i < count; i++) {
            if (items[i].FmtValue.CStatus != PDH_CSTATUS_VALID_DATA && items[i].FmtValue.CStatus != PDH_CSTATUS_NEW_DATA) continue;
            out.emplace_back(narrow(items[i].szName), items[i].FmtValue.doubleValue);
        }
        return true;
    }
private:
    PDH_HQUERY q = nullptr;
};

struct PowerInfo { ULONG number, maxMhz, currentMhz, mhzLimit, maxIdleState, currentIdleState; };   // PROCESSOR_POWER_INFORMATION

class WindowsCpuDetail : public CpuDetailSource {
    typedef LONG(NTAPI* NtQuery)(ULONG, PVOID, ULONG, PULONG);
    typedef LONG(WINAPI* CallPower)(int, PVOID, ULONG, PVOID, ULONG);
    struct PerfInfo { LARGE_INTEGER idle, kernel, user, dpc, interrupt; ULONG interruptCount; };
public:
    explicit WindowsCpuDetail(const std::string&) {
        if (HMODULE nt = GetModuleHandleW(L"ntdll.dll")) query = reinterpret_cast<NtQuery>(GetProcAddress(nt, "NtQuerySystemInformation"));
        if (pdh.open()) {
            ctxt = pdh.add(L"\\System\\Context Switches/sec");
            calls = pdh.add(L"\\System\\System Calls/sec");
            queue = pdh.add(L"\\System\\Processor Queue Length");
            threads = pdh.add(L"\\System\\Threads");
            procs = pdh.add(L"\\System\\Processes");
            power = pdh.add(L"\\Energy Meter(*)\\Power");
        }
    }

    void readInfo(CpuDetailInfo& out) override {
        std::string s;
        if (regText(L"ProcessorNameString", s)) out.model = s;
        if (regText(L"VendorIdentifier", s) && out.vendor.empty()) out.vendor = s;
        if (regText(L"Identifier", s)) {
            int f = -1, m = -1, st = -1;
            if (std::sscanf(s.c_str(), "%*s Family %d Model %d Stepping %d", &f, &m, &st) == 3) {
                if (out.family < 0) out.family = f;
                if (out.modelId < 0) out.modelId = m;
                if (out.stepping < 0) out.stepping = st;
            }
        }
        fillTopology(out);
        readCaches(out);
        readBase(out);
    }

    void readLive(CpuDetailLive& out) override {
        out.sensorNote = "Windows does not expose CPU temperatures without a hardware driver.";
        readTime(out);
        readCounters(out);
    }

private:
    NtQuery query = nullptr;
    Pdh pdh;
    bool primed = false;
    PDH_HCOUNTER ctxt = nullptr, calls = nullptr, queue = nullptr, threads = nullptr, procs = nullptr, power = nullptr;

    // ---------------------------------------------------------------- caches
    void readCaches(CpuDetailInfo& out) {
        DWORD length = 0;
        GetLogicalProcessorInformationEx(RelationCache, nullptr, &length);
        if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || length == 0) return;
        std::vector<char> buffer(length);
        if (!GetLogicalProcessorInformationEx(RelationCache, reinterpret_cast<PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(buffer.data()), &length)) return;

        struct Acc { long long total = 0, minSize = -1, maxSize = -1; int instances = 0; };
        std::map<std::pair<int, int>, Acc> acc;        // (level, type)
        for (DWORD offset = 0; offset < length;) {
            auto* info = reinterpret_cast<PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(buffer.data() + offset);
            if (info->Size == 0) break;
            if (info->Relationship == RelationCache) {
                const int type = (int)info->Cache.Type;
                if (info->Cache.Level > 0 && info->Cache.CacheSize > 0 && type >= 0 && type <= 2) {   // unified, instruction, data (not trace)
                    Acc& a = acc[{(int)info->Cache.Level, type}];
                    const long long size = (long long)info->Cache.CacheSize;
                    a.total += size; a.instances++;
                    a.minSize = a.minSize < 0 ? size : std::min(a.minSize, size);
                    a.maxSize = std::max(a.maxSize, size);
                }
            }
            offset += info->Size;
        }
        // Data first, then instruction, then unified — the order the Linux source uses.
        auto rank = [](int type) { return type == 2 ? 0 : type == 1 ? 1 : 2; };
        std::vector<std::pair<std::pair<int, int>, Acc>> list(acc.begin(), acc.end());
        std::sort(list.begin(), list.end(), [&](const auto& a, const auto& b) {
            return a.first.first != b.first.first ? a.first.first < b.first.first : rank(a.first.second) < rank(b.first.second);
        });
        for (const auto& kv : list) {
            CpuCache c;
            c.level = kv.first.first;
            c.type = kv.first.second == 2 ? "Data" : kv.first.second == 1 ? "Instruction" : "Unified";
            c.totalBytes = kv.second.total; c.instances = kv.second.instances;
            c.perInstanceBytes = kv.second.minSize == kv.second.maxSize ? kv.second.minSize : -1;
            out.caches.push_back(c);
        }
    }

    // ---------------------------------------------------------------- base clock
    void readBase(CpuDetailInfo& out) {
        // The nominal (base) frequency. Windows exposes no maximum boost clock, so maxMhz stays unknown here unless
        // CPUID leaf 0x16 supplied it.
        ULONG best = 0;
        if (HMODULE lib = LoadLibraryW(L"powrprof.dll")) {
            if (auto call = reinterpret_cast<CallPower>(GetProcAddress(lib, "CallNtPowerInformation"))) {
                const DWORD n = GetActiveProcessorCount(ALL_PROCESSOR_GROUPS);
                if (n > 0 && n <= 4096) {
                    std::vector<PowerInfo> info(n);
                    if (call(11 /*ProcessorInformation*/, nullptr, 0, info.data(), (ULONG)(n * sizeof(PowerInfo))) == 0)
                        for (const auto& p : info) best = std::max(best, p.maxMhz);
                }
            }
            FreeLibrary(lib);
        }
        if (best > 0) { out.baseMhz = (double)best; out.baseSource = "windows-power"; return; }
        DWORD mhz = 0;
        if (regDword(L"~MHz", mhz) && mhz > 0) { out.baseMhz = (double)mhz; out.baseSource = "registry"; }
    }

    // ---------------------------------------------------------------- processor time
    struct Times { double user = 0, system = 0, idle = 0, irq = 0, total = 0; ULONG interrupts = 0; bool valid = false; sclk::time_point at; };
    Times prev;

    void readTime(CpuDetailLive& out) {
        if (!query) return;
        std::vector<PerfInfo> info(256);
        ULONG got = 0;
        if (query(8 /*SystemProcessorPerformanceInformation*/, info.data(), (ULONG)(info.size() * sizeof(PerfInfo)), &got) != 0) return;
        info.resize(got / sizeof(PerfInfo));
        Times t; t.at = sclk::now();
        double kernel = 0, dpc = 0, intr = 0;
        for (const auto& p : info) {
            t.idle += (double)p.idle.QuadPart; kernel += (double)p.kernel.QuadPart; t.user += (double)p.user.QuadPart;
            dpc += (double)p.dpc.QuadPart; intr += (double)p.interrupt.QuadPart;
            t.interrupts += p.interruptCount;                                   // wraps by design; differences stay correct
        }
        t.irq = dpc + intr;
        t.system = kernel - t.idle - t.irq;                                     // kernel time includes idle, DPC and interrupt time
        if (t.system < 0) t.system = 0;
        t.total = kernel + t.user;
        t.valid = !info.empty() && t.total > 0;
        if (t.valid && prev.valid) {
            const double dTotal = t.total - prev.total;
            const double dt = std::chrono::duration<double>(t.at - prev.at).count();
            if (dTotal > 0) {
                out.userPct = (t.user - prev.user) * 100.0 / dTotal;
                out.systemPct = (t.system - prev.system) * 100.0 / dTotal;
                out.idlePct = (t.idle - prev.idle) * 100.0 / dTotal;
                out.irqPct = (t.irq - prev.irq) * 100.0 / dTotal;
            }
            if (dt >= 0.1) out.interruptsPerSec = (double)(ULONG)(t.interrupts - prev.interrupts) / dt;
        }
        if (t.valid) prev = t;
    }

    // ---------------------------------------------------------------- counters
    void readCounters(CpuDetailLive& out) {
        if (!pdh.collect()) { out.powerNote = "Windows performance counters could not be read."; return; }
        if (!primed) { primed = true; return; }          // rate counters need two samples; the first only sets a baseline
        double v = 0;
        if (pdh.value(ctxt, v)) out.contextSwitchesPerSec = v;
        if (pdh.value(calls, v)) out.systemCallsPerSec = v;
        if (pdh.value(queue, v)) out.queueLength = v;
        if (pdh.value(threads, v)) out.threads = v;
        if (pdh.value(procs, v)) out.processes = v;

        // "Energy Meter" is present only where the platform's energy interface is (Intel RAPL on recent Windows).
        // The Power counter is in milliwatts; anything outside a plausible range is dropped, not shown.
        std::vector<std::pair<std::string, double>> items;
        if (power && pdh.array(power, items)) {
            for (const auto& kv : items) {
                if (kv.first.find("PKG") == std::string::npos) continue;
                const double watts = kv.second / 1000.0;
                if (watts > 0 && watts < 1000) { out.packageWatts = watts; out.powerSource = "windows-energy-meter"; break; }
            }
        }
        if (!cpuKnown(out.packageWatts)) out.powerNote = "Windows does not report CPU package power on this computer.";
    }
};

}  // namespace

std::unique_ptr<CpuDetailSource> makeCpuDetailSource(const std::string& root) { return std::make_unique<WindowsCpuDetail>(root); }

}  // namespace si
