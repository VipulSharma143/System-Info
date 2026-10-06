using System.Text.RegularExpressions;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

public static partial class GpuMath
{
    /// <summary>Used as a percentage of total, never above 100 (counters from different sources can disagree slightly).</summary>
    public static double? Percent(long? used, long? total) =>
        used is { } u && total is > 0 and var t ? Math.Round(Math.Min(100.0, u * 100.0 / t), 1) : null;

    [GeneratedRegex(@"luid_0x([0-9a-f]+)_0x([0-9a-f]+)", RegexOptions.IgnoreCase)]
    private static partial Regex LuidPattern();

    /// <summary>
    /// Packs the LUID in a counter instance name ("..._luid_0xHIGH_0xLOW_phys_0...") as (high &lt;&lt; 32) | low,
    /// the same layout the native layer reports. Two GPUs both end in "_phys_0", so the LUID is the only
    /// thing that tells their counters apart.
    /// </summary>
    public static bool TryParseLuid(string instanceName, out long luid)
    {
        luid = 0;
        var match = LuidPattern().Match(instanceName);
        if (!match.Success ||
            !uint.TryParse(match.Groups[1].Value, System.Globalization.NumberStyles.HexNumber, null, out var high) ||
            !uint.TryParse(match.Groups[2].Value, System.Globalization.NumberStyles.HexNumber, null, out var low)) return false;
        luid = (long)(((ulong)high << 32) | low);
        return true;
    }

    [GeneratedRegex(@"_eng_(\d+)_engtype_(.+)$", RegexOptions.IgnoreCase)]
    private static partial Regex EnginePattern();

    /// <summary>
    /// Windows reports one counter instance per process per engine. Task Manager sums the processes of each engine
    /// (capped at 100), so a single busy instance is not the engine's load. Returns one entry per engine, busiest first.
    /// </summary>
    public static IReadOnlyList<GpuEngineUsage> AggregateEngines(IEnumerable<GpuEngineUsage> instances)
    {
        var totals = new Dictionary<(int Index, string Type), double>();
        foreach (var instance in instances)
        {
            var match = EnginePattern().Match(instance.InstanceName);
            if (!match.Success) continue;
            var key = (int.Parse(match.Groups[1].Value), match.Groups[2].Value);
            totals[key] = totals.GetValueOrDefault(key) + instance.UsagePercent;
        }

        var ordered = totals.OrderByDescending(t => t.Value).Select(t => (t.Key, Value: Math.Round(Math.Min(100, t.Value), 1))).ToList();
        var duplicatedTypes = ordered.GroupBy(e => e.Key.Type).Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet();
        return ordered
            .Select(e => new GpuEngineUsage(duplicatedTypes.Contains(e.Key.Type) ? $"{e.Key.Type} {e.Key.Index}" : e.Key.Type, e.Value))
            .ToList();
    }
}
