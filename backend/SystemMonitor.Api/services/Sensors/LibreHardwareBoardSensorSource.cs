using System.Runtime.Versioning;
using LibreHardwareMonitor.Hardware;
using Microsoft.Extensions.Logging;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Windows drive, motherboard (sensor chip and embedded controller) and memory-module sensors through LibreHardwareMonitorLib.
/// Same contract and lifecycle rules as <see cref="LibreHardwareGpuSensorSource"/>: Read returns the last sample at once and
/// refreshes on a pool thread; the library gets its own <c>Computer</c>, opened once and closed only at shutdown, because
/// <c>Computer.Close()</c> resets process-wide state that the CPU and GPU sources' Computers share. A failure here never reaches them.
///   * The CPU group is not enabled: nothing here needs it.
///   * Memory-module temperature reads the modules over the SMBus, which can misbehave on some computers, so it is off unless
///     SYSTEMINFO_DIMM_SENSORS=1 is set; the page says so instead of staying silent.
///   * Drive temperatures need administrator rights; the note says that when the app is not elevated.
/// Only readings that pass <see cref="HardwareSensorSelection"/> are shown.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class LibreHardwareBoardSensorSource : IHardwareSensorSource, IDisposable
{
    public const int RefreshMs = 2000;
    private const long RetryAfterFailureMs = 600_000;

    private readonly ILogger<LibreHardwareBoardSensorSource> _log;
    private readonly bool _dimmEnabled = Environment.GetEnvironmentVariable("SYSTEMINFO_DIMM_SENSORS") == "1";
    private readonly object _gate = new();
    private readonly object _hardware = new();
    private Computer? _computer;
    private HardwareSensors? _last;
    private long _lastRefreshTick;
    private long _nextDelayMs = RefreshMs;
    private int _refreshing;
    private bool _disposed;

    public LibreHardwareBoardSensorSource(ILogger<LibreHardwareBoardSensorSource> log) => _log = log;

    public HardwareSensors? Read()
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
            HardwareSensors snapshot;
            long nextDelay = RefreshMs;
            lock (_hardware)
            {
                lock (_gate) { if (_disposed) return; }
                try
                {
                    if (_computer is null)
                    {
                        var c = new Computer { IsStorageEnabled = true, IsMotherboardEnabled = true, IsControllerEnabled = true, IsMemoryEnabled = _dimmEnabled };
                        c.Open();
                        _computer = c;
                    }

                    var drives = new List<HwDevice>();
                    var board = new List<HwDevice>();
                    var memory = new List<HwDevice>();
                    foreach (var hardware in _computer.Hardware)
                    {
                        UpdateAll(hardware);
                        switch (hardware.HardwareType)
                        {
                            case HardwareType.Storage: Add(drives, hardware, "Drive"); break;
                            case HardwareType.Memory: Add(memory, hardware, "Memory module"); break;
                            case HardwareType.Motherboard:
                                Add(board, hardware, "Motherboard");
                                foreach (var chip in hardware.SubHardware) Add(board, chip, "Sensor chip");
                                break;
                            case HardwareType.EmbeddedController: Add(board, hardware, "Embedded controller"); break;
                        }
                    }

                    var elevated = WindowsSensorAccess.IsElevated();
                    snapshot = new HardwareSensors(true, "windows", "LibreHardwareMonitor", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        HardwareSensorSelection.Category(drives, elevated ? HardwareSensorSelection.DrivesNoneWindows : HardwareSensorSelection.DrivesNeedAdmin),
                        HardwareSensorSelection.Category(board, HardwareSensorSelection.BoardNoneWindows),
                        HardwareSensorSelection.Category(memory, _dimmEnabled ? HardwareSensorSelection.MemoryNoneWindows : HardwareSensorSelection.MemoryOffWindows));
                }
                catch (Exception ex)
                {
                    _log.LogWarning(ex, "Drive, motherboard and memory sensor library failed.");
                    var why = "The hardware sensor library could not read these sensors (" + ex.GetType().Name + ").";
                    snapshot = new HardwareSensors(true, "windows", "LibreHardwareMonitor", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        new HwCategory([], why), new HwCategory([], why), new HwCategory([], why));
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

    // What the library's own UpdateVisitor does: a Motherboard's SuperIO chips are sub-hardware and only report once updated.
    private static void UpdateAll(IHardware hardware)
    {
        hardware.Update();
        foreach (var sub in hardware.SubHardware) UpdateAll(sub);
    }

    private static void Add(List<HwDevice> into, IHardware hardware, string detail)
    {
        var sensors = HardwareSensorSelection.FromLibrary(hardware.Sensors.Select(s => new RawHwSensor(s.SensorType.ToString(), s.Name, s.Value)));
        if (sensors.Count > 0) into.Add(new HwDevice(hardware.Identifier.ToString(), hardware.Name, detail, sensors));
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
            try { _computer?.Close(); } catch (Exception) { /* a half-open driver handle may fail to close; nothing to recover */ }
            _computer = null;
        }
    }
}
