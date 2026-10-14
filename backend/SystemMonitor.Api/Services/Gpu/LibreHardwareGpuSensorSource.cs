using System.Runtime.Versioning;
using LibreHardwareMonitor.Hardware;
using Microsoft.Extensions.Logging;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Windows integrated-GPU temperature through LibreHardwareMonitorLib (Intel through the graphics driver's telemetry, AMD through
/// its driver API). Same contract as <see cref="LibreHardwareCpuSensorSource"/>: Read returns the last sample at once and starts a
/// refresh on a pool thread when it is older than <see cref="RefreshMs"/>, so an API request never waits on a driver.
///
/// Why it owns a separate <c>Computer</c> and why that Computer is never closed while the app runs:
///   * The library only builds its Intel GPU group when the CPU group is enabled too, so both flags are set. Only the Intel and AMD
///     GPU hardware is ever updated; the CPU hardware that comes with it is never polled.
///   * <c>Computer.Close()</c> ends process-wide static state (OpCode delegates, mutexes) that the CPU sensor source's own
///     Computer depends on. Closing this one during a run could break CPU temperatures, so it is closed only in <see cref="Dispose"/>
///     at shutdown, and a failed refresh never reopens it (a failed Open leaves the library's static state intact).
///   * A separate instance also keeps a graphics-driver fault away from the CPU reader.
/// An integrated GPU temperature that the driver does not report stays null; nothing is estimated.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class LibreHardwareGpuSensorSource : IGpuSensorSource, IDisposable
{
    public const int RefreshMs = 1000;                     // an integrated GPU's temperature changes slowly; half the overlay cadence
    private const long RetryAfterFailureMs = 600_000;      // also the pause when the library lists no Intel/AMD adapter at all

    private readonly ILogger<LibreHardwareGpuSensorSource> _log;
    private readonly object _gate = new();                 // _last, _failure, ticks, _disposed
    private readonly object _hardware = new();             // Open / Update / Close, so Dispose waits for a running refresh
    private readonly Dictionary<string, List<double?>> _histories = [];
    private Computer? _computer;
    private GpuSensorSnapshot? _last;
    private long _lastRefreshTick;
    private long _nextDelayMs = RefreshMs;
    private int _refreshing;
    private bool _disposed;

    public LibreHardwareGpuSensorSource(ILogger<LibreHardwareGpuSensorSource> log) => _log = log;

    public GpuSensorSnapshot? Read()
    {
        var now = Environment.TickCount64;
        lock (_gate)
        {
            if (_disposed || (_last is not null && now - _lastRefreshTick < _nextDelayMs)) return _last;
        }
        if (Interlocked.CompareExchange(ref _refreshing, 1, 0) == 0) _ = Task.Run(Refresh);
        lock (_gate) return _last;
    }

    private void Refresh()
    {
        try
        {
            GpuSensorSnapshot snapshot;
            long nextDelay = RefreshMs;
            lock (_hardware)
            {
                lock (_gate) { if (_disposed) return; }
                try
                {
                    if (_computer is null)
                    {
                        var c = new Computer { IsCpuEnabled = true, IsGpuEnabled = true };
                        c.Open();
                        _computer = c;
                    }

                    var adapters = new List<GpuSensorAdapter>();
                    foreach (var hardware in _computer.Hardware)
                    {
                        if (hardware.HardwareType is not (HardwareType.GpuIntel or HardwareType.GpuAmd)) continue;
                        hardware.Update();
                        var raw = hardware.Sensors
                            .Where(s => s.SensorType == SensorType.Temperature)
                            .Select(s => new RawTemperature(s.Name, s.Value))
                            .ToList();
                        var core = GpuSensorSelection.PickCore(raw);

                        var key = hardware.Identifier.ToString();
                        if (!_histories.TryGetValue(key, out var history)) _histories[key] = history = [];
                        history.Add(core);
                        if (history.Count > GpuSensorSelection.HistoryLength) history.RemoveAt(0);

                        var vendor = hardware.HardwareType == HardwareType.GpuIntel ? GpuSensorSelection.IntelVendorId : GpuSensorSelection.AmdVendorId;
                        adapters.Add(new GpuSensorAdapter(vendor, hardware.Name, core, history.ToArray()));
                    }
                    snapshot = new GpuSensorSnapshot(adapters, null);
                    if (adapters.Count == 0) nextDelay = RetryAfterFailureMs;   // nothing to poll; look again only rarely
                }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "Integrated GPU temperature library failed.");
                    snapshot = new GpuSensorSnapshot([], "The hardware sensor library could not read the graphics adapters (" + ex.GetType().Name + ").");
                    nextDelay = RetryAfterFailureMs;
                }
            }

            lock (_gate)
            {
                _last = snapshot;
                _lastRefreshTick = Environment.TickCount64;
                _nextDelayMs = nextDelay;
            }
        }
        finally
        {
            Volatile.Write(ref _refreshing, 0);
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
        }
        lock (_hardware)   // waits for a refresh that is already running
        {
            try { _computer?.Close(); } catch (Exception) { /* closing a half-open driver handle may fail; nothing to recover */ }
            _computer = null;
        }
    }
}
