// /api/analytics/{stats,trend,bottlenecks}
//
// Computed in-process by AnalyticsService from the local JSONL snapshot
// history. Previously these proxied to a separate Python/FastAPI process on
// :8001; that process, its PyInstaller build and its port no longer exist.
// Routes, query parameters and JSON shapes are unchanged.

using System.Collections.Concurrent;
using Microsoft.AspNetCore.Mvc;
using SystemMonitor.Api.Services;

namespace SystemMonitor.Api.Endpoints;

public static class AnalyticsEndpoints
{
    // Several UI panels (and any second window) ask for the same range within
    // the same second. A few seconds of caching turns N file scans into one
    // without making the numbers meaningfully stale (history grows ~1 row/s).
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(5);
    private static readonly ConcurrentDictionary<string, (long At, object Value)> Cache = new();

    public static void MapAnalyticsEndpoints(this WebApplication app)
    {
        app.MapGet("/api/analytics/stats", (AnalyticsService svc, double? minutes, CancellationToken ct) =>
            Run(app, "stats", minutes, null, () => svc.GetStatsAsync(minutes, ct)))
            .WithName("GetAnalyticsStats");

        app.MapGet("/api/analytics/trend", (AnalyticsService svc, double? minutes, int? window, CancellationToken ct) =>
            Run(app, "trend", minutes, $"w{window}", () => svc.GetTrendAsync(minutes, window is >= 1 ? window.Value : 20, ct)))
            .WithName("GetAnalyticsTrend");

        app.MapGet("/api/analytics/bottlenecks", (
                AnalyticsService svc, double? minutes,
                [FromQuery(Name = "cpu_sustained_threshold")] double? cpuSustainedThreshold,
                [FromQuery(Name = "cpu_sustained_min_samples")] int? cpuSustainedMinSamples,
                [FromQuery(Name = "cpu_spike_threshold")] double? cpuSpikeThreshold,
                [FromQuery(Name = "net_sustained_threshold_kbps")] double? netSustainedThresholdKbps,
                [FromQuery(Name = "net_sustained_min_samples")] int? netSustainedMinSamples,
                [FromQuery(Name = "skip_first")] int? skipFirst,
                CancellationToken ct) =>
            {
                var d = new BottleneckOptions();
                var opts = new BottleneckOptions(
                    cpuSustainedThreshold ?? d.CpuSustainedThreshold,
                    Math.Max(1, cpuSustainedMinSamples ?? d.CpuSustainedMinSamples),
                    cpuSpikeThreshold ?? d.CpuSpikeThreshold,
                    netSustainedThresholdKbps ?? d.NetSustainedThresholdKbps,
                    Math.Max(1, netSustainedMinSamples ?? d.NetSustainedMinSamples),
                    Math.Max(0, skipFirst ?? d.SkipFirst));
                return Run(app, "bottlenecks", minutes, opts.ToString(), () => svc.GetBottlenecksAsync(minutes, opts, ct));
            })
            .WithName("GetAnalyticsBottlenecks");
    }

    private static async Task<IResult> Run<T>(WebApplication app, string name, double? minutes, string? extra, Func<Task<T>> compute)
        where T : notnull
    {
        if (minutes is < 0 || (minutes is { } m && (double.IsNaN(m) || double.IsInfinity(m))))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["minutes"] = new[] { "must be a non-negative number" } });

        var key = $"{name}|{minutes}|{extra}";
        var now = Environment.TickCount64;
        if (Cache.TryGetValue(key, out var hit) && now - hit.At < CacheTtl.TotalMilliseconds)
            return Results.Ok(hit.Value);

        try
        {
            var value = await compute();
            if (Cache.Count > 64) Cache.Clear();          // tiny key space in practice; this is only a bound
            Cache[key] = (now, value);
            return Results.Ok(value);
        }
        catch (OperationCanceledException)
        {
            return Results.StatusCode(StatusCodes.Status499ClientClosedRequest);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Data directory unreadable (permissions, disk error): report it, don't crash.
            app.Logger.LogError(ex, "Analytics could not read snapshot history.");
            return Results.Problem("Snapshot history could not be read.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}
