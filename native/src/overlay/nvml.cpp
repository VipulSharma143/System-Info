#include "nvml.h"
#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstring>
#include <mutex>

#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace si {
namespace {
using clk = std::chrono::steady_clock;
long long nowMs() { return std::chrono::duration_cast<std::chrono::milliseconds>(clk::now().time_since_epoch()).count(); }

struct Memory { unsigned long long total, free, used; };
struct Util { unsigned gpu, memory; };
using Handle = void*;
#ifdef _WIN32
#define NVMLCALL __cdecl
#else
#define NVMLCALL
#endif

typedef int (NVMLCALL FInit)();
typedef int (NVMLCALL FCount)(unsigned*);
typedef int (NVMLCALL FHandle)(unsigned, Handle*);
typedef int (NVMLCALL FName)(Handle, char*, unsigned);
typedef int (NVMLCALL FDriver)(char*, unsigned);
typedef int (NVMLCALL FMem)(Handle, Memory*);
typedef int (NVMLCALL FUtil)(Handle, Util*);
typedef int (NVMLCALL FTyped)(Handle, int, unsigned*);
typedef int (NVMLCALL FUint)(Handle, unsigned*);
typedef int (NVMLCALL FInt)(Handle, int*);
typedef int (NVMLCALL FPci)(Handle, void*);

constexpr int ERR_UNINIT = 1, ERR_DRIVER_NOT_LOADED = 9, ERR_GPU_LOST = 15, ERR_RESET_REQUIRED = 16, ERR_UNKNOWN = 999;
bool sessionLost(int code) { return code == ERR_UNINIT || code == ERR_DRIVER_NOT_LOADED || code == ERR_GPU_LOST || code == ERR_RESET_REQUIRED || code == ERR_UNKNOWN; }
}  // namespace

struct Nvml::Impl {
    std::mutex mu;
    void* lib = nullptr;
    FInit* init = nullptr; FCount* count = nullptr; FHandle* handle = nullptr; FName* name = nullptr; FDriver* driver = nullptr;
    FMem* mem = nullptr; FUtil* util = nullptr; FTyped* temp = nullptr; FTyped* clock = nullptr; FUint* power = nullptr;
    FUint* limit = nullptr; FUint* fan = nullptr; FInt* pstate = nullptr; FPci* pci = nullptr;
    bool up = false;
    long long nextAttempt = 0;
    std::string problem, driverVersion;
    std::vector<NvmlDevice> devices;
    std::vector<Handle> handles;

    static void* open() {
#ifdef _WIN32
        if (HMODULE m = LoadLibraryA("nvml.dll")) return m;
        char pf[MAX_PATH]; DWORD n = GetEnvironmentVariableA("ProgramFiles", pf, MAX_PATH);
        if (n > 0 && n < MAX_PATH) { std::string p = std::string(pf) + "\\NVIDIA Corporation\\NVSMI\\nvml.dll"; if (HMODULE m = LoadLibraryA(p.c_str())) return m; }
        return nullptr;
#else
        if (void* m = dlopen("libnvidia-ml.so.1", RTLD_NOW)) return m;
        return dlopen("libnvidia-ml.so", RTLD_NOW);
#endif
    }
    void* sym(const char* s) {
#ifdef _WIN32
        return reinterpret_cast<void*>(GetProcAddress(static_cast<HMODULE>(lib), s));
#else
        return dlsym(lib, s);
#endif
    }
    template <class T> bool bind(T*& f, const char* s) { f = reinterpret_cast<T*>(sym(s)); return f != nullptr; }

    bool load() {
        if (!lib) {
            lib = open();
            if (!lib) { problem = "NVIDIA management library (nvml) was not found."; return false; }
        }
        bool ok = bind(init, "nvmlInit_v2") && bind(count, "nvmlDeviceGetCount_v2") && bind(handle, "nvmlDeviceGetHandleByIndex_v2") &&
                  bind(name, "nvmlDeviceGetName") && bind(driver, "nvmlSystemGetDriverVersion") && bind(mem, "nvmlDeviceGetMemoryInfo") &&
                  bind(util, "nvmlDeviceGetUtilizationRates") && bind(temp, "nvmlDeviceGetTemperature") && bind(clock, "nvmlDeviceGetClockInfo") &&
                  bind(power, "nvmlDeviceGetPowerUsage") && bind(limit, "nvmlDeviceGetEnforcedPowerLimit") && bind(fan, "nvmlDeviceGetFanSpeed") &&
                  bind(pstate, "nvmlDeviceGetPerformanceState") && bind(pci, "nvmlDeviceGetPciInfo_v3");
        if (!ok) { problem = "NVIDIA management library is missing functions this app needs."; return false; }
        int rc = init();
        if (rc != 0) { problem = "NVML failed to initialise (code " + std::to_string(rc) + ")."; return false; }

        char buf[96] = {0};
        if (driver(buf, sizeof buf) == 0) driverVersion = buf;
        unsigned n = 0;
        if (count(&n) != 0) n = 0;
        devices.clear(); handles.clear();
        for (unsigned i = 0; i < n; i++) {
            Handle h = nullptr;
            if (handle(i, &h) != 0) continue;
            NvmlDevice d;
            char nm[96] = {0};
            d.name = name(h, nm, sizeof nm) == 0 ? nm : "NVIDIA GPU";
            // nvmlPciInfo_t: char busIdLegacy[16]; uint domain, bus, device, pciDeviceId, pciSubSystemId; char busId[32]
            alignas(8) unsigned char pi[128] = {0};
            if (pci(h, pi) == 0) {
                unsigned ids; std::memcpy(&ids, pi + 28, 4);
                d.vendorId = ids & 0xFFFF; d.deviceId = ids >> 16;
                d.pci = Nvml::normalizePci(std::string(reinterpret_cast<char*>(pi + 36), strnlen(reinterpret_cast<char*>(pi + 36), 32)));
            }
            Memory m;
            if (mem(h, &m) == 0) d.memTotal = (double)m.total;
            devices.push_back(d); handles.push_back(h);
        }
        if (devices.empty()) { problem = "NVML found no NVIDIA device."; return false; }
        problem.clear();
        return true;
    }

    bool ensure() {
        if (up) return true;
        long long now = nowMs();
        if (now < nextAttempt) return false;
        up = load();
        if (!up) nextAttempt = now + 20000;
        return up;
    }
    void invalidate(const char* why) { up = false; nextAttempt = 0; handles.clear(); devices.clear(); problem = why; }
};

Nvml::Nvml() : d(new Impl) {}
Nvml::~Nvml() { delete d; }   // the library stays loaded for the life of the process, as nvml expects

bool Nvml::ready() { std::lock_guard<std::mutex> g(d->mu); return d->ensure(); }
const std::vector<NvmlDevice>& Nvml::devices() { std::lock_guard<std::mutex> g(d->mu); d->ensure(); return d->devices; }
std::string Nvml::driverVersion() { std::lock_guard<std::mutex> g(d->mu); d->ensure(); return d->driverVersion; }
std::string Nvml::problem() { std::lock_guard<std::mutex> g(d->mu); d->ensure(); return d->problem; }

std::string Nvml::normalizePci(const std::string& address) {
    std::string t;
    for (char c : address) { if (c == 0) break; if (c != ' ') t += (char)std::tolower((unsigned char)c); }
    return t.size() > 12 ? t.substr(t.size() - 12) : t;
}

bool Nvml::read(size_t device, NvmlReading& out) {
    std::lock_guard<std::mutex> g(d->mu);
    for (int attempt = 0; attempt < 2; attempt++) {   // a lost session is rebuilt once and the read repeated
        if (!d->ensure() || device >= d->handles.size()) return false;
        Handle h = d->handles[device];
        bool lost = false;
        auto call = [&](int code) { if (sessionLost(code)) lost = true; return code == 0; };

        NvmlReading r;
        Util u; Memory m; unsigned v = 0; int ps = 0;
        if (call(d->util(h, &u))) r.util = u.gpu;
        if (call(d->mem(h, &m))) { r.memUsed = (double)m.used; r.memTotal = (double)m.total; }
        r.tempCode = d->temp(h, 0, &v);
        if (sessionLost(r.tempCode)) lost = true;
        if (r.tempCode == 0 && v > 0 && v < 150) r.temp = v;
        if (call(d->clock(h, 0, &v))) r.coreMhz = v;
        if (call(d->clock(h, 2, &v))) r.memMhz = v;
        if (d->power(h, &v) == 0) r.power = v / 1000.0;
        if (d->limit(h, &v) == 0) r.powerLimit = v / 1000.0;
        if (d->fan(h, &v) == 0) r.fan = v;
        if (d->pstate(h, &ps) == 0 && ps >= 0 && ps <= 15) r.pstate = "P" + std::to_string(ps);

        if (lost && !known(r.util) && !known(r.temp) && attempt == 0) { d->invalidate("NVIDIA driver session was lost; reconnecting."); continue; }
        d->problem = known(r.temp) ? "" : "NVML could not read the GPU temperature (code " + std::to_string(r.tempCode) + ").";
        out = r;
        return true;
    }
    return false;
}

}  // namespace si
