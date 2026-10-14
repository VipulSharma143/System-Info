using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Samples CPU and network once a second into an in-memory cache that the endpoints read, and
/// queues one snapshot line per sample for the local history.
/// </summary>
public sealed class SystemMonitorBackgroundService : BackgroundService
{
    private static readonly TimeSpan DefaultSampleInterval = TimeSpan.FromSeconds(1);

    // The cache is filled from the first sample so the UI has CPU data immediately. History
    // logging starts later so the backend's own JIT/Kestrel start-up load is not recorded as
    // system load.
    private static readonly long DefaultLoggingWarmUpMs = 3_000;

    // Batching interval for disk writes (see LocalJsonSnapshotStore).
    private static readonly long FlushIntervalMs = 5_000;

    // Battery changes slowly and, on Windows, costs a driver IOCTL: refresh it less often.
    private static readonly long DefaultBatteryRefreshMs = 10_000;

    private readonly TimeSpan _sampleInterval;
    private readonly long _loggingWarmUpMs;
    private readonly long _batteryRefreshMs;

    /// <summary>
    /// Whether the battery should be read now. <paramref name="lastMs"/> is null until the first read, which is due at once.
    /// (An earlier version started the "last read" at long.MinValue, and now − long.MinValue overflows to a negative number, so the
    /// check was never true: the battery was never read, never reached the history, and nothing was recorded.)
    /// </summary>
    public static bool BatteryReadDue(long nowMs, long? lastMs, long refreshMs) => lastMs is null || nowMs - lastMs.Value >= refreshMs;

    /// <summary>
    /// A battery reading that has not been refreshed for this many refresh periods no longer describes the battery. Without this a
    /// failing reader would keep feeding its last good value to the history as if it were new, and the Battery page could never
    /// report that readings had stopped.
    /// </summary>
    private const int BatteryValidForRefreshes = 2;

    private readonly ISystemInfoProvider _provider;
    private readonly BatteryReadCache? _batteryCache;
    private readonly ILogger<SystemMonitorBackgroundService> _log;
    private readonly object _lock = new();
    private CpuInfo? _cpu;
    private List<NetworkInfo>? _network;
    private string? _lastError;

    /// <param name="sampleInterval">How often CPU and network are sampled (default 1 s). The three optional timings exist so a test can run the real loop in seconds.</param>
    /// <param name="batteryCache">Shared battery reads (see <see cref="BatteryReadCache"/>); without one the provider is read directly.</param>
    public SystemMonitorBackgroundService(ISystemInfoProvider provider, ILogger<SystemMonitorBackgroundService> log,
        TimeSpan? sampleInterval = null, long? loggingWarmUpMs = null, long? batteryRefreshMs = null, BatteryReadCache? batteryCache = null)
    {
        _provider = provider;
        _batteryCache = batteryCache;
        _log = log;
        _sampleInterval = sampleInterval ?? DefaultSampleInterval;
        _loggingWarmUpMs = loggingWarmUpMs ?? DefaultLoggingWarmUpMs;
        _batteryRefreshMs = batteryRefreshMs ?? DefaultBatteryRefreshMs;
    }

    public CpuInfo? GetCachedCpu() { lock (_lock) return _cpu; }

    public List<NetworkInfo>? GetCachedNetwork() { lock (_lock) return _network; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Never hold up host start-up with the first sample.
        await Task.Yield();

        long startedAt = Environment.TickCount64, lastFlush = startedAt;
        long? lastBattery = null;
        long batteryAt = 0;
        string? lastBatteryError = null;
        BatteryInfo? battery = null;
        bool primed = false;
        using var timer = new PeriodicTimer(_sampleInterval);

        try
        {
            do
            {
                try
                {
                    var cpuTask = _provider.GetCpuAsync();
                    var netTask = _provider.GetNetworkAsync();
                    var cpu = (await cpuTask) with { SampledAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
                    var network = await netTask;

                    // The first reading spans the backend's own start-up work, so it is a
                    // measurement of the app, not the machine: keep it out of the cache and
                    // report CPU as "not ready yet" for the one second until the next sample.
                    lock (_lock)
                    {
                        if (primed) _cpu = cpu;
                        _network = network;
                    }
                    if (!primed) { primed = true; continue; }

                    var now = Environment.TickCount64;
                    if (now - startedAt >= _loggingWarmUpMs)
                    {
                        // Set only on the sample that actually took a reading: that one carries the battery in its saved line,
                        // the samples in between would only repeat it.
                        BatteryInfo? fresh = null;
                        if (BatteryReadDue(now, lastBattery, _batteryRefreshMs))
                        {
                            // Its own guard: a battery driver error must not stop the CPU and network history, and is retried at the next refresh.
                            try
                            {
                                battery = _batteryCache?.Get(_batteryRefreshMs) ?? _provider.GetBattery();
                                batteryAt = now;
                                fresh = battery;
                                lastBatteryError = null;
                            }
                            catch (Exception ex) when (ex is not OperationCanceledException)
                            {
                                if (lastBatteryError != ex.Message) { lastBatteryError = ex.Message; _log.LogWarning(ex, "Reading the battery failed; will keep retrying."); }
                            }
                            lastBattery = now;
                        }
                        var current = now - batteryAt <= _batteryRefreshMs * BatteryValidForRefreshes ? battery : null;
                        SnapshotLogger.Append(cpu, network, current, writeBatteryField: fresh is not null);
                    }

                    if (now - lastFlush >= FlushIntervalMs)
                    {
                        SnapshotLogger.Flush();
                        lastFlush = now;
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // A transient read failure must not end sampling, but is logged once per
                    // distinct error; the timer's fixed period already prevents a busy loop.
                    if (_lastError != ex.Message)
                    {
                        _lastError = ex.Message;
                        _log.LogWarning(ex, "System sampling failed; will keep retrying.");
                    }
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException)
        {
            // shutting down
        }
        finally
        {
            SnapshotLogger.Flush();
        }
    }
}
