using System.Runtime.Versioning;
using LibreHardwareMonitor.Hardware;
using Microsoft.Extensions.Logging;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Windows CPU temperatures through LibreHardwareMonitorLib. The native engine cannot read them on Windows (there is no public
/// API; the ACPI thermal zone is not the processor). Sampling happens on a pool thread: Read returns the last sample at once and
/// starts a refresh when it is older than <see cref="RefreshMs"/>, so an API request never waits on the driver.
/// If the library cannot start (no driver access, not elevated) the reason is kept and a retry happens at most once a minute.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class LibreHardwareCpuSensorSource : ICpuSensorSource, IDisposable
{
    public const int RefreshMs = OverlayService.SampleIntervalMs;
    private const long RetryAfterFailureMs = 60_000;

    private readonly ILogger<LibreHardwareCpuSensorSource> _log;
    private readonly object _gate = new();
    private readonly List<double?> _history = [];
    private Computer? _computer;
    private CpuSensorReading? _last;
    private long _lastRefreshTick;
    private long _lastFailureTick;
    private string? _failure;
    private int _refreshing;
    private bool _disposed;

    public LibreHardwareCpuSensorSource(ILogger<LibreHardwareCpuSensorSource> log) => _log = log;

    public CpuSensorReading? Read()
    {
        var now = Environment.TickCount64;
        bool due;
        lock (_gate)
        {
            due = !_disposed && (_last is null || now - _lastRefreshTick >= RefreshMs)
                  && (_failure is null || now - _lastFailureTick >= RetryAfterFailureMs);
            if (!due) return _last;
        }
        if (Interlocked.CompareExchange(ref _refreshing, 1, 0) == 0) _ = Task.Run(Refresh);
        lock (_gate) return _last;
    }

    private void Refresh()
    {
        try
        {
            var raw = new List<RawTemperature>();
            string? failure = null;
            try
            {
                if (_computer is null)
                {
                    var c = new Computer { IsCpuEnabled = true };
                    c.Open();
                    _computer = c;
                }
                foreach (var hardware in _computer.Hardware.Where(h => h.HardwareType == HardwareType.Cpu))
                {
                    Update(hardware);
                    var temps = Temperatures(hardware).ToList();
                    if (temps.Count == 0) continue;
                    raw.AddRange(temps);
                    break;   // the first processor that has temperature sensors; sockets are never merged
                }
            }
            catch (Exception ex)
            {
                failure = "The hardware sensor library could not read the processor (" + ex.GetType().Name + ").";
                _log.LogWarning(ex, "CPU temperature library failed.");
                CloseComputer();
            }

            if (failure is null && !raw.Any(r => CpuSensorSelection.Plausible(r.Value)))
                failure = CpuSensorSelection.ExplainMissingTemperature(
                    WindowsSensorAccess.IsElevated(), WindowsSensorAccess.SensorDriverRegistered());

            lock (_gate)
            {
                var reading = CpuSensorSelection.Select(raw, failure, _history);
                _history.Add(reading.PackageC);
                if (_history.Count > CpuSensorSelection.HistoryLength) _history.RemoveAt(0);
                _last = reading with { History = _history.ToArray() };
                _lastRefreshTick = Environment.TickCount64;
                _failure = failure;
                if (failure is not null) _lastFailureTick = _lastRefreshTick;
            }
        }
        finally
        {
            Volatile.Write(ref _refreshing, 0);
        }
    }

    private static void Update(IHardware hardware)
    {
        hardware.Update();
        foreach (var child in hardware.SubHardware) Update(child);
    }

    private static IEnumerable<RawTemperature> Temperatures(IHardware hardware)
    {
        foreach (var s in hardware.Sensors)
            if (s.SensorType == SensorType.Temperature) yield return new RawTemperature(s.Name, s.Value);
        foreach (var child in hardware.SubHardware)
            foreach (var t in Temperatures(child)) yield return t;
    }

    private void CloseComputer()
    {
        try { _computer?.Close(); } catch (Exception) { /* closing a half-open driver handle may fail; nothing to recover */ }
        _computer = null;
    }

    public void Dispose()
    {
        lock (_gate) _disposed = true;
        CloseComputer();
    }
}
