// overlay_engine.cpp — the live-monitor engine.
//
// One background thread samples CPU, every GPU and RAM on a fixed cadence and publishes ONE coherent snapshot (JSON)
// together with a short history ring per series. The backend only copies the latest snapshot out, so a slow
// operating-system API can delay the next sample but can never make a request wait or mix numbers from different
// moments. Each number says where it came from; a number that cannot be measured is null, never 0.
#include "../../include/native_engine.h"
#include "overlay_platform.h"
#include <atomic>
#include <chrono>
#include <algorithm>
#include <condition_variable>
#include <cstring>
#include <cstdio>
#include <deque>
#include <map>
#include <mutex>
#include <thread>

namespace si {
namespace {

using sclk = std::chrono::steady_clock;
long long steadyMs() { return std::chrono::duration_cast<std::chrono::milliseconds>(sclk::now().time_since_epoch()).count(); }
long long epochMs() { return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count(); }

constexpr size_t HISTORY = 120;

struct Ring {
    std::deque<float> v;
    void push(double x) { v.push_back(known(x) ? (float)x : std::numeric_limits<float>::quiet_NaN()); if (v.size() > HISTORY) v.pop_front(); }
};

class Json {
public:
    std::string s;
    void key(const char* k) { comma(); str(k); s += ':'; need = false; }
    void open(char c) { comma(); s += c; need = false; }
    void close(char c) { s += c; need = true; }
    void num(double v, int dec = 1) {
        comma(); need = true;
        if (!known(v)) { s += "null"; return; }
        char b[48]; std::snprintf(b, sizeof b, "%.*f", dec, v); s += b;
    }
    void i64(long long v) { comma(); need = true; s += std::to_string(v); }
    void text(const std::string& v, bool nullIfEmpty = false) { comma(); need = true; if (nullIfEmpty && v.empty()) s += "null"; else str(v); }
    void series(const std::deque<float>& v, int dec = 1) {
        open('[');
        for (float x : v) num((double)x, dec);
        close(']');
    }
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

double percent(double used, double total) { return known(used) && known(total) && total > 0 ? std::fmin(100.0, used * 100.0 / total) : NA; }

class Engine {
public:
    bool start(int intervalMs, const std::string& root) {
        std::lock_guard<std::mutex> g(life);
        if (running) return true;
        cpu = makeCpuSource(root);
        gpu = makeGpuSource(root);
        interval = intervalMs;
        seq = 0; json.clear(); cpuHist = Ring(); ramHist = Ring(); gpuHist.clear();
        lastRequest = steadyMs();
        stopFlag = false;
        running = true;
        if (intervalMs > 0) worker = std::thread([this] { loop(); });
        return true;
    }
    void stop() {
        std::lock_guard<std::mutex> g(life);
        if (!running) return;
        { std::lock_guard<std::mutex> l(wake); stopFlag = true; }
        cv.notify_all();
        if (worker.joinable()) worker.join();
        cpu.reset(); gpu.reset();
        running = false;
    }
    int sampleNow() { if (!running) return 0; cycle(); return 1; }
    int snapshot(char* buf, int cap) {
        lastRequest = steadyMs();
        std::lock_guard<std::mutex> l(data);
        if (json.empty()) return 0;
        int n = (int)json.size();
        if (!buf || cap < n + 1) return -(n + 1);
        std::memcpy(buf, json.data(), (size_t)n); buf[n] = 0;
        return n;
    }
private:
    std::mutex life, wake, data;
    std::condition_variable cv;
    std::thread worker;
    bool running = false, stopFlag = false;
    int interval = 500;
    std::atomic<long long> lastRequest{0};
    std::unique_ptr<CpuSource> cpu;
    std::unique_ptr<GpuSource> gpu;
    unsigned long long seq = 0;
    std::string json;
    Ring cpuHist, cpuTempHist, ramHist;
    struct GpuHist { Ring usage, temp, mem; };
    std::map<std::string, GpuHist> gpuHist;

    void loop() {
        while (true) {
            auto t0 = sclk::now();
            cycle();
            // Nobody has asked for a snapshot for a while (the tab is closed or the window hidden): keep a slow
            // heartbeat so counters keep a baseline, but stop costing CPU.
            bool watched = steadyMs() - lastRequest < 6000;
            auto period = std::chrono::milliseconds(watched ? interval : std::max(interval, 2000));
            std::unique_lock<std::mutex> l(wake);
            if (cv.wait_until(l, t0 + period, [this] { return stopFlag; })) return;
        }
    }

    void cycle() {
        auto t0 = sclk::now();
        CpuSample c; c.core.clear();
        if (cpu) cpu->sample(c);
        std::vector<GpuSample> g;
        if (gpu) { gpu->adapters(); gpu->sample(g); }
        long long total = -1, avail = -1, freeB = -1, cached = -1, buffers = -1, swapT = -1, swapU = -1, cl = -1, cu = -1;
        bool ramOk = si_get_memory_info(&total, &avail, &freeB, &cached, &buffers, &swapT, &swapU, &cl, &cu) == 1;
        double cycleMs = std::chrono::duration<double, std::milli>(sclk::now() - t0).count();

        std::lock_guard<std::mutex> l(data);
        seq++;
        build(c, g, ramOk, total, avail, freeB, cached, buffers, swapT, swapU, cycleMs);
    }

    void build(const CpuSample& c, const std::vector<GpuSample>& g, bool ramOk, long long total, long long avail, long long freeB,
               long long cached, long long buffers, long long swapT, long long swapU, double cycleMs) {
        // Core statistics come from the assembly kernel (AVX2 / SSE2 / portable, whichever the CPU and the self-test allow).
        double sum = 0, mx = 0; long long active = 0;
        bool haveCores = !c.core.empty() && si_stats_f32(c.core.data(), (long long)c.core.size(), 10.0f, &sum, &mx, &active) == 1;
        double usage = c.usage;
        if (!known(usage) && haveCores) usage = sum / (double)c.core.size();

        double ramUsed = ramOk && total > 0 && avail >= 0 ? (double)(total - avail) : NA;
        double ramPct = percent(ramUsed, ramOk ? (double)total : NA);

        cpuHist.push(usage); cpuTempHist.push(c.tempC); ramHist.push(ramPct);

        auto& gi = gpu->adapters();
        std::map<std::string, GpuHist> keep;
        for (size_t i = 0; i < gi.size() && i < g.size(); i++) {
            GpuHist h = gpuHist.count(gi[i].id) ? gpuHist[gi[i].id] : GpuHist();
            h.usage.push(g[i].util); h.temp.push(g[i].temp); h.mem.push(percent(g[i].memUsed, g[i].memTotal));
            keep[gi[i].id] = h;
        }
        gpuHist.swap(keep);

        SourceStatus st = gpu ? gpu->status() : SourceStatus();
        Json j;
        j.open('{');
        j.key("schema"); j.i64(1);
        j.key("seq"); j.i64((long long)seq);
        j.key("sampledAtMs"); j.i64(epochMs());
        j.key("intervalMs"); j.i64(interval);
#ifdef _WIN32
        j.key("platform"); j.text("windows");
#else
        j.key("platform"); j.text("linux");
#endif
        j.key("engine"); j.open('{');
        j.key("isa"); j.i64(si_active_isa());
        j.key("asmDemotions"); j.i64(si_asm_demotions());
        j.key("cycleMs"); j.num(cycleMs, 1);
        j.key("nvml"); j.text(st.nvml.empty() ? "ok" : st.nvml);
        j.key("gpuCounters"); j.text(st.counters.empty() ? "ok" : st.counters);
        j.close('}');

        j.key("cpu"); j.open('{');
        j.key("usagePercent"); j.num(usage);
        j.key("temperatureC"); j.num(c.tempC);
        j.key("temperatureSource"); j.text(c.tempSource, true);
        j.key("temperatureNote"); j.text(c.tempNote, true);
        j.key("clockMhz"); j.num(c.clockMhz, 0);
        j.key("logicalProcessors"); j.i64((long long)c.core.size());
        j.key("busiestCorePercent"); j.num(haveCores ? mx : NA);
        j.key("activeCores"); j.num(haveCores ? (double)active : NA, 0);
        j.key("cores"); j.open('[');
        for (size_t i = 0; i < c.core.size(); i++) {
            j.open('{'); j.key("u"); j.num(c.core[i]); j.key("mhz"); j.num(i < c.coreMhz.size() ? c.coreMhz[i] : NA, 0); j.close('}');
        }
        j.close(']');
        j.key("note"); j.text(c.note, true);
        j.close('}');

        j.key("ram"); j.open('{');
        j.key("totalBytes"); j.num(ramOk ? (double)total : NA, 0);
        j.key("usedBytes"); j.num(ramUsed, 0);
        j.key("availableBytes"); j.num(ramOk && avail >= 0 ? (double)avail : NA, 0);
        j.key("usedPercent"); j.num(ramPct);
        j.key("cachedBytes"); j.num(cached >= 0 ? (double)cached : NA, 0);
        j.key("swapTotalBytes"); j.num(swapT >= 0 ? (double)swapT : NA, 0);
        j.key("swapUsedBytes"); j.num(swapU >= 0 ? (double)swapU : NA, 0);
        j.close('}');

        j.key("gpus"); j.open('[');
        for (size_t i = 0; i < gi.size() && i < g.size(); i++) {
            const GpuInfo& a = gi[i]; const GpuSample& s = g[i];
            j.open('{');
            j.key("id"); j.text(a.id);
            j.key("name"); j.text(a.name);
            j.key("luid"); j.text(a.luid ? [&] { char b[24]; std::snprintf(b, sizeof b, "%llx", (unsigned long long)a.luid); return std::string(b); }() : "", true);
            j.key("vendor"); j.text(a.vendor, true);
            j.key("kind"); j.text(a.kind, true);
            j.key("pciAddress"); j.text(a.pci, true);
            j.key("vendorId"); j.text(a.vendorId ? [&] { char b[12]; std::snprintf(b, sizeof b, "0x%04x", a.vendorId); return std::string(b); }() : "", true);
            j.key("deviceId"); j.text(a.deviceId ? [&] { char b[12]; std::snprintf(b, sizeof b, "0x%04x", a.deviceId); return std::string(b); }() : "", true);
            j.key("driverVersion"); j.text(a.driverVersion, true);
            j.key("dedicatedBytes"); j.num(a.dedicatedBytes >= 0 ? (double)a.dedicatedBytes : NA, 0);
            j.key("sharedBytes"); j.num(a.sharedBytes >= 0 ? (double)a.sharedBytes : NA, 0);
            j.key("utilizationPercent"); j.num(s.util);
            j.key("temperatureC"); j.num(s.temp);
            j.key("memoryUsedBytes"); j.num(s.memUsed, 0);
            j.key("memoryTotalBytes"); j.num(s.memTotal, 0);
            j.key("memoryPercent"); j.num(percent(s.memUsed, s.memTotal));
            j.key("sharedUsedBytes"); j.num(s.sharedUsed, 0);
            j.key("powerWatts"); j.num(s.power);
            j.key("powerLimitWatts"); j.num(s.powerLimit);
            j.key("coreClockMhz"); j.num(s.coreMhz, 0);
            j.key("memoryClockMhz"); j.num(s.memMhz, 0);
            j.key("fanPercent"); j.num(s.fanPercent, 0);
            j.key("performanceState"); j.text(s.pstate, true);
            j.key("engines"); j.open('[');
            for (size_t k = 0; k < s.engines.size() && k < 6; k++) { j.open('{'); j.key("name"); j.text(s.engines[k].first); j.key("percent"); j.num(s.engines[k].second); j.close('}'); }
            j.close(']');
            j.key("source"); j.open('{');
            j.key("utilization"); j.text(s.utilSource, true);
            j.key("temperature"); j.text(s.tempSource, true);
            j.key("memory"); j.text(s.memSource, true);
            j.close('}');
            j.key("note"); j.text(s.note, true);
            j.close('}');
        }
        j.close(']');

        j.key("history"); j.open('{');
        j.key("intervalMs"); j.i64(interval);
        j.key("cpu"); j.series(cpuHist.v);
        j.key("cpuTemp"); j.series(cpuTempHist.v);
        j.key("ram"); j.series(ramHist.v);
        j.key("gpus"); j.open('{');
        for (auto& kv : gpuHist) {
            j.key(kv.first.c_str()); j.open('{');
            j.key("usage"); j.series(kv.second.usage.v);
            j.key("temp"); j.series(kv.second.temp.v);
            j.key("memory"); j.series(kv.second.mem.v);
            j.close('}');
        }
        j.close('}');
        j.close('}');
        j.close('}');
        json = std::move(j.s);
    }
};

Engine& engine() { static Engine e; return e; }
}  // namespace
}  // namespace si

extern "C" {
int si_overlay_start(int intervalMs, const char* root) { return si::engine().start(intervalMs, root ? root : "") ? 1 : 0; }
void si_overlay_stop() { si::engine().stop(); }
int si_overlay_sample_now() { return si::engine().sampleNow(); }
int si_overlay_snapshot_json(char* buffer, int capacity) { return si::engine().snapshot(buffer, capacity); }
}
