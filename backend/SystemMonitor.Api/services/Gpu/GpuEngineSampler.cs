using System.Diagnostics;
using System.Runtime.Versioning;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Samples the Windows "GPU Engine" counters with counters that live between polls. The old approach built a
/// counter for every engine instance on every call and compared two reads 200 ms apart, which is far shorter than the
/// window the counter is computed over, so busy engines could read as idle. Here each counter's baseline is the
/// previous poll, so every reading covers a full polling interval, and counters are only created for new instances.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class GpuEngineSampler : IDisposable
{
    public static GpuEngineSampler Shared { get; } = new();

    private const string Category = "GPU Engine";
    private const string CounterName = "Utilization Percentage";

    // Two reads closer than this would compare nearly identical timestamps; reuse the last answer instead.
    private static readonly TimeSpan MinInterval = TimeSpan.FromMilliseconds(700);

    private readonly object _gate = new();
    private readonly Dictionary<string, PerformanceCounter> _counters = [];
    private IReadOnlyList<GpuEngineUsage>? _last;
    private long _lastAt;

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

            string[] names;
            try
            {
                if (!PerformanceCounterCategory.Exists(Category)) return null;
                names = new PerformanceCounterCategory(Category).GetInstanceNames();
            }
            catch (Exception ex) when (IsCounterFailure(ex))
            {
                return null;
            }

            var live = new HashSet<string>(names, StringComparer.Ordinal);
            foreach (var gone in _counters.Keys.Where(k => !live.Contains(k)).ToList())
            {
                _counters[gone].Dispose();
                _counters.Remove(gone);
            }

            var fresh = new List<GpuEngineUsage>(_counters.Count);
            var hadBaseline = _counters.Count > 0;
            foreach (var name in names)
            {
                if (_counters.TryGetValue(name, out var existing))
                {
                    try
                    {
                        fresh.Add(new GpuEngineUsage(name, Math.Round(Math.Clamp(existing.NextValue(), 0f, 100f), 2)));
                    }
                    catch (Exception ex) when (IsCounterFailure(ex))
                    {
                        existing.Dispose();
                        _counters.Remove(name);
                    }
                    continue;
                }

                try
                {
                    var counter = new PerformanceCounter(Category, CounterName, name, readOnly: true);
                    counter.NextValue();     // baseline; the first real value is read on the next poll
                    _counters[name] = counter;
                }
                catch (Exception ex) when (IsCounterFailure(ex))
                {
                    // The instance vanished between listing and opening.
                }
            }

            _lastAt = now;
            _last = hadBaseline ? fresh : null;
            return _last;
        }
    }

    private static bool IsCounterFailure(Exception ex) =>
        ex is InvalidOperationException or UnauthorizedAccessException or System.ComponentModel.Win32Exception or ArgumentException;

    public void Dispose()
    {
        lock (_gate)
        {
            foreach (var c in _counters.Values) c.Dispose();
            _counters.Clear();
            _last = null;
        }
    }
}
