using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>
/// One shared, short-lived copy of the latest battery reading. The history sampler, the dashboard snapshot (polled about once a
/// second) and <c>/api/system/battery</c> all need the battery, and on Windows every read is a driver enumeration plus IOCTLs, so
/// each caller asks for a reading no older than it can accept and only the first one that finds the copy too old reads the hardware.
/// Callers that arrive while a read is running wait for it and share its result. A failed read is never cached: it throws to the
/// caller exactly as a direct read would.
/// </summary>
public sealed class BatteryReadCache
{
    /// <summary>The dashboard shows the battery at most this stale (plug-in and unplug show within a few seconds).</summary>
    public const long DashboardMaxAgeMs = 3_000;

    private readonly ISystemInfoProvider _provider;
    private readonly object _gate = new();
    private BatteryInfo? _last;
    private long _lastAtMs;

    public BatteryReadCache(ISystemInfoProvider provider) => _provider = provider;

    /// <summary>The latest reading if it is younger than <paramref name="maxAgeMs"/>, otherwise a new one.</summary>
    public BatteryInfo Get(long maxAgeMs)
    {
        lock (_gate)
        {
            if (_last is not null && Environment.TickCount64 - _lastAtMs < maxAgeMs) return _last;
            var reading = _provider.GetBattery();
            _last = reading;
            _lastAtMs = Environment.TickCount64;
            return reading;
        }
    }
}
