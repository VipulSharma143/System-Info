// /api/system/cpu/detail — everything the CPU tab shows, in one response.
//
// Live per-processor load, clocks and the CPU temperature come from the overlay engine's latest sample (so the Overlay
// tab and this one agree); identity, topology, caches, sensors, power and activity come from the native CPU reader.
// 503 means the native reader has produced nothing yet or is unavailable in this build; the body says which.
using SystemMonitor.Api.Services;

namespace SystemMonitor.Api.Endpoints;

public static class CpuEndpoints
{
    public static void MapCpuEndpoints(this WebApplication app)
    {
        app.MapGet("/api/system/cpu/detail", (CpuDetailService cpu) =>
            {
                if (cpu.Read() is { } detail) return Results.Ok(detail);
                var reason = cpu.Problem ?? "The CPU details are not ready yet.";
                return Results.Json(new { error = reason, starting = cpu.Problem is null }, statusCode: StatusCodes.Status503ServiceUnavailable);
            })
            .WithName("GetCpuDetail");
    }
}
