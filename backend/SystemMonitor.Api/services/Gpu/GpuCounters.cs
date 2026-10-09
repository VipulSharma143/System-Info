using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>Pairs a WMI adapter with its DXGI entry (which carries the LUID); never guessed when ambiguous.</summary>
public static class GpuCounters
{
    public static DxgiAdapter? MatchDxgi(string name, int adapterCount, IReadOnlyList<DxgiAdapter> dxgi)
    {
        var real = dxgi.Where(d => d.Name is not { } n || !n.Contains("Basic Render", StringComparison.OrdinalIgnoreCase)).ToList();
        if (adapterCount == 1 && real.Count == 1) return real[0];

        var matches = real.Where(d => d.Name is { Length: > 0 } &&
            (d.Name.Contains(name, StringComparison.OrdinalIgnoreCase) || name.Contains(d.Name, StringComparison.OrdinalIgnoreCase))).ToList();
        return matches.Count == 1 ? matches[0] : null;
    }
}
