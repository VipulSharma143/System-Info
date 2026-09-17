using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Services;

namespace SystemMonitor.Api.Endpoints;

public static class SystemEndpoints
{
public static void MapSystemEndpoints(this WebApplication app)
    {
app.MapGet("/api/system/ram", async (ISystemInfoProvider provider) =>
        {
return await provider.GetRamAsync();
        })
        .WithName("GetRamUsage");
app.MapGet("/api/system/cpu", (SystemMonitorBackgroundService sampler) =>
{
var cached = sampler.GetCachedCpu();
return cached ?? new CpuInfo(0); // 0% until the first sample completes
})
.WithName("GetCpuUsage");

app.MapGet("/api/system/processes", async (ISystemInfoProvider provider) =>
        {
return await provider.GetProcessesAsync();
        })
        .WithName("GetProcesses");

app.MapGet("/api/system/disk", (ISystemInfoProvider provider) =>
        {
return provider.GetDisks();
        })
        .WithName("GetDiskUsage");

app.MapGet("/api/system/network", (SystemMonitorBackgroundService sampler) =>
{
var cached = sampler.GetCachedNetwork();
return cached ?? new List<NetworkInfo>();
})
.WithName("GetNetworkUsage");

app.MapGet("/api/system/battery", (ISystemInfoProvider provider) =>
{
return provider.GetBattery();
})
.WithName("GetBatteryUsage");

app.MapGet("/api/system/all", async (ISystemInfoProvider provider, SystemMonitorBackgroundService sampler) =>
{
var ram = await provider.GetRamAsync();
var cpu = sampler.GetCachedCpu() ?? new CpuInfo(0);
var processes = await provider.GetProcessesAsync();
var disks = provider.GetDisks();
var network = sampler.GetCachedNetwork() ?? new List<NetworkInfo>();
var battery = provider.GetBattery();

return new { ram, cpu, processes, disks, network, battery };
})
.WithName("GetAllSystemInfo");

// Static host/hardware identification for the System page. Deliberately
// separate from /api/system/all: none of this changes while the app runs,
// so the frontend fetches it once instead of re-polling it every 2s.
app.MapGet("/api/system/info", (ISystemInfoProvider provider) =>
{
    string cpuModel;
    int coreCount;
    try
    {
        var buffer = new System.Text.StringBuilder(256);
        coreCount = Native.NativeInterop.GetCpuInfo(buffer, buffer.Capacity);
        cpuModel = buffer.ToString();
    }
    catch
    {
        // Native engine unavailable — report honestly rather than guessing.
        cpuModel = "";
        coreCount = 0;
    }

    // Win32_ComputerSystem/Win32_BIOS/Win32_OperatingSystem on Windows (spec
    // §6-§8); best-effort DMI/os-release reads on Linux. One optional field
    // failing here (see provider implementations) never blanks the rest —
    // each is independently null-safe.
    var identity = provider.GetSystemIdentity();

    return new
    {
        osDescription = System.Runtime.InteropServices.RuntimeInformation.OSDescription,
        osArchitecture = System.Runtime.InteropServices.RuntimeInformation.OSArchitecture.ToString(),
        processArchitecture = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString(),
        frameworkDescription = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
        machineName = Environment.MachineName,
        cpuModel = string.IsNullOrWhiteSpace(cpuModel) ? null : cpuModel,
        coreCount = coreCount > 0 ? coreCount : (int?)null,
        logicalProcessors = Environment.ProcessorCount,
        appVersion = System.Reflection.Assembly.GetExecutingAssembly()
            .GetName().Version?.ToString() ?? "unknown",
        // Extended identity (spec §6-§8, §24) — null when the underlying
        // query is unavailable, never a fabricated placeholder.
        manufacturer = identity.Manufacturer,
        model = identity.Model,
        biosVersion = identity.BiosVersion,
        windowsEdition = identity.WindowsEdition,
        windowsBuild = identity.WindowsBuild,
        lastBootTime = identity.LastBootTime,
        uptimeSeconds = identity.UptimeSeconds,
    };
})
.WithName("GetSystemIdentification");

// GPU (spec §11-§13). Separate from /api/system/info because, unlike the
// rest of system identity, this has a live component (per-engine
// utilization) — the frontend polls this on its own interval rather than
// folding it into the static identity fetch-once call.
app.MapGet("/api/system/gpu", (ISystemInfoProvider provider) =>
{
    return provider.GetGpus();
})
.WithName("GetGpuInfo");
    }
}