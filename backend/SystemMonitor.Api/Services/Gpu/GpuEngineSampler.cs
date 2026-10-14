using System.Diagnostics;
using System.Runtime.Versioning;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Samples the Windows "GPU Engine" counters with ONE read of the whole category per poll.
/// The previous approach opened a PerformanceCounter per engine instance (hundreds to thousands on a busy PC, one per
/// process per engine) and every NextValue() re-read the entire category, so a single sample took many seconds and the
/// live GPU numbers (temperature included, which was read in the same call) froze or lagged badly.
/// Here the category is read once, and each instance's value is computed against its own previous sample, so every
/// reading still covers a full polling interval.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class GpuEngineSampler
{
    public static GpuEngineSampler Shared { get; } = new();

    private const string Category = "GPU Engine";
    private const string CounterName = "Utilization Percentage";

    // Two reads closer than this would compare nearly identical timestamps; reuse the last answer instead.
    private static readonly TimeSpan MinInterval = TimeSpan.FromMilliseconds(700);

    private readonly object _gate = new();
    private Dictionary<string, CounterSample> _previous = [];
    private IReadOnlyList<GpuEngineUsage>? _last;
    private long _lastAt;

    /// <summary>How long the last category read and calculation took, for diagnostics.</summary>
    public long LastDurationMs { get; private set; }

    /// <summary>Instances seen on the last read (including ones still waiting for a baseline).</summary>
    public int LastInstanceCount { get; private set; }

    /// <summary>
    /// Every engine instance with its load, idle ones included (an idle engine is 0%, which is a real answer).
    /// Null while the first baseline is being taken or when the counters do not exist: the load is then unknown, not 0.
    /// </summary>
    public IReadOnlyList<GpuEngineUsage>? Sample()
    {
        lock (_gate)
        {
            var now = Environment.TickCount64;
            if (_last is not null && now - _lastAt < MinInterval.TotalMilliseconds) return _last;

            var watch = Stopwatch.StartNew();
            var current = ReadCategorySamples();
            if (current is null) return null;

            var fresh = new List<GpuEngineUsage>(current.Count);
            foreach (var (name, sample) in current)
            {
                if (!_previous.TryGetValue(name, out var before)) continue;     // new instance: baseline only
                if (sample.TimeStamp100nSec == before.TimeStamp100nSec && sample.TimeStamp == before.TimeStamp) continue;
                try
                {
                    var value = CounterSample.Calculate(before, sample);
                    if (float.IsNaN(value) || float.IsInfinity(value)) continue;
                    fresh.Add(new GpuEngineUsage(name, Math.Round(Math.Clamp(value, 0f, 100f), 2)));
                }
                catch (Exception ex) when (ex is InvalidOperationException or DivideByZeroException or OverflowException) { }
            }

            var hadBaseline = _previous.Count > 0;
            _previous = current;
            _lastAt = now;
            LastInstanceCount = current.Count;
            LastDurationMs = watch.ElapsedMilliseconds;
            _last = hadBaseline ? fresh : null;
            return _last;
        }
    }

    private static Dictionary<string, CounterSample>? ReadCategorySamples()
    {
        try
        {
            if (!PerformanceCounterCategory.Exists(Category)) return null;
            var data = new PerformanceCounterCategory(Category).ReadCategory();
            if (!data.Contains(CounterName)) return null;

            var result = new Dictionary<string, CounterSample>(StringComparer.Ordinal);
            foreach (InstanceData instance in data[CounterName].Values)
            {
                result[instance.InstanceName] = instance.Sample;
            }
            return result;
        }
        catch (Exception ex) when (ex is InvalidOperationException or UnauthorizedAccessException or System.ComponentModel.Win32Exception or ArgumentException or IOException)
        {
            return null;
        }
    }
}
