#include "../include/native_engine.h"
#include <windows.h>
#include <string>
#include <cstring>

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

// GetSystemTimes is the Windows-native equivalent of reading /proc/stat —
// it directly returns kernel/user/idle time since boot, no external tools needed.
double get_cpu_usage_percent() {
    FILETIME idleTime1, kernelTime1, userTime1;
    FILETIME idleTime2, kernelTime2, userTime2;

    GetSystemTimes(&idleTime1, &kernelTime1, &userTime1);
    Sleep(200); // 200ms sample window, matches the Linux implementation
    GetSystemTimes(&idleTime2, &kernelTime2, &userTime2);

    auto toULL = [](const FILETIME& ft) -> ULONGLONG {
        ULARGE_INTEGER uli;
        uli.LowPart = ft.dwLowDateTime;
        uli.HighPart = ft.dwHighDateTime;
        return uli.QuadPart;
    };

    ULONGLONG idle1 = toULL(idleTime1), idle2 = toULL(idleTime2);
    ULONGLONG kernel1 = toULL(kernelTime1), kernel2 = toULL(kernelTime2);
    ULONGLONG user1 = toULL(userTime1), user2 = toULL(userTime2);

    ULONGLONG idleDelta = idle2 - idle1;
    ULONGLONG totalDelta = (kernel2 - kernel1) + (user2 - user1);

    if (totalDelta == 0) return 0.0;
    return (1.0 - (double)idleDelta / totalDelta) * 100.0;
}

// No reliable, universally-supported public API exists for CPU temperature on
// Windows — WMI's MSAcpi_ThermalZoneTemperature is notoriously unsupported on
// most consumer hardware/OEM BIOSes. Rather than fake a number, report honestly.
double get_cpu_temperature() {
    return -1.0; // matches the Linux "unavailable" convention
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

} // extern "C"