namespace SystemMonitor.Api.Services;

/// <summary>
/// Serves /api/system/sensors. Windows uses the library-backed source registered at start-up; everywhere else the sysfs reader
/// runs (a handful of small file reads, kept for a second so several open pages do not repeat them).
/// </summary>
public sealed class HardwareSensorService
{
    private static readonly TimeSpan Keep = TimeSpan.FromSeconds(1);
    private readonly IHardwareSensorSource? _source;
    private readonly string _sysRoot;
    private readonly Func<DateTime> _utcNow;
    private readonly object _gate = new();
    private HardwareSensors? _cached;
    private DateTime _cachedAt;

    public HardwareSensorService(IHardwareSensorSource? source = null, string sysRoot = "/sys", Func<DateTime>? utcNow = null)
    {
        _source = source;
        _sysRoot = sysRoot;
        _utcNow = utcNow ?? (() => DateTime.UtcNow);
    }

    public HardwareSensors Read()
    {
        if (_source is not null) return _source.Read() ?? Starting("windows", "sensor library");
        lock (_gate)
        {
            var now = _utcNow();
            if (_cached is null || now - _cachedAt >= Keep)
            {
                _cached = LinuxHwmonReader.Read(_sysRoot, new DateTimeOffset(now).ToUnixTimeMilliseconds());
                _cachedAt = now;
            }
            return _cached;
        }
    }

    /// <summary>The first answer while a library is still opening: not ready, no devices, no claim that nothing exists.</summary>
    public static HardwareSensors Starting(string platform, string source) =>
        new(false, platform, source, 0,
            new HwCategory([], HardwareSensorSelection.Reading), new HwCategory([], HardwareSensorSelection.Reading), new HwCategory([], HardwareSensorSelection.Reading));
}
