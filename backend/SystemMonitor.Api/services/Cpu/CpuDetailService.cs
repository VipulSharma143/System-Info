using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using SystemMonitor.Api.Native;

namespace SystemMonitor.Api.Services;

/// <summary>The native CPU-detail reader. Abstracted so the service can be tested without the library.</summary>
public interface ICpuDetailEngine
{
    /// <summary>The latest document, or null when nothing could be read or the library is unavailable.</summary>
    string? ReadJson();
    /// <summary>Why the native reader cannot run (library missing), or null.</summary>
    string? Problem { get; }
}

public sealed class NativeCpuDetailEngine : ICpuDetailEngine
{
    private readonly object _gate = new();
    private byte[] _buffer = new byte[16 * 1024];

    public string? Problem { get; private set; }

    public string? ReadJson()
    {
        lock (_gate)
        {
            try
            {
                for (var attempt = 0; attempt < 3; attempt++)
                {
                    var n = NativeInterop.CpuDetailJson(_buffer, _buffer.Length);
                    if (n == 0) return null;
                    if (n < 0) { _buffer = new byte[Math.Min(-n + 1024, 4 * 1024 * 1024)]; continue; }
                    Problem = null;
                    return Encoding.UTF8.GetString(_buffer, 0, n);
                }
                return null;
            }
            catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException or BadImageFormatException)
            {
                Problem = "The native CPU reader is not available in this build.";
                return null;
            }
        }
    }
}

/// <summary>
/// Serves the CPU tab: the native detail document (stable facts, per-core sensors, power, policy, activity) merged with
/// the overlay engine's live per-processor load, clocks and CPU temperature. The CPU temperature is NOT read again here
/// — it is the value the Overlay tab shows, from the same sample.
/// </summary>
public sealed class CpuDetailService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly ICpuDetailEngine _engine;
    private readonly OverlayService _overlay;
    private readonly ILogger<CpuDetailService> _log;
    private readonly object _gate = new();
    private string? _lastJson;
    private NativeCpuDetail? _last;

    public CpuDetailService(ICpuDetailEngine engine, OverlayService overlay, ILogger<CpuDetailService> log)
    {
        _engine = engine;
        _overlay = overlay;
        _log = log;
    }

    public string? Problem => _engine.Problem;

    /// <summary>The merged document, or null until the native reader has produced one.</summary>
    public CpuDetail? Read()
    {
        var native = ReadNative();
        return native is null ? null : Merge(native, _overlay.Read());
    }

    private NativeCpuDetail? ReadNative()
    {
        var json = _engine.ReadJson();
        if (json is null) return null;
        lock (_gate)
        {
            if (json == _lastJson) return _last;
            try
            {
                var parsed = JsonSerializer.Deserialize<NativeCpuDetail>(json, Json);
                if (parsed is null) return _last;
                _last = parsed;
                _lastJson = json;
            }
            catch (JsonException ex)
            {
                _log.LogWarning(ex, "CPU detail document could not be read.");
            }
            return _last;
        }
    }

    /// <summary>Pure merge of the two engines' documents (public so tests can drive it with fixtures).</summary>
    public static CpuDetail Merge(NativeCpuDetail detail, OverlaySnapshot? overlay)
    {
        if (overlay is null)
        {
            return new CpuDetail(
                detail.Platform, detail.SampledAtMs, 0, detail.SampledAtMs,
                detail.Identity, detail.Topology, null, [],
                detail.Frequency, detail.Caches, detail.Features, detail.Sensors, detail.SensorsNote,
                detail.Power, detail.Throttle, detail.Time, detail.Activity,
                new CpuDetailTrend(0, [], []));
        }

        var cpu = overlay.Cpu;
        var clocks = cpu.Cores.Where(c => c.Mhz is > 0).Select(c => c.Mhz!.Value).ToList();

        // Logical processors line up with the overlay's cores by index; when the counts disagree (a processor went
        // offline between the two reads) no identity is attached rather than a wrong one.
        var aligned = detail.Logical.Count == cpu.Cores.Count;
        var cores = new List<CpuDetailCore>(cpu.Cores.Count);
        for (var i = 0; i < cpu.Cores.Count; i++)
        {
            var info = aligned ? detail.Logical[i] : null;
            double? temp = null;
            if (info?.CoreKey is { } key)
                temp = detail.Sensors.FirstOrDefault(s => s.Kind == "core" && s.CoreKey == key && s.TempC is not null)?.TempC;
            cores.Add(new CpuDetailCore(i, info?.CoreKey, info?.Kind, cpu.Cores[i].U, cpu.Cores[i].Mhz, temp));
        }

        var live = new CpuDetailLive(
            cpu.UsagePercent, cpu.TemperatureC, cpu.TemperatureSource, cpu.TemperatureNote,
            cpu.ClockMhz,
            clocks.Count > 0 ? clocks.Max() : null,
            clocks.Count > 0 ? clocks.Min() : null,
            cpu.ActiveCores, cpu.BusiestCorePercent, cpu.Note);

        return new CpuDetail(
            detail.Platform, overlay.SampledAtMs, overlay.IntervalMs, detail.SampledAtMs,
            detail.Identity, detail.Topology, live, cores,
            detail.Frequency, detail.Caches, detail.Features, detail.Sensors, detail.SensorsNote,
            detail.Power, detail.Throttle, detail.Time, detail.Activity,
            new CpuDetailTrend(overlay.History.IntervalMs, overlay.History.Cpu, overlay.History.CpuTemp));
    }
}
