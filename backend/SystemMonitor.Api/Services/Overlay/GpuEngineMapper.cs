using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Puts the engine's live GPU numbers onto the adapters the GPU page knows. The engine and the hardware collectors
/// enumerate adapters independently, so each adapter is paired by the strongest identity both sides share: Windows
/// LUID, then PCI address, then PCI vendor+device id, then exact name, and only a lone adapter is paired by elimination.
/// An adapter the engine does not see gets an explanation, never a borrowed number.
/// </summary>
public static class GpuEngineMapper
{
    public static IReadOnlyList<GpuLiveReading> Map(IReadOnlyList<GpuAdapter> adapters, IReadOnlyList<OverlayGpu> gpus)
    {
        var used = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<GpuLiveReading>(adapters.Count);
        foreach (var adapter in adapters)
        {
            var match = Find(adapter, gpus, used, adapters.Count);
            if (match is null) { result.Add(Empty(adapter.Id, "The live monitor does not see this adapter.")); continue; }
            used.Add(match.Id);
            result.Add(ToReading(adapter.Id, match));
        }
        return result;
    }

    private static OverlayGpu? Find(GpuAdapter a, IReadOnlyList<OverlayGpu> gpus, HashSet<string> used, int adapterCount)
    {
        var free = gpus.Where(g => !used.Contains(g.Id)).ToList();
        OverlayGpu? One(Func<OverlayGpu, bool> test) => free.FirstOrDefault(test);

        if (a.Luid is { } luid && One(g => string.Equals(g.Luid, luid.ToString("x"), StringComparison.OrdinalIgnoreCase)) is { } byLuid) return byLuid;
        if (GpuMath.NormalizePci(a.PciAddress) is { } pci && One(g => GpuMath.NormalizePci(g.PciAddress) == pci) is { } byPci) return byPci;
        if (a.VendorId is { } v && a.DeviceId is { } d &&
            One(g => string.Equals(g.VendorId, v, StringComparison.OrdinalIgnoreCase) && string.Equals(g.DeviceId, d, StringComparison.OrdinalIgnoreCase)) is { } byIds) return byIds;
        if (One(g => string.Equals(g.Name.Trim(), a.Name.Trim(), StringComparison.OrdinalIgnoreCase)) is { } byName) return byName;
        return adapterCount == 1 && gpus.Count == 1 ? gpus[0] : null;
    }

    private static GpuLiveReading ToReading(string id, OverlayGpu g) => new(
        Id: id,
        UtilizationPercent: g.UtilizationPercent,
        MemoryUsedBytes: g.MemoryUsedBytes,
        MemoryTotalBytes: g.MemoryTotalBytes,
        SharedMemoryUsedBytes: g.SharedUsedBytes,
        MemoryUsagePercent: g.MemoryPercent,
        TemperatureC: g.TemperatureC,
        MemoryTemperatureC: null,
        CoreClockMhz: Round(g.CoreClockMhz),
        MemoryClockMhz: Round(g.MemoryClockMhz),
        PowerWatts: g.PowerWatts,
        PowerLimitWatts: g.PowerLimitWatts,
        FanRpm: null,
        FanPercent: Round(g.FanPercent),
        VoltageV: null,
        PerformanceState: g.PerformanceState,
        Engines: g.Engines.Select(e => new GpuEngineUsage(e.Name, e.Percent)).ToList(),
        Source: g.Source.Utilization ?? g.Source.Temperature ?? g.Source.Memory,
        Note: g.Note);

    private static int? Round(double? v) => v is { } x ? (int)Math.Round(x) : null;

    private static GpuLiveReading Empty(string id, string note) =>
        new(id, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, note);
}

/// <summary>NVIDIA identity data for the hardware collectors, taken from the engine's own NVIDIA driver session.</summary>
public sealed class OverlayNvmlInfo : INvmlSource
{
    private readonly OverlayService _overlay;
    public OverlayNvmlInfo(OverlayService overlay) => _overlay = overlay;

    private OverlaySnapshot? Snapshot() => _overlay.ReadWhenReadyAsync(TimeSpan.FromSeconds(3)).GetAwaiter().GetResult();

    public IReadOnlyList<NvmlDevice> Devices =>
        Snapshot()?.Gpus.Where(g => g.VendorId is "0x10de" && g.Source.Utilization == "nvml")
            .Select(g => new NvmlDevice(g.Name, g.PciAddress, g.VendorId, g.DeviceId, g.DedicatedBytes)).ToList() ?? [];

    public bool IsAvailable => Devices.Count > 0;

    public string? DriverVersion => Snapshot()?.Gpus.Select(g => g.DriverVersion).FirstOrDefault(v => v is not null);
}

/// <summary>Live GPU readings straight from the engine's latest snapshot.</summary>
public sealed class EngineGpuLiveSource : IGpuLiveSource
{
    private readonly OverlayService _overlay;
    public EngineGpuLiveSource(OverlayService overlay) => _overlay = overlay;

    public IReadOnlyList<GpuLiveReading> Read(IReadOnlyList<GpuAdapter> adapters) =>
        _overlay.Read() is { } snapshot ? GpuEngineMapper.Map(adapters, snapshot.Gpus) : [];
}
