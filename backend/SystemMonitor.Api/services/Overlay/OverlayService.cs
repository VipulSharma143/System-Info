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
    private readonly ICpuSensorSource? _cpuSensors;

    public OverlayService(IOverlayEngine engine, ILogger<OverlayService> log, ICpuSensorSource? cpuSensors = null)
    {
        _engine = engine;
        _log = log;
        _cpuSensors = cpuSensors;
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
        var native = ReadNative();
        return native is null || _cpuSensors is null ? native : WithCpuSensors(native, _cpuSensors.Read());
    }

    /// <summary>
    /// Fills the CPU temperature from a managed sensor source only where the native engine has none (Windows). A native value
    /// is never replaced, and no source means the engine's own "unavailable" note stands. Public so tests can drive it.
    /// </summary>
    public static OverlaySnapshot WithCpuSensors(OverlaySnapshot s, CpuSensorReading? sensors)
    {
        if (sensors is null || s.Cpu.TemperatureC is not null) return s;
        if (sensors.PackageC is not { } temp)
            return s with { Cpu = s.Cpu with { TemperatureNote = sensors.Note ?? s.Cpu.TemperatureNote } };

        // The overlay's trend line has one point per engine sample; align ours to its length, newest last, gaps stay null.
        var length = s.History.Cpu.Count;
        var padded = new List<double?>(length);
        var tail = sensors.History.Skip(Math.Max(0, sensors.History.Count - length)).ToList();
        for (var i = tail.Count; i < length; i++) padded.Add(null);
        padded.AddRange(tail);
        var history = s.History.CpuTemp.Any(v => v is not null) ? s.History : s.History with { CpuTemp = padded };

        return s with
        {
            Cpu = s.Cpu with { TemperatureC = temp, TemperatureSource = CpuSensorSelection.Source, TemperatureNote = sensors.Note },
            History = history,
        };
    }

    private OverlaySnapshot? ReadNative()
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
