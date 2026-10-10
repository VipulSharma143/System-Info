#include "../../include/native_engine.h"
#include <windows.h>
#include <string>
#include <cstring>
#include <mutex>

// DXGI is used for GPU vendor detection — the standard, reliable way to
// enumerate graphics adapters on Windows without needing driver-specific SDKs.
#include <dxgi.h>
#pragma comment(lib, "dxgi.lib")

extern "C" {

// CPU model name comes from the registry; Windows doesn't expose this via
// a simple file the way Linux's /proc/cpuinfo does.
int get_cpu_info(char* modelNameOut, int bufferSize) {
    HKEY hKey;
    std::string modelName = "Unknown";

    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE,
        "HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0",
        0, KEY_READ, &hKey) == ERROR_SUCCESS)
    {
        char buffer[256];
        DWORD bufferSize2 = sizeof(buffer);
        if (RegQueryValueExA(hKey, "ProcessorNameString", nullptr, nullptr,
            (LPBYTE)buffer, &bufferSize2) == ERROR_SUCCESS)
        {
            modelName = std::string(buffer);
        }
        RegCloseKey(hKey);
    }

    SYSTEM_INFO sysInfo;
    GetSystemInfo(&sysInfo);
    int coreCount = (int)sysInfo.dwNumberOfProcessors;

    std::strncpy(modelNameOut, modelName.c_str(), bufferSize - 1);
    modelNameOut[bufferSize - 1] = '\0';

    return coreCount;
}

// GetSystemTimes is the Windows-native equivalent of reading /proc/stat. Usage is the busy share of CPU time since the
// previous call, so a call never sleeps; only the first call waits one 200 ms window to have a baseline. Calls closer
// than 100 ms apart return the last value (a window that short is mostly noise).
static ULONGLONG filetime_to_ull(const FILETIME& ft) {
    ULARGE_INTEGER uli;
    uli.LowPart = ft.dwLowDateTime;
    uli.HighPart = ft.dwHighDateTime;
    return uli.QuadPart;
}

double get_cpu_usage_percent() {
    static std::mutex gate;
    static bool primed = false;
    static ULONGLONG prevIdle = 0, prevBusy = 0;
    static ULONGLONG prevTick = 0;
    static double last = 0.0;

    if (!gate.try_lock()) return last;   // another caller is already sampling; reuse its result
    std::lock_guard<std::mutex> hold(gate, std::adopt_lock);

    auto sample = [](ULONGLONG& idle, ULONGLONG& busy) {
        FILETIME i, k, u;
        if (!GetSystemTimes(&i, &k, &u)) return false;
        idle = filetime_to_ull(i);
        busy = filetime_to_ull(k) + filetime_to_ull(u);   // kernel time already includes idle time
        return true;
    };

    if (!primed) {
        if (!sample(prevIdle, prevBusy)) return 0.0;
        prevTick = GetTickCount64();
        Sleep(200);
        primed = true;
    }
    const ULONGLONG nowTick = GetTickCount64();
    if (nowTick - prevTick < 100) return last;

    ULONGLONG idle = 0, busy = 0;
    if (!sample(idle, busy)) return last;
    const ULONGLONG idleDelta = idle - prevIdle;
    const ULONGLONG totalDelta = busy - prevBusy;
    prevIdle = idle;
    prevBusy = busy;
    prevTick = nowTick;
    if (totalDelta == 0) return last;
    last = (1.0 - (double)idleDelta / (double)totalDelta) * 100.0;
    if (last < 0.0) last = 0.0;
    return last;
}

// No reliable, universally-supported public API exists for CPU temperature on Windows (the ACPI thermal zone is a
// generic zone, not the CPU). Report "unavailable" through the same entry point as Linux.
double get_cpu_temperature() {
    double celsius = 0.0;
    return si_cpu_temperature(&celsius, nullptr, 0) == 1 ? celsius : -1.0;
}

// DXGI enumerates graphics adapters and exposes their PCI vendor ID directly —
// this is the standard modern approach, more reliable than WMI's Win32_VideoController
// which can misreport on hybrid/multi-GPU laptops.
int get_gpu_vendor() {
    IDXGIFactory* factory = nullptr;
    if (FAILED(CreateDXGIFactory(__uuidof(IDXGIFactory), (void**)&factory))) {
        return 0;
    }

    IDXGIAdapter* adapter = nullptr;
    int vendorCode = 0;

    if (factory->EnumAdapters(0, &adapter) != DXGI_ERROR_NOT_FOUND) {
        DXGI_ADAPTER_DESC desc;
        adapter->GetDesc(&desc);

        switch (desc.VendorId) {
            case 0x10DE: vendorCode = 1; break; // NVIDIA
            case 0x1002: vendorCode = 2; break; // AMD
            case 0x8086: vendorCode = 3; break; // Intel
            default: vendorCode = 0; break;
        }

        adapter->Release();
    }

    factory->Release();
    return vendorCode;
}

// AMD usage % on Windows requires vendor-specific SDKs (ADL) not covered here yet.
double get_amd_gpu_usage_percent() {
    return -1.0; // honestly unavailable until ADL integration is added
}

// Same situation as CPU temperature — no standard public API for fan RPM on Windows.
int get_fan_rpm() {
    return -1;
}
// Real implementation would use GetSystemPowerStatus() or WMI Win32_Battery.
// Deferred — reporting honestly unavailable for now, same as fan RPM on Windows.
int get_battery_info_json(char* bufferOut, int bufferSize) {
    const char* fallback = "{\"present\":false}";
    std::strncpy(bufferOut, fallback, bufferSize - 1);
    bufferOut[bufferSize - 1] = '\0';
    return 0;
}

// Dedicated/shared VRAM, per adapter. Win32_VideoController.AdapterRAM (used
// elsewhere via WMI) is a 32-bit field and silently wraps/truncates for any
// adapter with 4GB+ VRAM — that's the root cause of GPUs reporting far less
// VRAM than they actually have. DXGI_ADAPTER_DESC.DedicatedVideoMemory is a
// SIZE_T (64-bit on x64) and isn't subject to that truncation, so this is
// the reliable source of truth for VRAM size.
//
// adapterIndex mirrors DXGI's own enumeration order (0, 1, 2, ...), which is
// not guaranteed to match Win32_VideoController's enumeration order on a
// multi-GPU system — the caller (C#) is responsible for correlating adapters
// by name/description when there's more than one, not this function.
int get_gpu_vram_bytes(int adapterIndex, char* nameOut, int nameBufferSize,
                        long long* dedicatedBytesOut, long long* sharedSystemBytesOut) {
    if (dedicatedBytesOut) *dedicatedBytesOut = 0;
    if (sharedSystemBytesOut) *sharedSystemBytesOut = 0;
    if (nameOut && nameBufferSize > 0) nameOut[0] = '\0';

    IDXGIFactory* factory = nullptr;
    if (FAILED(CreateDXGIFactory(__uuidof(IDXGIFactory), (void**)&factory))) {
        return 0;
    }

    IDXGIAdapter* adapter = nullptr;
    HRESULT hr = factory->EnumAdapters((UINT)adapterIndex, &adapter);
    if (hr == DXGI_ERROR_NOT_FOUND || FAILED(hr) || adapter == nullptr) {
        factory->Release();
        return 0;
    }

    DXGI_ADAPTER_DESC desc;
    if (FAILED(adapter->GetDesc(&desc))) {
        adapter->Release();
        factory->Release();
        return 0;
    }

    if (dedicatedBytesOut) *dedicatedBytesOut = (long long)desc.DedicatedVideoMemory;
    if (sharedSystemBytesOut) *sharedSystemBytesOut = (long long)desc.SharedSystemMemory;

    if (nameOut && nameBufferSize > 0) {
        // desc.Description is a wide string (WCHAR[128]); adapter names are
        // ASCII in practice, so a simple truncating narrow-conversion is fine
        // here (this is a display label, not used for any comparison logic
        // that needs full Unicode fidelity).
        int i = 0;
        for (; i < nameBufferSize - 1 && desc.Description[i] != L'\0'; i++) {
            nameOut[i] = (char)desc.Description[i];
        }
        nameOut[i] = '\0';
    }

    adapter->Release();
    factory->Release();
    return 1;
}

int get_gpu_luid(int adapterIndex, long long* luidOut) {
    if (luidOut) *luidOut = 0;
    if (!luidOut) return 0;

    IDXGIFactory* factory = nullptr;
    if (FAILED(CreateDXGIFactory(__uuidof(IDXGIFactory), (void**)&factory))) {
        return 0;
    }

    IDXGIAdapter* adapter = nullptr;
    HRESULT hr = factory->EnumAdapters((UINT)adapterIndex, &adapter);
    if (FAILED(hr) || adapter == nullptr) {
        factory->Release();
        return 0;
    }

    DXGI_ADAPTER_DESC desc;
    int ok = 0;
    if (SUCCEEDED(adapter->GetDesc(&desc))) {
        *luidOut = ((long long)(unsigned int)desc.AdapterLuid.HighPart << 32) | (long long)desc.AdapterLuid.LowPart;
        ok = 1;
    }

    adapter->Release();
    factory->Release();
    return ok;
}

} // extern "C"