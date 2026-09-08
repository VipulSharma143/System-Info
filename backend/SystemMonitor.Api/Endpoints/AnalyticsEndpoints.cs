// AnalyticsEndpoints.cs
// Place this in: backend/SystemMonitor.Api/Endpoints/AnalyticsEndpoints.cs
//
// Proxies to the Python analytics_service.py (FastAPI, localhost:8001).
// Matches the existing MapXxxEndpoints() static-class convention used in
// SystemEndpoints.cs and NativeEndpoints.cs.
//
// Graceful degradation: if the Python service is down or unreachable, these
// endpoints return a 503 with an "unavailable" style message instead of
// crashing or bubbling up a raw exception — same principle already used
// for hardware reads that aren't available on a given platform (fan RPM,
// Windows CPU temp, etc.).
//
// The snapshot file path is resolved server-side (same relative path
// SnapshotLogger.cs writes to) so callers of /api/analytics/* don't need
// to know or pass a file path — only SnapshotLogger.cs's path convention
// needs to be consistent with this file.

using System.Net.Http.Json;

namespace SystemMonitor.Api.Endpoints;

public static class AnalyticsEndpoints
{
    // Matches the path convention in SnapshotLogger.cs: AppContext.BaseDirectory
    // walked up three levels (net.../ -> Debug/ -> bin/ -> project root), then
    // into data/snapshots.jsonl. Kept identical here so both files agree on
    // "where is the log" without needing a shared constants file yet.
    private static string SnapshotFilePath =>
        Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory, "..", "..", "..", "data", "snapshots.jsonl"));

    public static void MapAnalyticsEndpoints(this WebApplication app)
    {
        app.MapGet("/api/analytics/stats", async (IHttpClientFactory httpClientFactory, double? minutes) =>
        {
            return await ProxyToAnalyticsService(httpClientFactory, "stats", minutes);
        })
        .WithName("GetAnalyticsStats");

        app.MapGet("/api/analytics/trend", async (IHttpClientFactory httpClientFactory, double? minutes, int? window) =>
        {
            var extraParams = window.HasValue ? $"&window={window.Value}" : "";
            return await ProxyToAnalyticsService(httpClientFactory, "trend", minutes, extraParams);
        })
        .WithName("GetAnalyticsTrend");

        app.MapGet("/api/analytics/bottlenecks", async (IHttpClientFactory httpClientFactory, double? minutes) =>
        {
            return await ProxyToAnalyticsService(httpClientFactory, "bottlenecks", minutes);
        })
        .WithName("GetAnalyticsBottlenecks");
    }

    private static async Task<IResult> ProxyToAnalyticsService(
        IHttpClientFactory httpClientFactory,
        string endpoint,
        double? minutes,
        string extraParams = "")
    {
        var client = httpClientFactory.CreateClient("AnalyticsService");

        var minutesParam = minutes.HasValue ? $"&minutes={minutes.Value}" : "";
        var url = $"/{endpoint}?file={Uri.EscapeDataString(SnapshotFilePath)}{minutesParam}{extraParams}";

        try
        {
            var response = await client.GetAsync(url);

            if (!response.IsSuccessStatusCode)
            {
                return Results.Problem(
                    detail: $"Analytics service returned {(int)response.StatusCode}",
                    statusCode: (int)response.StatusCode);
            }

            var json = await response.Content.ReadFromJsonAsync<object>();
            return Results.Ok(json);
        }
        catch (HttpRequestException ex)
        {
            // The Python analytics service isn't running or isn't reachable.
            // Graceful degradation: report unavailable, don't crash the request.
            return Results.Problem(
                detail: $"Analytics service unavailable: {ex.Message}",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}
