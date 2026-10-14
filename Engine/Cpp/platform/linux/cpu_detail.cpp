// cpu_detail.cpp (Linux) — what the CPU tab shows beyond the overlay engine's live samples.
//   /proc/cpuinfo                 model, vendor, family/model/stepping, virtualization flag
//   /sys/devices/system/cpu       topology (through si_get_cpu_logical_info), caches, clock range, frequency policy,
//                                 thermal-throttle counters
//   /sys/class/hwmon              per-core / per-die temperatures with their limits (coretemp, k10temp, zenpower, ...)
//   /sys/class/powercap           package power (RAPL energy counter, computed from its delta) and power limits
//   /proc/stat, /proc/loadavg     where processor time went, scheduler counters, load average
// `root` is "" in production; tests point it at a directory holding a fake proc/ and sys/ tree.
// The headline CPU temperature is NOT read here: the overlay engine owns it (cpu_temperature.cpp). The sensor list is
// extra detail from the same kernel devices.
#include "../../src/cpu_detail.h"
#include "../../src/internal.h"
#include "sysfs.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <set>
#include <sstream>

namespace si {
namespace {

using sclk = std::chrono::steady_clock;

std::string first(const std::string& path) { return cpuTrim(read_line(path)); }

bool startsWith(const std::string& s, const char* p) { return s.rfind(p, 0) == 0; }

bool allDigits(const std::string& s) { return !s.empty() && std::all_of(s.begin(), s.end(), [](unsigned char c) { return c >= '0' && c <= '9'; }); }

// Kernel sizes read "32K", "30720K", "8M", or a plain number of bytes.
long long parseSize(const std::string& text) {
    if (text.empty()) return -1;
    char* end = nullptr;
    const long long v = std::strtoll(text.c_str(), &end, 10);
    if (end == text.c_str() || v < 0) return -1;
    switch (*end) {
        case 'K': case 'k': return v * 1024;
        case 'M': case 'm': return v * 1024 * 1024;
        case 'G': case 'g': return v * 1024LL * 1024 * 1024;
        default: return v;
    }
}

bool plausibleMilli(long long m) { return m >= 1000 && m < 125000; }

// Same device names as cpu_temperature.cpp, so the list below describes the sensors the headline value comes from.
bool isCpuHwmon(const std::string& n) { return n == "coretemp" || n == "k10temp" || n == "zenpower" || n == "cpu_thermal" || n == "soc_thermal"; }
bool isCpuZone(const std::string& t) { return t == "x86_pkg_temp" || t == "cpu-thermal" || t == "cpu_thermal" || t == "soc-thermal" || t == "soc_thermal"; }

class LinuxCpuDetail : public CpuDetailSource {
public:
    explicit LinuxCpuDetail(std::string r) : root(std::move(r)) {}

    void readInfo(CpuDetailInfo& out) override {
        readCpuinfo(out);
        listCpus();

        // si_get_cpu_logical_info reads the sysfs root named by this variable (that is how its own test fakes a tree).
        const char* previous = std::getenv("SYSTEMINFO_SYSFS_ROOT");
        const std::string saved = previous ? previous : "";
        if (!root.empty()) setenv("SYSTEMINFO_SYSFS_ROOT", (root + "/sys").c_str(), 1);
        fillTopology(out);
        if (!root.empty()) { if (previous) setenv("SYSTEMINFO_SYSFS_ROOT", saved.c_str(), 1); else unsetenv("SYSTEMINFO_SYSFS_ROOT"); }

        // Physical-package ids are encoded in the core key (package * 100000 + core), so the socket count is exact.
        std::set<int> pk;
        bool known = !out.logical.empty();
        for (const auto& l : out.logical) { if (l.coreKey < 0) known = false; else pk.insert(l.coreKey / 100000); }
        if (known) out.packages = (int)pk.size();
        coreKeys.clear();
        for (const auto& l : out.logical) coreKeys.push_back(l.coreKey);

        readCaches(out);
        readClockRange(out);
    }

    void readLive(CpuDetailLive& out) override {
        readPolicy(out);
        readSensors(out);
        readPower(out);
        readThrottle(out);
        readStat(out);
        readLoad(out);
    }

private:
    std::string root;
    std::vector<int> cpus;          // online logical processors, ascending — the order of the overlay engine's cores
    std::vector<int> coreKeys;      // parallel to `cpus`
    int fastestCpu = 0;             // the processor with the highest hardware clock limit: policy is read from it

    std::string cpuDir() const { return root + "/sys/devices/system/cpu"; }
    std::string cpuPath(int n) const { return cpuDir() + "/cpu" + std::to_string(n); }

    // ---------------------------------------------------------------- /proc/cpuinfo
    void readCpuinfo(CpuDetailInfo& out) {
        std::ifstream f(root + "/proc/cpuinfo");
        std::string line, name, hardware, flagsLine;
        bool x86 = false;
        while (std::getline(f, line)) {
            if (cpuTrim(line).empty()) { if (!name.empty() || !hardware.empty() || !flagsLine.empty()) break; else continue; }
            const size_t colon = line.find(':');
            if (colon == std::string::npos) continue;
            std::string key = cpuTrim(line.substr(0, colon)), val = cpuTrim(line.substr(colon + 1));
            for (char& c : key) c = (char)std::tolower((unsigned char)c);
            if (key == "model name") name = val;
            else if (key == "hardware" || (key == "model" && !allDigits(val))) hardware = val;
            else if (key == "vendor_id") { if (out.vendor.empty()) out.vendor = val; }
            else if (key == "cpu family") { x86 = true; if (out.family < 0 && allDigits(val)) out.family = std::atoi(val.c_str()); }
            else if (key == "model" && allDigits(val)) { if (out.modelId < 0) out.modelId = std::atoi(val.c_str()); }
            else if (key == "stepping") { if (out.stepping < 0 && allDigits(val)) out.stepping = std::atoi(val.c_str()); }
            else if (key == "flags") flagsLine = val;
        }
        (void)x86;
        if (!name.empty()) out.model = name;
        else if (!hardware.empty() && out.model.empty()) out.model = hardware;
        if (out.hypervisor < 0 && !flagsLine.empty()) {
            std::istringstream in(flagsLine); std::string tok; bool hv = false;
            while (in >> tok) if (tok == "hypervisor") hv = true;
            out.hypervisor = hv ? 1 : 0;
        }
    }

    void listCpus() {
        cpus.clear();
        for (const auto& path : sorted_children(cpuDir())) {
            const std::string name = fs::path(path).filename().string();
            if (name.size() < 4 || name.compare(0, 3, "cpu") != 0 || !allDigits(name.substr(3))) continue;
            long long online = 1;
            if (read_int(path + "/online", online) && online == 0) continue;
            cpus.push_back(std::atoi(name.c_str() + 3));
        }
        std::sort(cpus.begin(), cpus.end());
    }

    // ---------------------------------------------------------------- caches
    void readCaches(CpuDetailInfo& out) {
        struct Acc { long long total = 0, minSize = -1, maxSize = -1; int instances = 0; };
        std::map<std::pair<int, std::string>, Acc> acc;
        std::set<std::string> seen;
        for (int cpu : cpus) {
            for (const auto& idx : sorted_children(cpuPath(cpu) + "/cache")) {
                if (!startsWith(fs::path(idx).filename().string(), "index")) continue;
                long long level = 0;
                if (!read_int(idx + "/level", level) || level <= 0) continue;
                const std::string type = first(idx + "/type");
                const long long size = parseSize(first(idx + "/size"));
                if (type.empty() || size <= 0) continue;
                std::string shared = first(idx + "/shared_cpu_list");
                if (shared.empty()) shared = "cpu" + std::to_string(cpu);       // unknown sharing: count it on its own
                if (!seen.insert(std::to_string(level) + "|" + type + "|" + shared).second) continue;
                Acc& a = acc[{(int)level, type}];
                a.total += size; a.instances++;
                a.minSize = a.minSize < 0 ? size : std::min(a.minSize, size);
                a.maxSize = std::max(a.maxSize, size);
            }
        }
        auto order = [](const std::string& t) { return t == "Data" ? 0 : t == "Instruction" ? 1 : 2; };
        std::vector<CpuCache> list;
        for (const auto& kv : acc) {
            CpuCache c; c.level = kv.first.first; c.type = kv.first.second; c.totalBytes = kv.second.total; c.instances = kv.second.instances;
            c.perInstanceBytes = kv.second.minSize == kv.second.maxSize ? kv.second.minSize : -1;
            list.push_back(c);
        }
        std::sort(list.begin(), list.end(), [&](const CpuCache& a, const CpuCache& b) { return a.level != b.level ? a.level < b.level : order(a.type) < order(b.type); });
        out.caches = std::move(list);
    }

    // ---------------------------------------------------------------- clock range
    void readClockRange(CpuDetailInfo& out) {
        double minKhz = -1, maxKhz = -1; int top = cpus.empty() ? 0 : cpus.front();
        for (int cpu : cpus) {
            long long lo = 0, hi = 0;
            if (read_int(cpuPath(cpu) + "/cpufreq/cpuinfo_min_freq", lo) && lo > 0 && (minKhz < 0 || lo < minKhz)) minKhz = (double)lo;
            if (read_int(cpuPath(cpu) + "/cpufreq/cpuinfo_max_freq", hi) && hi > 0 && hi > maxKhz) { maxKhz = (double)hi; top = cpu; }
        }
        fastestCpu = top;
        if (minKhz > 0) out.minMhz = minKhz / 1000.0;
        if (maxKhz > 0) { out.maxMhz = maxKhz / 1000.0; out.maxSource = "cpufreq"; }
        long long base = 0;
        if (read_int(cpuPath(top) + "/cpufreq/base_frequency", base) && base > 0) { out.baseMhz = (double)base / 1000.0; out.baseSource = "cpufreq"; }
    }

    // ---------------------------------------------------------------- frequency policy
    void readPolicy(CpuDetailLive& out) {
        const std::string dir = cpuPath(fastestCpu) + "/cpufreq";
        out.governor = first(dir + "/scaling_governor");
        out.driver = first(dir + "/scaling_driver");
        out.preference = first(dir + "/energy_performance_preference");
        long long khz = 0;
        if (read_int(dir + "/scaling_max_freq", khz) && khz > 0) out.policyMaxMhz = (double)khz / 1000.0;
        long long v = 0;
        if (read_int(cpuDir() + "/intel_pstate/no_turbo", v)) out.boost = v == 0 ? 1 : 0;
        else if (read_int(cpuDir() + "/cpufreq/boost", v)) out.boost = v != 0 ? 1 : 0;
    }

    // ---------------------------------------------------------------- sensors
    struct SensorPlan { std::string input, high, crit; CpuSensor meta; };
    std::vector<SensorPlan> plan;
    std::string hwmonPower;          // power1_average / power1_input of the CPU hwmon device, microwatts
    bool planned = false;

    void discoverSensors() {
        plan.clear(); hwmonPower.clear(); planned = true;
        for (const auto& dir : sorted_children(root + "/sys/class/hwmon")) {
            if (!startsWith(fs::path(dir).filename().string(), "hwmon") || !isCpuHwmon(first(dir + "/name"))) continue;
            const std::string name = first(dir + "/name");

            int package = 0;
            for (const auto& input : sorted_children(dir)) {
                const std::string base = fs::path(input).filename().string();
                if (base.size() > 6 && startsWith(base, "temp") && base.compare(base.size() - 6, 6, "_input") == 0) {
                    const std::string label = first(input.substr(0, input.size() - 6) + "_label");
                    if (startsWith(label, "Package id ")) package = std::atoi(label.c_str() + 11);
                }
            }
            for (const auto& input : sorted_children(dir)) {
                const std::string base = fs::path(input).filename().string();
                if (base.size() <= 6 || !startsWith(base, "temp") || base.compare(base.size() - 6, 6, "_input") != 0) continue;
                long long milli = 0;
                if (!read_int(input, milli) || !plausibleMilli(milli)) continue;
                const std::string stem = input.substr(0, input.size() - 6);
                const std::string label = first(stem + "_label");

                SensorPlan p; p.input = input; p.high = stem + "_max"; p.crit = stem + "_crit";
                p.meta.label = label;
                if (startsWith(label, "Core ") && allDigits(label.substr(5))) { p.meta.kind = "core"; p.meta.coreKey = package * 100000 + std::atoi(label.c_str() + 5); }
                else if (startsWith(label, "Package") || label == "Tdie" || label == "Tctl") p.meta.kind = "package";
                else if (startsWith(label, "Tccd")) p.meta.kind = "ccd";
                else p.meta.kind = "other";
                if (label.empty()) p.meta.label = (name == "cpu_thermal" || name == "soc_thermal") ? "SoC" : "Sensor " + base.substr(4, base.size() - 10);
                plan.push_back(std::move(p));
            }
            for (const char* f : {"/power1_average", "/power1_input"}) {
                long long uw = 0;
                if (hwmonPower.empty() && read_int(dir + f, uw)) hwmonPower = dir + f;
            }
        }
        if (!plan.empty()) return;

        // No CPU hwmon device: the kernel's package thermal zone, when there is one.
        for (const auto& zone : sorted_children(root + "/sys/class/thermal")) {
            if (!startsWith(fs::path(zone).filename().string(), "thermal_zone") || !isCpuZone(first(zone + "/type"))) continue;
            long long milli = 0;
            if (!read_int(zone + "/temp", milli) || !plausibleMilli(milli)) continue;
            SensorPlan p; p.input = zone + "/temp"; p.meta.label = "Package (thermal zone)"; p.meta.kind = "package";
            plan.push_back(std::move(p));
            return;
        }
    }

    void readSensors(CpuDetailLive& out) {
        if (!planned) discoverSensors();
        bool broken = false, anyCore = false;
        for (const auto& p : plan) {
            long long milli = 0;
            if (!read_int(p.input, milli) || !plausibleMilli(milli)) { broken = true; continue; }     // never report a broken sensor
            CpuSensor s = p.meta;
            s.tempC = (double)milli / 1000.0;
            long long v = 0;
            if (read_int(p.high, v) && plausibleMilli(v)) s.highC = (double)v / 1000.0;
            if (read_int(p.crit, v) && plausibleMilli(v)) s.critC = (double)v / 1000.0;
            if (s.kind == "core") anyCore = true;
            out.sensors.push_back(std::move(s));
        }
        if (broken) planned = false;                       // a sensor vanished (suspend, driver reload): look again next time
        if (out.sensors.empty()) out.sensorNote = "This computer exposes no CPU temperature sensors (common in virtual machines).";
        else if (!anyCore) out.sensorNote = "This processor reports a die temperature, not one per core.";
    }

    // ---------------------------------------------------------------- power
    static constexpr double MAX_PLAUSIBLE_WATTS = 2000.0;
    struct Rapl { std::string energy, range, pl1, pl2; double lastUj = -1; sclk::time_point at; };
    std::vector<Rapl> rapl;
    bool raplPlanned = false;
    bool raplUnreadable = false;

    void discoverRapl() {
        rapl.clear(); raplPlanned = true;
        for (const auto& dir : sorted_children(root + "/sys/class/powercap")) {
            const std::string name = fs::path(dir).filename().string();
            if (!startsWith(name, "intel-rapl:") || name.find(':', 11) != std::string::npos) continue;     // packages only, not sub-domains
            if (!startsWith(first(dir + "/name"), "package")) continue;
            Rapl r; r.energy = dir + "/energy_uj"; r.range = dir + "/max_energy_range_uj";
            for (int c = 0; c < 3; c++) {
                const std::string kind = first(dir + "/constraint_" + std::to_string(c) + "_name");
                if (kind == "long_term") r.pl1 = dir + "/constraint_" + std::to_string(c) + "_power_limit_uw";
                else if (kind == "short_term") r.pl2 = dir + "/constraint_" + std::to_string(c) + "_power_limit_uw";
            }
            rapl.push_back(std::move(r));
        }
    }

    void readPower(CpuDetailLive& out) {
        if (!raplPlanned) discoverRapl();
        const auto now = sclk::now();
        double watts = 0; int have = 0; bool unreadable = false;
        for (auto& r : rapl) {
            long long uj = 0;
            if (!read_int(r.energy, uj)) { unreadable = true; continue; }
            if (r.lastUj >= 0) {
                const double dt = std::chrono::duration<double>(now - r.at).count();
                double delta = (double)uj - r.lastUj;
                if (delta < 0) { long long range = 0; delta = read_int(r.range, range) && range > 0 ? delta + (double)range : -1; }
                const double w = dt >= 0.1 && delta >= 0 ? delta / 1e6 / dt : -1.0;
                if (w >= 0 && w < MAX_PLAUSIBLE_WATTS) { watts += w; have++; }          // a glitching counter is dropped, not shown
            }
            r.lastUj = (double)uj; r.at = now;
        }
        if (!rapl.empty() && have == (int)rapl.size()) { out.packageWatts = watts; out.powerSource = "rapl"; }
        raplUnreadable = unreadable;
        if (!rapl.empty()) {
            long long v = 0;
            if (!rapl[0].pl1.empty() && read_int(rapl[0].pl1, v) && v > 0) out.limit1Watts = (double)v / 1e6;
            if (!rapl[0].pl2.empty() && read_int(rapl[0].pl2, v) && v > 0) out.limit2Watts = (double)v / 1e6;
        }
        if (!cpuKnown(out.packageWatts)) {
            long long uw = 0;
            if (!hwmonPower.empty() && read_int(hwmonPower, uw) && uw > 0) { out.packageWatts = (double)uw / 1e6; out.powerSource = "hwmon"; }
        }
        if (!cpuKnown(out.packageWatts)) {
            if (rapl.empty()) out.powerNote = "This computer exposes no CPU power counter.";
            else if (unreadable) out.powerNote = "The kernel only lets administrators read the CPU energy counter on this system.";
            // else: the first sample only sets a baseline; the value appears on the next one.
        }
    }

    // ---------------------------------------------------------------- thermal throttling
    void readThrottle(CpuDetailLive& out) {
        long long pkg = -1, core = -1;
        std::set<int> counted;
        for (size_t i = 0; i < cpus.size(); i++) {
            const std::string dir = cpuPath(cpus[i]) + "/thermal_throttle";
            long long v = 0;
            if (read_int(dir + "/package_throttle_count", v) && v >= 0) pkg = std::max(pkg, v);
            const int key = i < coreKeys.size() ? coreKeys[i] : -1;
            if (key >= 0 && !counted.insert(key).second) continue;       // SMT siblings share one core counter
            if (key >= 0 && read_int(dir + "/core_throttle_count", v) && v >= 0) core = (core < 0 ? 0 : core) + v;
        }
        out.packageThrottle = pkg; out.coreThrottle = core;
    }

    // ---------------------------------------------------------------- /proc/stat
    struct Stat { double user = 0, system = 0, idle = 0, iowait = 0, irq = 0, steal = 0, total = 0, ctxt = -1, intr = -1; bool valid = false; sclk::time_point at; };
    Stat prevStat;

    void readStat(CpuDetailLive& out) {
        std::ifstream f(root + "/proc/stat");
        std::string line;
        Stat s; s.at = sclk::now();
        double running = -1;
        while (std::getline(f, line)) {
            std::istringstream in(line);
            std::string tag; in >> tag;
            if (tag == "cpu") {
                double v[10] = {0};
                for (double& x : v) if (!(in >> x)) x = 0;
                // user, nice, system, idle, iowait, irq, softirq, steal (guest time is already inside user)
                s.user = v[0] + v[1]; s.system = v[2]; s.idle = v[3]; s.iowait = v[4]; s.irq = v[5] + v[6]; s.steal = v[7];
                s.total = s.user + s.system + s.idle + s.iowait + s.irq + s.steal;
                s.valid = s.total > 0;
            } else if (tag == "ctxt") { double v; if (in >> v) s.ctxt = v; }
            else if (tag == "intr") { double v; if (in >> v) s.intr = v; }
            else if (tag == "procs_running") { double v; if (in >> v) running = v; }
        }
        if (running >= 0) out.runnable = running;
        if (s.valid && prevStat.valid) {
            const double dt = std::chrono::duration<double>(s.at - prevStat.at).count();
            const double dTotal = s.total - prevStat.total;
            if (dTotal > 0) {
                out.userPct = (s.user - prevStat.user) * 100.0 / dTotal;
                out.systemPct = (s.system - prevStat.system) * 100.0 / dTotal;
                out.idlePct = (s.idle - prevStat.idle) * 100.0 / dTotal;
                out.iowaitPct = (s.iowait - prevStat.iowait) * 100.0 / dTotal;
                out.irqPct = (s.irq - prevStat.irq) * 100.0 / dTotal;
                out.stealPct = (s.steal - prevStat.steal) * 100.0 / dTotal;
            }
            if (dt >= 0.1) {
                if (s.ctxt >= 0 && prevStat.ctxt >= 0 && s.ctxt >= prevStat.ctxt) out.contextSwitchesPerSec = (s.ctxt - prevStat.ctxt) / dt;
                if (s.intr >= 0 && prevStat.intr >= 0 && s.intr >= prevStat.intr) out.interruptsPerSec = (s.intr - prevStat.intr) / dt;
            }
        }
        if (s.valid) prevStat = s;
    }

    void readLoad(CpuDetailLive& out) {
        std::ifstream f(root + "/proc/loadavg");
        double a, b, c; std::string tasks;
        if (!(f >> a >> b >> c >> tasks)) return;
        out.load1 = a; out.load5 = b; out.load15 = c;
        const size_t slash = tasks.find('/');
        if (slash != std::string::npos && allDigits(tasks.substr(slash + 1))) out.threads = (double)std::atoll(tasks.c_str() + slash + 1);
    }
};

}  // namespace

std::unique_ptr<CpuDetailSource> makeCpuDetailSource(const std::string& root) { return std::make_unique<LinuxCpuDetail>(root); }

}  // namespace si
