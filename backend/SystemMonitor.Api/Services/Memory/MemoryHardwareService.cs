using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Native;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Serves the physical-memory and memory-health endpoints. DIMM manufacturer/part/serial/capacity do not
/// change while the app runs, so a successful read is cached for a long time; "unavailable" is retried
/// sooner (permissions or a late-loading native library can change between attempts).
/// </summary>
public sealed class MemoryHardwareService
{
    private const string CacheName = "memory-hardware";
    private static readonly TimeSpan FoundTtl = TimeSpan.FromHours(1);
    private static readonly TimeSpan MissingTtl = TimeSpan.FromMinutes(1);

    private readonly ILogger<MemoryHardwareService> _log;
    private readonly SystemInfoCache _cache;
    private readonly object _gate = new();       // guards the fields below
    private readonly object _readGate = new();   // one native read at a time
    private MemoryHardwareInfo? _cached;
    private MemoryHardwareInfo? _seed;           // last launch's reading, served until the first fresh read
    private long _cachedAt;

    public MemoryHardwareService(ILogger<MemoryHardwareService> log, SystemInfoCache cache)
    {
        _log = log;
        _cache = cache;
    }

    /// <summary>Loads the last launch's reading, then re-reads in the background and rewrites the cache.</summary>
    public async Task WarmUpAsync()
    {
        var seed = await _cache.ReadAsync<MemoryHardwareInfo>(CacheName, h => h.Available);
        lock (_gate) { if (_cached is null) _seed = seed; }
        await Task.Run(() => Refresh());
    }

    public MemoryHardwareInfo GetHardware()
    {
        lock (_gate)
        {
            if (IsFresh()) return _cached!;
            if (_seed is { } seed) return seed;
        }
        return Refresh();
    }

    private bool IsFresh() =>
        _cached is { } c &&
        TimeSpan.FromMilliseconds(Environment.TickCount64 - _cachedAt) < (c.Available ? FoundTtl : MissingTtl);

    private MemoryHardwareInfo Refresh()
    {
        lock (_readGate)
        {
            lock (_gate) { if (IsFresh()) return _cached!; }   // another caller read while this one waited

            var info = Read();
            lock (_gate)
            {
                _cached = info;
                _cachedAt = Environment.TickCount64;
                _seed = null;
            }
            // Only a successful read is worth keeping; "unavailable" is retried instead.
            if (info.Available) _ = _cache.WriteAsync(CacheName, info);
            return info;
        }
    }

    public MemoryHealth GetHealth()
    {
        var eccSupport = GetHardware().Summary?.EccSupport;

        long? corrected = null, uncorrected = null;
        if (OperatingSystem.IsLinux()) (corrected, uncorrected) = MemoryHealthReader.ReadEdac();

        var haveCounters = corrected is not null || uncorrected is not null;
        return new MemoryHealth(
            EccSupport: eccSupport,
            EccEnabled: null,            // no reliable cross-platform source; never guessed from capability
            CorrectedErrors: corrected,
            UncorrectedErrors: uncorrected,
            Source: haveCounters ? "edac" : "unavailable",
            Note: haveCounters ? null : "This system does not expose memory error counters.");
    }

    private MemoryHardwareInfo Read()
    {
        try
        {
            var summary = NativeHardware.GetMemoryHardwareSummary();
            var modules = NativeHardware.GetMemoryModules();

            // Only when nothing was read is the reason worth looking up.
            var note = summary is null && modules.Count == 0
                ? MemoryMapping.UnavailableNote(NativeHardware.GetMemoryHardwareStatus(), OperatingSystem.IsLinux())
                : "";

            return MemoryMapping.ToHardwareInfo(summary, modules, note);
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException or BadImageFormatException)
        {
            // Native engine missing, or built before the memory-hardware exports existed.
            _log.LogWarning(ex, "Native memory hardware API is unavailable.");
            return new MemoryHardwareInfo(false, null, Array.Empty<MemoryModule>(), "unavailable",
                MemoryMapping.UnavailableNote(null, OperatingSystem.IsLinux()));
        }
    }
}
