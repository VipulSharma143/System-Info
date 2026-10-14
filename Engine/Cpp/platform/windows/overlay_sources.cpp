// overlay_sources.cpp (Windows) — CPU and GPU readings for the overlay engine.
//
//   CPU  : NtQuerySystemInformation(SystemProcessorPerformanceInformation) per logical processor; clocks from the
//          "Processor Information" counters (base frequency x % performance, as Task Manager computes it).
//   GPU  : adapters from DXGI (LUID, vendor, device, memory). NVIDIA load/temperature/clocks/power/VRAM from NVML.
//          Every other adapter (and the per-engine breakdown for all of them) from ONE PDH query over the
//          "GPU Engine" and "GPU Adapter Memory" counter sets — a wildcard query returns every instance in a single
//          call, which is how Task Manager reads them. Counters are matched to adapters by LUID, never by index.
//
// Windows exposes no CPU die temperature without a kernel driver, so CPU temperature stays unavailable (and says why).
#include "../../include/native_engine.h"
#include "../../src/overlay/nvml.h"
#include "../../src/overlay/overlay_platform.h"
#include <windows.h>
#include <dxgi.h>
#include <pdh.h>
#include <pdhmsg.h>
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <tuple>

namespace si {
namespace {

std::string narrow(const wchar_t* w) {
    if (!w) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    if (n <= 1) return {};
    std::string s((size_t)n - 1, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w, -1, &s[0], n, nullptr, nullptr);
    return s;
}
long long tickMs() { return (long long)GetTickCount64(); }

// One PDH query holding several wildcard counters.
class Pdh {
public:
    ~Pdh() { if (q) PdhCloseQuery(q); }
    bool open() { return PdhOpenQueryW(nullptr, 0, &q) == ERROR_SUCCESS; }
    PDH_HCOUNTER add(const wchar_t* path) {
        PDH_HCOUNTER h = nullptr;
        lastStatus = PdhAddEnglishCounterW(q, path, 0, &h);
        return lastStatus == ERROR_SUCCESS ? h : nullptr;
    }
    bool collect() { PDH_STATUS s = PdhCollectQueryData(q); return s == ERROR_SUCCESS || s == (PDH_STATUS)PDH_NO_DATA; }
    // Every instance of a wildcard counter; empty while PDH has no two samples to compute a rate from.
    bool read(PDH_HCOUNTER h, std::vector<std::pair<std::string, double>>& out) {
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
    PDH_STATUS lastStatus = 0;
private:
    PDH_HQUERY q = nullptr;
};

// ---------------------------------------------------------------- CPU
class WindowsCpu : public CpuSource {
    typedef LONG(NTAPI* NtQuery)(ULONG, PVOID, ULONG, PULONG);
    struct PerfInfo { LARGE_INTEGER idle, kernel, user, dpc, interrupt; ULONG interruptCount; };
public:
    explicit WindowsCpu(const std::string&) {
        if (HMODULE nt = GetModuleHandleW(L"ntdll.dll")) query = reinterpret_cast<NtQuery>(GetProcAddress(nt, "NtQuerySystemInformation"));
        if (pdh.open()) { freq = pdh.add(L"\\Processor Information(*)\\Processor Frequency"); perf = pdh.add(L"\\Processor Information(*)\\% Processor Performance"); }
    }
    void sample(CpuSample& out) override {
        out.tempNote = "Windows does not expose the CPU temperature without a hardware driver.";
        if (!query) { out.note = "Per-processor load is unavailable on this Windows build."; return; }
        std::vector<PerfInfo> info(256);
        ULONG got = 0;
        if (query(8 /*SystemProcessorPerformanceInformation*/, info.data(), (ULONG)(info.size() * sizeof(PerfInfo)), &got) != 0) { out.note = "Per-processor load could not be read."; return; }
        size_t n = got / sizeof(PerfInfo);
        info.resize(n);
        std::vector<Tick> now(n);
        double idleAll = 0, busyAll = 0;
        for (size_t i = 0; i < n; i++) { now[i] = {(double)info[i].idle.QuadPart, (double)(info[i].kernel.QuadPart + info[i].user.QuadPart)}; }
        if (prev.size() == n) {
            for (size_t i = 0; i < n; i++) {
                double dTotal = now[i].total - prev[i].total, dIdle = now[i].idle - prev[i].idle;
                double u = dTotal > 0 ? (1.0 - dIdle / dTotal) * 100.0 : 0.0;
                out.core.push_back((float)std::fmin(100.0, std::fmax(0.0, u)));
                idleAll += dIdle; busyAll += dTotal;
            }
            if (busyAll > 0) out.usage = std::fmin(100.0, std::fmax(0.0, (1.0 - idleAll / busyAll) * 100.0));
        }
        prev = now;
        clocks(out);
    }
private:
    struct Tick { double idle, total; };
    NtQuery query = nullptr;
    std::vector<Tick> prev;
    Pdh pdh; PDH_HCOUNTER freq = nullptr, perf = nullptr;
    bool primed = false;

    void clocks(CpuSample& out) {
        if (!freq || !perf || !pdh.collect()) return;
        std::vector<std::pair<std::string, double>> f, p;
        if (!primed) { primed = true; return; }
        if (!pdh.read(freq, f) || !pdh.read(perf, p)) return;
        std::map<std::string, double> base;
        for (auto& kv : f) base[kv.first] = kv.second;
        out.coreMhz.assign(out.core.size(), std::numeric_limits<float>::quiet_NaN());
        double sum = 0; int cnt = 0;
        for (auto& kv : p) {                               // instance "group,index"; group 0 maps onto our core order
            if (kv.first.find("_Total") != std::string::npos || kv.first.compare(0, 2, "0,") != 0) continue;
            size_t idx = (size_t)std::atoi(kv.first.c_str() + 2);
            auto b = base.find(kv.first);
            if (b == base.end() || idx >= out.coreMhz.size()) continue;
            double mhz = b->second * kv.second / 100.0;
            out.coreMhz[idx] = (float)mhz; sum += mhz; cnt++;
        }
        if (cnt) out.clockMhz = sum / cnt;
    }
};

// ---------------------------------------------------------------- GPU
struct ParsedEngine { long long luid; int index; std::string type; };

bool parseHex(const std::string& s, size_t pos, unsigned long& v, size_t& end) {
    char* e = nullptr;
    v = std::strtoul(s.c_str() + pos, &e, 16);
    end = (size_t)(e - s.c_str());
    return end > pos;
}
bool parseLuid(const std::string& name, long long& luid) {
    size_t p = name.find("luid_0x");
    if (p == std::string::npos) return false;
    unsigned long hi, lo; size_t e;
    if (!parseHex(name, p + 7, hi, e) || name.compare(e, 3, "_0x") != 0 || !parseHex(name, e + 3, lo, e)) return false;
    luid = (long long)(((unsigned long long)hi << 32) | lo);
    return true;
}
bool parseEngine(const std::string& name, ParsedEngine& out) {
    if (!parseLuid(name, out.luid)) return false;
    size_t e = name.find("_eng_"), t = name.find("_engtype_");
    if (e == std::string::npos || t == std::string::npos) return false;
    out.index = std::atoi(name.c_str() + e + 5);
    out.type = name.substr(t + 9);
    return !out.type.empty();
}

class WindowsGpu : public GpuSource {
public:
    explicit WindowsGpu(const std::string&) {
        if (pdh.open()) {
            engine = pdh.add(L"\\GPU Engine(*)\\Utilization Percentage");
            if (!engine) countersProblem = "Windows GPU load counters are not available (PDH " + hex(pdh.lastStatus) + ").";
            dedicated = pdh.add(L"\\GPU Adapter Memory(*)\\Dedicated Usage");
            shared = pdh.add(L"\\GPU Adapter Memory(*)\\Shared Usage");
        } else countersProblem = "Windows performance counters could not be opened.";
        refreshAdapters();
    }

    const std::vector<GpuInfo>& adapters() override {
        long long now = tickMs();
        if (now - lastEnum > 4000 || (needRefresh && now - lastEnum > 1000)) refreshAdapters();
        return infos;
    }
    SourceStatus status() const override {
        SourceStatus s;
        bool nvidia = false;
        for (auto& i : infos) if (i.vendorId == 0x10de) nvidia = true;
        if (nvidia) s.nvml = const_cast<Nvml&>(nvml).problem();
        s.counters = countersProblem;
        return s;
    }

    void sample(std::vector<GpuSample>& out) override {
        out.assign(infos.size(), GpuSample());

        // 1. one collection, then every instance of every counter
        std::map<long long, std::vector<std::pair<std::string, double>>> groups;      // luid -> (label, summed load)
        std::map<long long, double> dedUsed, shUsed;
        bool engineData = false;
        needRefresh = false;
        if (engine && pdh.collect()) {
            std::vector<std::pair<std::string, double>> e, d, s;
            if (pdh.read(engine, e)) {
                engineData = !e.empty();
                std::map<std::tuple<long long, int, std::string>, double> sums;
                for (auto& kv : e) { ParsedEngine pe; if (parseEngine(kv.first, pe)) sums[std::make_tuple(pe.luid, pe.index, pe.type)] += kv.second; }
                std::map<long long, std::map<std::string, int>> typeCount;
                for (auto& kv : sums) typeCount[std::get<0>(kv.first)][std::get<2>(kv.first)]++;
                for (auto& kv : sums) {
                    long long luid = std::get<0>(kv.first);
                    const std::string& type = std::get<2>(kv.first);
                    std::string label = typeCount[luid][type] > 1 ? type + " " + std::to_string(std::get<1>(kv.first)) : type;
                    groups[luid].emplace_back(label, std::fmin(100.0, kv.second));
                }
                for (auto& kv : groups) if (!luidKnown(kv.first)) needRefresh = true;   // a LUID we have no adapter for: re-enumerate
            }
            long long luid;
            if (pdh.read(dedicated, d)) for (auto& kv : d) if (parseLuid(kv.first, luid)) dedUsed[luid] = kv.second;
            if (pdh.read(shared, s)) for (auto& kv : s) if (parseLuid(kv.first, luid)) shUsed[luid] = kv.second;
        }

        // 2. per adapter
        for (size_t i = 0; i < infos.size(); i++) {
            const GpuInfo& a = infos[i]; GpuSample& s = out[i];
            auto g = groups.find(a.luid);
            if (g != groups.end()) {
                auto list = g->second;
                std::vector<float> values;
                for (auto& kv : list) values.push_back((float)kv.second);
                double sum = 0, mx = 0; long long active = 0;
                if (!values.empty() && si_stats_f32(values.data(), (long long)values.size(), 0.1f, &sum, &mx, &active) == 1) { s.util = mx; s.utilSource = "windows-counters"; }
                std::sort(list.begin(), list.end(), [](auto& x, auto& y) { return x.second > y.second; });
                for (auto& kv : list) if (kv.second > 0.1) s.engines.push_back(kv);
            } else if (engineData && a.luid != 0) {
                s.util = 0; s.utilSource = "windows-counters";     // counters work and nothing runs on this adapter
            } else if (!countersProblem.empty()) s.note = countersProblem;
            else s.note = "Windows has not produced a GPU load sample yet.";

            auto d = dedUsed.find(a.luid); auto sh = shUsed.find(a.luid);
            if (d != dedUsed.end()) {
                s.memSource = "windows-counters";
                if (a.kind == "integrated") {
                    s.memUsed = d->second + (sh != shUsed.end() ? sh->second : 0);
                    s.memTotal = (a.dedicatedBytes > 0 ? (double)a.dedicatedBytes : 0) + (a.sharedBytes > 0 ? (double)a.sharedBytes : 0);
                    if (s.memTotal <= 0) s.memTotal = NA;
                } else { s.memUsed = d->second; s.memTotal = a.dedicatedBytes > 0 ? (double)a.dedicatedBytes : NA; if (sh != shUsed.end()) s.sharedUsed = sh->second; }
            }

            // 3. NVIDIA: the driver's own numbers win (the same source nvidia-smi and vendor tools show)
            if (a.vendorId == 0x10de) {
                NvmlReading r;
                if (nvmlIndex[i] >= 0 && nvml.read((size_t)nvmlIndex[i], r)) {
                    if (known(r.util)) { s.util = r.util; s.utilSource = "nvml"; }
                    if (known(r.memUsed)) { s.memUsed = r.memUsed; s.memTotal = r.memTotal; s.memSource = "nvml"; }
                    s.temp = r.temp; s.tempSource = known(r.temp) ? "nvml" : "";
                    s.power = r.power; s.powerLimit = r.powerLimit; s.fanPercent = r.fan; s.coreMhz = r.coreMhz; s.memMhz = r.memMhz; s.pstate = r.pstate;
                    s.note = known(r.temp) ? "" : "NVIDIA driver gave no temperature: " + nvml.problem();
                } else {
                    std::string why = nvml.problem();
                    s.note = (known(s.util) ? "Load comes from Windows counters; NVIDIA temperature unavailable: " : "NVIDIA telemetry unavailable: ") + (why.empty() ? std::string("the NVIDIA driver returned no sample") : why);
                }
            }
        }
    }

private:
    Pdh pdh; PDH_HCOUNTER engine = nullptr, dedicated = nullptr, shared = nullptr;
    Nvml nvml;
    std::vector<GpuInfo> infos;
    std::vector<int> nvmlIndex;
    long long lastEnum = -100000;
    bool needRefresh = false;
    std::string countersProblem;

    static std::string hex(long v) { char b[16]; std::snprintf(b, sizeof b, "0x%08lX", (unsigned long)v); return b; }
    bool luidKnown(long long l) const { for (auto& i : infos) if (i.luid == l) return true; return false; }

    void refreshAdapters() {
        lastEnum = tickMs();
        IDXGIFactory1* f = nullptr;
        if (FAILED(CreateDXGIFactory1(__uuidof(IDXGIFactory1), reinterpret_cast<void**>(&f))) || !f) return;
        std::vector<GpuInfo> list;
        std::map<uint32_t, int> ordinal;
        for (UINT i = 0;; i++) {
            IDXGIAdapter1* ad = nullptr;
            if (f->EnumAdapters1(i, &ad) == DXGI_ERROR_NOT_FOUND) break;
            DXGI_ADAPTER_DESC1 d{};
            if (SUCCEEDED(ad->GetDesc1(&d)) && !(d.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) && d.VendorId != 0x1414) {
                GpuInfo g;
                g.vendorId = d.VendorId; g.deviceId = d.DeviceId;
                g.name = narrow(d.Description);
                g.vendor = d.VendorId == 0x10de ? "NVIDIA" : d.VendorId == 0x1002 ? "AMD" : d.VendorId == 0x8086 ? "Intel" : "";
                g.dedicatedBytes = d.DedicatedVideoMemory > 0 ? (long long)d.DedicatedVideoMemory : -1;
                g.sharedBytes = d.SharedSystemMemory > 0 ? (long long)d.SharedSystemMemory : -1;
                g.luid = ((long long)d.AdapterLuid.HighPart << 32) | (unsigned long long)d.AdapterLuid.LowPart;
                bool arc = g.name.find("Arc") != std::string::npos;
                if (d.VendorId == 0x10de) g.kind = "discrete";
                else if (d.VendorId == 0x8086) g.kind = arc ? "discrete" : "integrated";
                else if (d.VendorId == 0x1002) g.kind = g.dedicatedBytes >= 3LL * 1024 * 1024 * 1024 ? "discrete" : "integrated";
                // Stable across LUID changes (a hybrid laptop's discrete GPU gets a new LUID whenever it powers back up).
                char id[48]; std::snprintf(id, sizeof id, "gpu-%04x%04x-%d", d.VendorId, d.DeviceId, ordinal[(d.VendorId << 16) | d.DeviceId]++);
                g.id = id;
                list.push_back(g);
            }
            ad->Release();
        }
        f->Release();
        if (list.empty()) return;

        // NVML devices <-> NVIDIA adapters: by PCI device id, then by order.
        std::vector<int> mapping(list.size(), -1);
        bool anyNvidia = false;
        for (auto& g : list) if (g.vendorId == 0x10de) anyNvidia = true;
        if (anyNvidia) {
            const auto& nd = nvml.devices();
            std::vector<bool> taken(nd.size(), false);
            for (size_t i = 0; i < list.size(); i++) {
                if (list[i].vendorId != 0x10de) continue;
                for (size_t d = 0; d < nd.size(); d++) if (!taken[d] && nd[d].deviceId == list[i].deviceId) { mapping[i] = (int)d; taken[d] = true; break; }
            }
            for (size_t i = 0; i < list.size(); i++) {
                if (list[i].vendorId != 0x10de || mapping[i] >= 0) continue;
                for (size_t d = 0; d < nd.size(); d++) if (!taken[d]) { mapping[i] = (int)d; taken[d] = true; break; }
            }
            for (size_t i = 0; i < list.size(); i++) if (mapping[i] >= 0) { list[i].pci = nd[(size_t)mapping[i]].pci; list[i].driverVersion = nvml.driverVersion(); }
        }
        infos.swap(list);
        nvmlIndex.swap(mapping);
    }
};

}  // namespace

std::unique_ptr<CpuSource> makeCpuSource(const std::string& root) { return std::unique_ptr<CpuSource>(new WindowsCpu(root)); }
std::unique_ptr<GpuSource> makeGpuSource(const std::string& root) { return std::unique_ptr<GpuSource>(new WindowsGpu(root)); }

}  // namespace si
