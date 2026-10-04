using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>
/// One aggregated reading for /api/system/all.
/// Same JSON shape the frontend already consumes, plus additive <c>unavailable</c> and <c>cached</c>
/// lists naming subsystems that could not be read / are shown from an earlier reading.
/// </summary>
public sealed record AggregateSnapshot(
    RamInfo Ram,
    CpuInfo Cpu,
    List<ProcessInfo> Processes,
    List<DiskInfo> Disks,
    List<NetworkInfo> Network,
    BatteryInfo Battery,
    IReadOnlyList<string> Unavailable,
    IReadOnlyList<string> Cached);

/// <summary>Disks and battery as last read (kept on disk between launches).</summary>
public sealed record SlowSections(List<DiskInfo> Disks, BatteryInfo Battery);

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
///    there has never been one;
///  - disks and battery can be slow on a cold start (waking drives, driver calls). If one has not answered
///    within <see cref="CachedGrace"/> and an earlier reading exists (this run, or the previous launch's cache),
///    that reading is returned and named in <c>cached</c> while the live read finishes for the next poll.
/// </summary>
public sealed class SystemSnapshotService
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMilliseconds(750);
    private static readonly TimeSpan SectionTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan CachedGrace = TimeSpan.FromMilliseconds(300);
    private static readonly long PersistIntervalMs = 30_000;
    private const string CacheName = "dashboard";

    private readonly ISystemInfoProvider _provider;
    private readonly SystemMonitorBackgroundService _sampler;
    private readonly ILogger<SystemSnapshotService> _log;
    private readonly SystemInfoCache _cache;
    private readonly Lazy<Task> _warmUp;

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<string, Task> _running = new();   // only touched inside _gate
    private readonly Dictionary<string, long> _startedAt = new(); // only touched inside _gate
    private AggregateSnapshot? _cached;
    private long _cachedAt;                                        // Environment.TickCount64
    private RamInfo? _lastRam;
    private List<DiskInfo>? _lastDisks;
    private BatteryInfo? _lastBattery;
    private long _persistedAt;

    public SystemSnapshotService(
        ISystemInfoProvider provider,
        SystemMonitorBackgroundService sampler,
        SystemInfoCache cache,
        ILogger<SystemSnapshotService> log)
    {
        _provider = provider;
        _sampler = sampler;
        _cache = cache;
        _log = log;
        _warmUp = new Lazy<Task>(() => Task.Run(LoadCachedAsync));
    }

    /// <summary>Loads the previous launch's disks/battery. Cheap, and never needed to answer a request.</summary>
    public Task WarmUpAsync() => _warmUp.Value;

    private async Task LoadCachedAsync()
    {
        var saved = await _cache.ReadAsync<SlowSections>(CacheName, c => c.Disks is not null && c.Battery is not null);
        if (saved is null) return;
        // Live results of this run always win over the file.
        _lastDisks ??= saved.Disks;
        _lastBattery ??= saved.Battery;
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
        var cached = new List<string>();
        var (disks, diskOk) = await AwaitSection("disks", diskT, new List<DiskInfo>(), ct, _lastDisks, cached);
        var (battery, batOk) = await AwaitSection("battery", batT, (BatteryInfo?)null, ct, _lastBattery, cached);

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

        if (!cached.Contains("disks") && diskOk && disks is not null) _lastDisks = disks;
        if (!cached.Contains("battery") && batOk && battery is not null) _lastBattery = battery;
        PersistIfDue(cached);

        return new AggregateSnapshot(ram, cpu, processes ?? new(), disks ?? new(), network, battery, unavailable, cached);
    }

    private void PersistIfDue(List<string> cached)
    {
        if (cached.Count > 0 || _lastDisks is null || _lastBattery is null) return;
        var now = Environment.TickCount64;
        if (_persistedAt != 0 && now - _persistedAt < PersistIntervalMs) return;
        _persistedAt = now;
        _ = _cache.WriteAsync(CacheName, new SlowSections(_lastDisks, _lastBattery));
    }

    private TimeSpan Age(string name) =>
        _startedAt.TryGetValue(name, out var at) ? TimeSpan.FromMilliseconds(Environment.TickCount64 - at) : TimeSpan.Zero;

    private Task<T> StartSection<T>(string name, Func<Task<T>> work)
    {
        if (_running.TryGetValue(name, out var existing) && !existing.IsCompleted)
        {
            return (Task<T>)existing;       // previous run still going: wait for it, don't start another
        }
        var task = Task.Run(work);          // off the request thread; sync WMI/IO never blocks Kestrel
        _running[name] = task;
        _startedAt[name] = Environment.TickCount64;
        return task;
    }

    private async Task<(T? Value, bool Ok)> AwaitSection<T>(
        string name, Task<T> task, T? fallback, CancellationToken ct, T? lastKnown = null, List<string>? cached = null)
        where T : class
    {
        try
        {
            // Slow read with an earlier reading to show: answer with that now (still inside the section timeout,
            // so a wedged read is eventually reported as unavailable, not shown as stale forever).
            if (lastKnown is not null && cached is not null && !task.IsCompleted && Age(name) < SectionTimeout)
            {
                await Task.WhenAny(task, Task.Delay(CachedGrace, ct));
                if (!task.IsCompleted)
                {
                    cached.Add(name);
                    return (lastKnown, true);
                }
            }

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
