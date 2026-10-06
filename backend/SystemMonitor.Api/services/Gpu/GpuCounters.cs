using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Attributes Windows performance-counter instances to adapters. Every GPU's counters end in "_phys_0", so the
/// LUID in the instance name is the only reliable key; without one the counters are used only when there is a
/// single adapter, and are never guessed for several.
/// </summary>
public static class GpuCounters
{
    public static IReadOnlyList<GpuEngineUsage> EnginesFor(long? luid, bool onlyAdapter, IEnumerable<GpuEngineUsage> instances)
    {
        if (luid is null) return onlyAdapter ? instances.ToList() : [];
        return instances.Where(e => GpuMath.TryParseLuid(e.InstanceName, out var l) && l == luid).ToList();
    }

    public static (long? Dedicated, long? Shared)? MemoryFor(long? luid, bool onlyAdapter, IReadOnlyDictionary<long, (long? Dedicated, long? Shared)> memory)
    {
        if (luid is { } key) return memory.TryGetValue(key, out var found) ? found : null;
        return onlyAdapter && memory.Count == 1 ? memory.Values.First() : null;
    }

    /// <summary>
    /// DXGI's enumeration order differs from WMI's, so the DXGI entry for a WMI adapter is found by name and only
    /// accepted when exactly one entry fits (or when there is one adapter on each side).
    /// </summary>
    public static DxgiAdapter? MatchDxgi(string name, int adapterCount, IReadOnlyList<DxgiAdapter> dxgi)
    {
        var real = dxgi.Where(d => d.Name is not { } n || !n.Contains("Basic Render", StringComparison.OrdinalIgnoreCase)).ToList();
        if (adapterCount == 1 && real.Count == 1) return real[0];

        var matches = real.Where(d => d.Name is { Length: > 0 } &&
            (d.Name.Contains(name, StringComparison.OrdinalIgnoreCase) || name.Contains(d.Name, StringComparison.OrdinalIgnoreCase))).ToList();
        return matches.Count == 1 ? matches[0] : null;
    }
}
