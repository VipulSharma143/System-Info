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


app.MapGet("/api/system/all", async (ISystemInfoProvider provider, SystemMonitorBackgroundService sampler) =>
{
    var ram = await provider.GetRamAsync();
    var cpu = sampler.GetCachedCpu() ?? new CpuInfo(0);
    var processes = await provider.GetProcessesAsync();
    var disks = provider.GetDisks();
    var network = sampler.GetCachedNetwork() ?? new List<NetworkInfo>();

    return new { ram, cpu, processes, disks, network };
})
.WithName("GetAllSystemInfo");
    }
}