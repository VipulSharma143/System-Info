using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>
/// One aggregated reading for /api/system/all.
/// Same JSON shape the frontend already consumes, plus an additive
/// <c>unavailable</c> list naming any subsystem that could not be read.
/// </summary>
public sealed record AggregateSnapshot(
    RamInfo Ram,
    CpuInfo Cpu,
    List<ProcessInfo> Processes,
    List<DiskInfo> Disks,
    List<NetworkInfo> Network,
    BatteryInfo Battery,
    IReadOnlyList<string> Unavailable);

/// <summary>
/// Builds the aggregated snapshot with per-subsystem failure isolation:
///  - each section runs off the request thread with its own timeout, so a
///    hung WMI/sysfs read cannot stall or fail the whole response;
///  - a section that is still running from an earlier request is awaited, not
///    started again, so a wedged query can never pile up unbounded work;
///  - concurrent requests share one build (single-flight) and a result younger
///    than <see cref="Ttl"/> is reused, so extra windows/polls do not multiply
///    hardware queries;
///  - failures are logged and reported in <c>unavailable</c> — never silently
///    turned into zeros. RAM (the one section the UI cannot render without)
///    falls back to the last good sample, or the request fails with 503 if
///    there has never been one.
/// </summary>
public sealed class SystemSnapshotService
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMilliseconds(750);
    private static readonly TimeSpan SectionTimeout = TimeSpan.FromSeconds(5);

    private readonly ISystemInfoProvider _provider;
    private readonly SystemMonitorBackgroundService _sampler;
    private readonly ILogger<SystemSnapshotService> _log;

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<string, Task> _running = new();   // only touched inside _gate
    private AggregateSnapshot? _cached;
    private long _cachedAt;                                        // Environment.TickCount64
    private RamInfo? _lastRam;

    public SystemSnapshotService(
        ISystemInfoProvider provider,
        SystemMonitorBackgroundService sampler,
        ILogger<SystemSnapshotService> log)
    {
        _provider = provider;
        _sampler = sampler;
        _log = log;
    }

    /// <summary>Null means RAM has never been readable: the caller should answer 503.</summary>
    public async Task<AggregateSnapshot?> GetAsync(CancellationToken ct)
    {
        if (TryFresh(out var fresh)) return fresh;

        await _gate.WaitAsync(ct);
        try
        {
            if (TryFresh(out fresh)) return fresh;
            var snap = await BuildAsync(ct);
            if (snap is not null)
            {
                _cached = snap;
                _cachedAt = Environment.TickCount64;
            }
            return snap;
        }
        finally
        {
            _gate.Release();
        }
    }

    private bool TryFresh(out AggregateSnapshot? snap)
    {
        var c = _cached;
        if (c is not null && Environment.TickCount64 - _cachedAt < Ttl.TotalMilliseconds)
        {
            snap = c;
            return true;
        }
        snap = null;
        return false;
    }

    private async Task<AggregateSnapshot?> BuildAsync(CancellationToken ct)
    {
        var unavailable = new List<string>();

        // Start every section first, then await: they run concurrently.
        var ramT = StartSection("ram", () => _provider.GetRamAsync());
        var procT = StartSection("processes", () => _provider.GetProcessesAsync());
        var diskT = StartSection("disks", () => Task.FromResult(_provider.GetDisks()));
        var batT = StartSection("battery", () => Task.FromResult(_provider.GetBattery()));

        var (ram, ramOk) = await AwaitSection("ram", ramT, (RamInfo?)null, ct);
        var (processes, procOk) = await AwaitSection("processes", procT, new List<ProcessInfo>(), ct);
        var (disks, diskOk) = await AwaitSection("disks", diskT, new List<DiskInfo>(), ct);
        var (battery, batOk) = await AwaitSection("battery", batT, (BatteryInfo?)null, ct);

        if (!procOk) unavailable.Add("processes");
        if (!diskOk) unavailable.Add("disks");
        if (!batOk || battery is null)
        {
            unavailable.Add("battery");
            battery = new BatteryInfo(false, null, null, null, null, null, null, null, null, null, null, null, null,
                "Battery information could not be read.");
        }

        if (ramOk && ram is not null)
        {
            _lastRam = ram;
        }
        else if (_lastRam is not null)
        {
            ram = _lastRam;                 // stale but real, and flagged
            unavailable.Add("ram");
        }
        else
        {
            _log.LogError("RAM has never been readable; /api/system/all cannot be served.");
            return null;
        }

        var cpu = _sampler.GetCachedCpu();
        if (cpu is null)
        {
            // First sample not ready yet. Keeps the existing contract (an object
            // with a number) but the client is told it is not a real reading.
            unavailable.Add("cpu");
            cpu = new CpuInfo(0);
        }

        var network = _sampler.GetCachedNetwork();
        if (network is null)
        {
            unavailable.Add("network");
            network = new List<NetworkInfo>();
        }

        return new AggregateSnapshot(ram, cpu, processes ?? new(), disks ?? new(), network, battery, unavailable);
    }

    private Task<T> StartSection<T>(string name, Func<Task<T>> work)
    {
        if (_running.TryGetValue(name, out var existing) && !existing.IsCompleted)
        {
            return (Task<T>)existing;       // previous run still going: wait for it, don't start another
        }
        var task = Task.Run(work);          // off the request thread; sync WMI/IO never blocks Kestrel
        _running[name] = task;
        return task;
    }

    private async Task<(T? Value, bool Ok)> AwaitSection<T>(string name, Task<T> task, T? fallback, CancellationToken ct)
    {
        try
        {
            var value = await task.WaitAsync(SectionTimeout, ct);
            return (value, true);
        }
        catch (TimeoutException)
        {
            _log.LogWarning("System section '{Section}' did not answer within {Seconds}s.", name, SectionTimeout.TotalSeconds);
            return (fallback, false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "System section '{Section}' failed.", name);
            return (fallback, false);
        }
    }
}
