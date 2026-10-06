using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Services;

namespace SystemMonitor.Api.Endpoints;

public static class SystemEndpoints
{
public static void MapSystemEndpoints(this WebApplication app)
    {
// Runtime RAM (OS-visible total/used/available, cache, swap/page file, commit). Physical module
// data is deliberately a separate endpoint below: it is static firmware data with its own failure modes.
app.MapGet("/api/system/ram", (ISystemInfoProvider provider, ILogger<ISystemInfoProvider> log) =>
        {
            try
            {
                return Results.Ok(provider.GetRamDetails());
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Runtime memory information could not be read.");
                return Results.Problem("Memory information is not available.", statusCode: 503);
            }
        })
        .WithName("GetRamUsage");

// Physical RAM: platform summary + one entry per populated module. "Not readable on this machine" is a
// normal 200 with available=false (so the UI can show partial data), not an error.
app.MapGet("/api/system/memory/hardware", (MemoryHardwareService memory) => memory.GetHardware())
        .WithName("GetMemoryHardware");

// ECC capability / enabled / live error counters — kept apart from both of the above.
app.MapGet("/api/system/memory/health", (MemoryHardwareService memory) => memory.GetHealth())
        .WithName("GetMemoryHealth");
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

app.MapGet("/api/system/all", async (SystemSnapshotService snapshots, CancellationToken ct) =>
{
    // One failing subsystem (GPU/battery/disk/...) never fails the request:
    // it is reported in "unavailable" and the rest is returned. Only "RAM has
    // never been readable" is a 503, since the UI cannot render without it.
    var snap = await snapshots.GetAsync(ct);
    return snap is null
        ? Results.Problem("System information is not available yet.", statusCode: 503)
        : Results.Ok(snap);
})
.WithName("GetAllSystemInfo");

// Static host/hardware identification for the System page. Deliberately
// separate from /api/system/all: none of this changes while the app runs,
// so the frontend fetches it once instead of re-polling it every 2s.
app.MapGet("/api/system/info", async (SystemInfoService info) =>
{
    // Identity and CPU model come from SystemInfoService (last launch's cache first, refreshed in the
    // background). Each optional field is independently null-safe: one failing never blanks the rest, and
    // an unavailable value is null, never a fabricated placeholder.
    var data = await info.GetAsync();
    var identity = SystemInfoService.WithLiveUptime(data.Identity);

    return new
    {
        osDescription = System.Runtime.InteropServices.RuntimeInformation.OSDescription,
        osArchitecture = System.Runtime.InteropServices.RuntimeInformation.OSArchitecture.ToString(),
        processArchitecture = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString(),
        frameworkDescription = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
        machineName = Environment.MachineName,
        cpuModel = data.CpuModel,
        physicalCores = identity.PhysicalCores,
        logicalProcessors = Environment.ProcessorCount,
        appVersion = System.Reflection.Assembly.GetExecutingAssembly()
            .GetName().Version?.ToString() ?? "unknown",
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

// Stable adapter facts (cached across launches) and live telemetry are separate: the first is fetched once,
// the second polled only while the GPU page is open. Both are lists, so any number of adapters works.
app.MapGet("/api/system/cpu/detail", async (CpuService cpu) => await cpu.GetAsync())
        .WithName("GetCpuDetail");

app.MapGet("/api/system/gpus/hardware", async (GpuService gpus) => await gpus.GetHardwareAsync())
        .WithName("GetGpuHardware");

app.MapGet("/api/system/gpus/live", async (GpuService gpus) => await gpus.GetLiveAsync())
        .WithName("GetGpuLive");
    }
}