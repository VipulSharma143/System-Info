namespace SystemMonitor.Api.Services;

public static class NvmlMatching
{
    /// <summary>
    /// Pairs adapters (by name, as Windows has no PCI address for them) with NVML devices: exact names first, then
    /// the remaining NVIDIA adapters and devices in order. Entries are null for adapters with no NVML counterpart.
    /// </summary>
    public static NvmlDevice?[] ByName(IReadOnlyList<string?> adapterNames, IReadOnlyList<NvmlDevice> devices)
    {
        var result = new NvmlDevice?[adapterNames.Count];
        var taken = new bool[devices.Count];

        for (var i = 0; i < adapterNames.Count; i++)
        {
            for (var d = 0; d < devices.Count && result[i] is null; d++)
            {
                if (!taken[d] && string.Equals(adapterNames[i], devices[d].Name, StringComparison.OrdinalIgnoreCase))
                {
                    result[i] = devices[d];
                    taken[d] = true;
                }
            }
        }

        var next = 0;
        for (var i = 0; i < adapterNames.Count; i++)
        {
            if (result[i] is not null || adapterNames[i] is not { } name ||
                !name.Contains("NVIDIA", StringComparison.OrdinalIgnoreCase)) continue;
            while (next < devices.Count && taken[next]) next++;
            if (next >= devices.Count) break;
            result[i] = devices[next];
            taken[next] = true;
        }
        return result;
    }
}
