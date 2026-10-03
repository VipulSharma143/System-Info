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
    private static readonly TimeSpan FoundTtl = TimeSpan.FromHours(1);
    private static readonly TimeSpan MissingTtl = TimeSpan.FromMinutes(1);

    private readonly ILogger<MemoryHardwareService> _log;
    private readonly object _gate = new();
    private MemoryHardwareInfo? _cached;
    private long _cachedAt;

    public MemoryHardwareService(ILogger<MemoryHardwareService> log) => _log = log;

    public MemoryHardwareInfo GetHardware()
    {
        lock (_gate)
        {
            if (_cached is { } c &&
                TimeSpan.FromMilliseconds(Environment.TickCount64 - _cachedAt) < (c.Available ? FoundTtl : MissingTtl))
                return c;

            _cached = Read();
            _cachedAt = Environment.TickCount64;
            return _cached;
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
