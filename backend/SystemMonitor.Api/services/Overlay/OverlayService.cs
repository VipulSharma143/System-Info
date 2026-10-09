using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Owns the native overlay engine for the life of the app and serves its latest snapshot. Everything that shows live
/// CPU / GPU / RAM numbers (the Overlay page and the GPU page) reads this one snapshot, so two screens can never
/// disagree about the same GPU. The engine samples on its own thread; a request only copies the last result.
/// </summary>
public sealed class OverlayService : IHostedService
{
    /// <summary>The cadence while someone is watching; the engine slows itself down when nobody reads snapshots.</summary>
    public const int SampleIntervalMs = 500;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly IOverlayEngine _engine;
    private readonly ILogger<OverlayService> _log;
    private readonly object _gate = new();
    private string? _lastJson;
    private OverlaySnapshot? _last;

    public OverlayService(IOverlayEngine engine, ILogger<OverlayService> log)
    {
        _engine = engine;
        _log = log;
    }

    public string? Problem => _engine.Problem;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (!_engine.Start(SampleIntervalMs)) _log.LogWarning("Overlay engine unavailable: {Problem}", _engine.Problem);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _engine.Stop();
        return Task.CompletedTask;
    }

    /// <summary>The latest snapshot, or null while the engine has not produced one (or is unavailable).</summary>
    public OverlaySnapshot? Read()
    {
        var json = _engine.ReadSnapshotJson();
        if (json is null) return null;
        lock (_gate)
        {
            if (ReferenceEquals(json, _lastJson) || json == _lastJson) return _last;
            try
            {
                _last = JsonSerializer.Deserialize<OverlaySnapshot>(json, Json);
                _lastJson = json;
            }
            catch (JsonException ex)
            {
                _log.LogWarning(ex, "Overlay snapshot could not be read.");
                return _last;
            }
            return _last;
        }
    }

    /// <summary>Waits briefly for the first sample after start-up (used where a one-time read needs the engine's identity data).</summary>
    public async Task<OverlaySnapshot?> ReadWhenReadyAsync(TimeSpan timeout)
    {
        var until = Environment.TickCount64 + (long)timeout.TotalMilliseconds;
        while (true)
        {
            if (Read() is { } s) return s;
            if (_engine.Problem is not null || Environment.TickCount64 >= until) return null;
            await Task.Delay(50);
        }
    }
}
