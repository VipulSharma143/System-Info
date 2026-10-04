using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Samples CPU and network once a second into an in-memory cache that the endpoints read, and
/// queues one snapshot line per sample for the local history.
/// </summary>
public sealed class SystemMonitorBackgroundService : BackgroundService
{
    private static readonly TimeSpan SampleInterval = TimeSpan.FromSeconds(1);

    // The cache is filled from the first sample so the UI has CPU data immediately. History
    // logging starts later so the backend's own JIT/Kestrel start-up load is not recorded as
    // system load.
    private static readonly long LoggingWarmUpMs = 3_000;

    // Batching interval for disk writes (see LocalJsonSnapshotStore).
    private static readonly long FlushIntervalMs = 5_000;

    // Battery changes slowly and, on Windows, costs a driver IOCTL: refresh it less often.
    private static readonly long BatteryRefreshMs = 10_000;

    private readonly ISystemInfoProvider _provider;
    private readonly ILogger<SystemMonitorBackgroundService> _log;
    private readonly object _lock = new();
    private CpuInfo? _cpu;
    private List<NetworkInfo>? _network;
    private string? _lastError;

    public SystemMonitorBackgroundService(ISystemInfoProvider provider, ILogger<SystemMonitorBackgroundService> log)
    {
        _provider = provider;
        _log = log;
    }

    public CpuInfo? GetCachedCpu() { lock (_lock) return _cpu; }

    public List<NetworkInfo>? GetCachedNetwork() { lock (_lock) return _network; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Never hold up host start-up with the first sample.
        await Task.Yield();

        long startedAt = Environment.TickCount64, lastFlush = startedAt, lastBattery = long.MinValue;
        BatteryInfo? battery = null;
        bool primed = false;
        using var timer = new PeriodicTimer(SampleInterval);

        try
        {
            do
            {
                try
                {
                    var cpuTask = _provider.GetCpuAsync();
                    var netTask = _provider.GetNetworkAsync();
                    var cpu = await cpuTask;
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
                    if (now - startedAt >= LoggingWarmUpMs)
                    {
                        if (now - lastBattery >= BatteryRefreshMs)
                        {
                            battery = _provider.GetBattery();
                            lastBattery = now;
                        }
                        SnapshotLogger.Append(cpu, network, battery);
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
