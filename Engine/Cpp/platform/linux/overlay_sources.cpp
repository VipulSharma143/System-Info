// overlay_sources.cpp (Linux) — CPU and GPU readings for the overlay engine.
//   CPU: /proc/stat per logical processor, cpufreq clocks, the CPU's own temperature sensor.
//   GPU: NVIDIA through NVML; AMD through amdgpu sysfs + hwmon; Intel through i915/xe sysfs (no load counter exists
//        without elevated access, and the card says so instead of showing 0).
// `root` is "" in production; tests point it at a fake tree containing proc/ and sys/.
#include "../../include/native_engine.h"
#include "../../src/overlay/nvml.h"
#include "../../src/overlay/overlay_platform.h"
#include "sysfs.h"
#include <cstdio>
#include <cstring>
#include <fstream>
#include <map>
#include <sstream>

namespace si {
namespace {

std::string trim(std::string s) {
    while (!s.empty() && (s.back() == '\n' || s.back() == '\r' || s.back() == ' ' || s.back() == '\t')) s.pop_back();
    size_t i = 0; while (i < s.size() && (s[i] == ' ' || s[i] == '\t')) i++;
    return s.substr(i);
}
bool readNum(const std::string& path, double& out) { long long v; if (!read_int(path, v)) return false; out = (double)v; return true; }

// ---------------------------------------------------------------- CPU
class LinuxCpu : public CpuSource {
public:
    explicit LinuxCpu(std::string r) : root(std::move(r)) {}
    void sample(CpuSample& out) override {
        std::map<int, Ticks> now;
        Ticks all{};
        readStat(now, all);
        if (all.total > 0 && prevAll.total > 0 && all.total > prevAll.total) out.usage = busy(prevAll, all);
        const bool baseline = !prev.empty();              // the first sample only takes a baseline: load is unknown, not 0
        for (auto& kv : now) {
            if (!baseline) break;
            auto p = prev.find(kv.first);
            out.core.push_back(p != prev.end() && kv.second.total > p->second.total ? (float)busy(p->second, kv.second) : 0.0f);
            double mhz = NA;
            double khz;
            if (readNum(root + "/sys/devices/system/cpu/cpu" + std::to_string(kv.first) + "/cpufreq/scaling_cur_freq", khz) && khz > 0) mhz = khz / 1000.0;
            out.coreMhz.push_back((float)mhz);
        }
        double sum = 0; int n = 0;
        for (float m : out.coreMhz) if (known(m)) { sum += m; n++; }
        if (n) out.clockMhz = sum / n;
        prev = now; prevAll = all;

        double c = NA; char src[64] = {0}; int rc;
        if (root.empty()) rc = si_cpu_temperature(&c, src, sizeof src);
        else rc = si_cpu_temperature_at((root + "/sys").c_str(), &c, src, sizeof src);
        if (rc == 1) { out.tempC = c; out.tempSource = src; }
        else out.tempNote = "This computer exposes no CPU temperature sensor (common in virtual machines).";
        if (out.core.empty() && baseline) out.note = "Per-processor load could not be read.";
    }
private:
    struct Ticks { double total = 0, idle = 0; };
    std::string root;
    std::map<int, Ticks> prev;
    Ticks prevAll;
    static double busy(const Ticks& a, const Ticks& b) {
        double dt = b.total - a.total, di = b.idle - a.idle;
        double v = dt > 0 ? (1.0 - di / dt) * 100.0 : 0.0;
        return v < 0 ? 0 : v > 100 ? 100 : v;
    }
    void readStat(std::map<int, Ticks>& cores, Ticks& all) {
        std::ifstream f(root + "/proc/stat");
        std::string line;
        while (std::getline(f, line)) {
            if (line.compare(0, 3, "cpu") != 0) break;
            std::istringstream in(line);
            std::string tag; double v[8] = {0};
            in >> tag;
            for (double& x : v) if (!(in >> x)) x = 0;
            Ticks t; for (double x : v) t.total += x;
            t.idle = v[3] + v[4];                       // idle + iowait
            if (tag == "cpu") all = t;
            else cores[std::atoi(tag.c_str() + 3)] = t;
        }
    }
};

// ---------------------------------------------------------------- GPU
std::string pciName(uint32_t vendor, uint32_t device) {
    static const char* files[] = {"/usr/share/hwdata/pci.ids", "/usr/share/misc/pci.ids", "/usr/share/pci.ids"};
    char v[8], d[8]; std::snprintf(v, sizeof v, "%04x", vendor); std::snprintf(d, sizeof d, "%04x", device);
    for (const char* path : files) {
        std::ifstream f(path);
        if (!f) continue;
        std::string line; bool inVendor = false;
        while (std::getline(f, line)) {
            if (line.empty() || line[0] == '#') continue;
            if (line[0] != '\t') { if (inVendor) return {}; inVendor = line.compare(0, 4, v) == 0; continue; }
            if (inVendor && line.size() > 6 && line[1] != '\t' && line.compare(1, 4, d) == 0) {
                std::string n = trim(line.substr(5));
                size_t a = n.find('['), b = n.rfind(']');
                return a != std::string::npos && b != std::string::npos && b > a ? n.substr(a + 1, b - a - 1) : n;
            }
        }
    }
    return {};
}

struct Card {
    GpuInfo info;
    std::string dir;              // <root>/sys/class/drm/cardN/device
    int nvmlIndex = -1;
};

class LinuxGpu : public GpuSource {
public:
    explicit LinuxGpu(std::string r) : root(std::move(r)) { discover(); }
    const std::vector<GpuInfo>& adapters() override { return infos; }
    SourceStatus status() const override {
        SourceStatus s;
        s.nvml = anyNvidia ? const_cast<Nvml&>(nvml).problem() : "";
        s.counters = "";
        return s;
    }
    void sample(std::vector<GpuSample>& out) override {
        out.assign(cards.size(), GpuSample());
        for (size_t i = 0; i < cards.size(); i++) {
            Card& c = cards[i]; GpuSample& s = out[i];
            if (c.info.vendorId == 0x10de) nvidia(c, s); else if (c.info.vendorId == 0x1002) amd(c, s); else if (c.info.vendorId == 0x8086) intel(c, s);
            else s.note = "No live readings are available for this graphics adapter.";
        }
    }
private:
    std::string root;
    Nvml nvml;
    bool anyNvidia = false;
    std::vector<Card> cards;
    std::vector<GpuInfo> infos;

    static std::string hwmon(const std::string& dev) {
        auto dirs = sorted_children(dev + "/hwmon");
        return dirs.empty() ? std::string() : dirs.front();
    }

    void discover() {
        std::string base = root + "/sys/class/drm";
        int ordinal[65536] = {0};
        for (const auto& path : sorted_children(base)) {
            std::string name = fs::path(path).filename().string();
            if (name.size() < 5 || name.compare(0, 4, "card") != 0 || name.find('-') != std::string::npos) continue;
            std::string dev = path + "/device";
            std::string vs = read_line(dev + "/vendor"), ds = read_line(dev + "/device");
            if (vs.empty() || ds.empty()) continue;
            Card c; c.dir = dev;
            c.info.vendorId = (uint32_t)std::strtoul(vs.c_str(), nullptr, 16);
            c.info.deviceId = (uint32_t)std::strtoul(ds.c_str(), nullptr, 16);
            std::ifstream ue(dev + "/uevent"); std::string l;
            while (std::getline(ue, l)) if (l.compare(0, 14, "PCI_SLOT_NAME=") == 0) c.info.pci = Nvml::normalizePci(l.substr(14));
            c.info.vendor = c.info.vendorId == 0x10de ? "NVIDIA" : c.info.vendorId == 0x1002 ? "AMD" : c.info.vendorId == 0x8086 ? "Intel" : "";
            char id[48]; std::snprintf(id, sizeof id, "gpu-%04x%04x-%d", c.info.vendorId, c.info.deviceId, ordinal[c.info.vendorId & 0xFFFF]++);
            c.info.id = id;
            c.info.name = pciName(c.info.vendorId, c.info.deviceId);
            if (c.info.name.empty()) c.info.name = (c.info.vendor.empty() ? std::string("Graphics adapter") : c.info.vendor + " graphics");
            else if (c.info.vendor == "AMD" && c.info.name.find("Radeon") == std::string::npos) c.info.name = "AMD " + c.info.name;

            double vram = NA, gtt = NA;
            readNum(dev + "/mem_info_vram_total", vram); readNum(dev + "/mem_info_gtt_total", gtt);
            if (known(vram)) c.info.dedicatedBytes = (long long)vram;
            if (known(gtt)) c.info.sharedBytes = (long long)gtt;
            if (c.info.vendorId == 0x10de) c.info.kind = "discrete";
            else if (c.info.vendorId == 0x1002) c.info.kind = known(vram) ? (vram >= 3.0 * 1024 * 1024 * 1024 ? "discrete" : "integrated") : "";
            else if (c.info.vendorId == 0x8086) c.info.kind = fs::exists(dev + "/lmem_total_bytes") ? "discrete" : "integrated";

            if (c.info.vendorId == 0x10de) anyNvidia = true;
            cards.push_back(c);
        }
        if (anyNvidia) {
            const auto& nd = nvml.devices();
            std::vector<bool> taken(nd.size(), false);
            for (auto& c : cards) {                           // by PCI address first, then by order
                if (c.info.vendorId != 0x10de) continue;
                for (size_t d = 0; d < nd.size() && c.nvmlIndex < 0; d++) if (!taken[d] && !c.info.pci.empty() && nd[d].pci == c.info.pci) { c.nvmlIndex = (int)d; taken[d] = true; }
            }
            for (auto& c : cards) {
                if (c.info.vendorId != 0x10de || c.nvmlIndex >= 0) continue;
                for (size_t d = 0; d < nd.size(); d++) if (!taken[d]) { c.nvmlIndex = (int)d; taken[d] = true; break; }
            }
            for (auto& c : cards) if (c.nvmlIndex >= 0) {
                c.info.name = nd[(size_t)c.nvmlIndex].name;
                c.info.driverVersion = nvml.driverVersion();
                if (known(nd[(size_t)c.nvmlIndex].memTotal)) c.info.dedicatedBytes = (long long)nd[(size_t)c.nvmlIndex].memTotal;
            }
        }
        for (auto& c : cards) infos.push_back(c.info);
    }

    void nvidia(Card& c, GpuSample& s) {
        NvmlReading r;
        if (c.nvmlIndex >= 0 && nvml.read((size_t)c.nvmlIndex, r)) {
            s.util = r.util; s.temp = r.temp; s.memUsed = r.memUsed; s.memTotal = r.memTotal; s.power = r.power; s.powerLimit = r.powerLimit;
            s.fanPercent = r.fan; s.coreMhz = r.coreMhz; s.memMhz = r.memMhz; s.pstate = r.pstate;
            s.utilSource = known(r.util) ? "nvml" : ""; s.tempSource = known(r.temp) ? "nvml" : ""; s.memSource = known(r.memUsed) ? "nvml" : "";
            if (!known(r.temp)) s.note = "NVIDIA driver gave no temperature: " + nvml.problem();
            return;
        }
        // No NVML: the open-source driver may still expose a temperature.
        std::string h = hwmon(c.dir);
        double t;
        if (!h.empty() && readNum(h + "/temp1_input", t) && t > 0) { s.temp = t / 1000.0; s.tempSource = "hwmon"; }
        std::string why = nvml.problem();
        s.note = "NVIDIA telemetry unavailable: " + (why.empty() ? std::string("the NVIDIA driver returned no sample") : why);
    }

    void amd(Card& c, GpuSample& s) {
        double v;
        if (readNum(c.dir + "/gpu_busy_percent", v)) { s.util = v; s.utilSource = "sysfs"; }
        else s.note = "This driver/kernel does not expose gpu_busy_percent.";
        double used, total, gused, gtotal;
        bool unified = c.info.kind == "integrated";
        if (readNum(c.dir + "/mem_info_vram_used", used) && readNum(c.dir + "/mem_info_vram_total", total)) {
            s.memUsed = used; s.memTotal = total; s.memSource = "sysfs";
            if (readNum(c.dir + "/mem_info_gtt_used", gused)) s.sharedUsed = gused;
            if (unified && readNum(c.dir + "/mem_info_gtt_total", gtotal)) { if (known(s.sharedUsed)) s.memUsed = used + s.sharedUsed; s.memTotal = total + gtotal; }
        }
        std::string h = hwmon(c.dir);
        if (!h.empty()) {
            if (readNum(h + "/temp1_input", v) && v > 0) { s.temp = v / 1000.0; s.tempSource = "hwmon"; }
            if (readNum(h + "/power1_average", v) || readNum(h + "/power1_input", v)) s.power = v / 1e6;
            if (readNum(h + "/power1_cap", v) && v > 0) s.powerLimit = v / 1e6;
            if (readNum(h + "/freq1_input", v) && v > 0) s.coreMhz = v / 1e6;
            if (readNum(h + "/freq2_input", v) && v > 0) s.memMhz = v / 1e6;
            double pwm, pmax;
            if (readNum(h + "/pwm1", pwm) && readNum(h + "/pwm1_max", pmax) && pmax > 0) s.fanPercent = pwm * 100.0 / pmax;
        }
    }

    void intel(Card& c, GpuSample& s) {
        double v;
        const std::string card = fs::path(c.dir).parent_path().string();
        if (readNum(card + "/gt_act_freq_mhz", v) || readNum(card + "/gt/gt0/rps_act_freq_mhz", v)) s.coreMhz = v;
        std::string h = hwmon(c.dir);
        if (!h.empty() && readNum(h + "/temp1_input", v) && v > 0) { s.temp = v / 1000.0; s.tempSource = "hwmon"; }
        s.note = "Intel graphics expose no load counter on Linux without elevated access.";
    }
};

}  // namespace

std::unique_ptr<CpuSource> makeCpuSource(const std::string& root) { return std::unique_ptr<CpuSource>(new LinuxCpu(root)); }
std::unique_ptr<GpuSource> makeGpuSource(const std::string& root) { return std::unique_ptr<GpuSource>(new LinuxGpu(root)); }

}  // namespace si
