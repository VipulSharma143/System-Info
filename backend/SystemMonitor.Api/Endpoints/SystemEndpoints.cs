using SystemMonitor.Api.Interface;

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

        app.MapGet("/api/system/cpu", async (ISystemInfoProvider provider) =>
        {
            return await provider.GetCpuAsync();
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

        app.MapGet("/api/system/network", async (ISystemInfoProvider provider) =>
        {
            return await provider.GetNetworkAsync();
        })
        .WithName("GetNetworkUsage");
    }
}