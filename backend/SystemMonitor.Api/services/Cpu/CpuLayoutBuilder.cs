using SystemMonitor.Api.Native;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Turns the native per-logical-processor facts into core types and counts. Pure: the same input always gives the
/// same answer, and anything the OS did not say stays null instead of being guessed from the CPU model.
/// </summary>
public static class CpuLayoutBuilder
{
    public const string Performance = "performance";
    public const string Efficiency = "efficiency";

    /// <summary>The fastest class is the performance cores; every slower class (E-cores, low-power E-cores) is efficiency.</summary>
    public static string? CoreType(LogicalCpuInfo cpu) =>
        cpu.EfficiencyClass is { } cls && cpu.ClassCount is { } count and >= 2
            ? (cls == count - 1 ? Performance : Efficiency)
            : null;

    /// <summary>Attaches core id and type to the readings; only when the OS list matches the readings one to one.</summary>
    public static IReadOnlyList<CpuCoreReading> Annotate(IReadOnlyList<CpuCoreReading> cores, IReadOnlyList<LogicalCpuInfo> logical)
    {
        if (logical.Count == 0 || logical.Count != cores.Count) return cores;
        var result = new CpuCoreReading[cores.Count];
        for (var i = 0; i < cores.Count; i++)
        {
            result[i] = cores[i] with { CoreId = logical[i].CoreId, CoreType = CoreType(logical[i]) };
        }
        return result;
    }

    public static CpuLayout? Build(IReadOnlyList<LogicalCpuInfo> logical, int? physicalCores = null)
    {
        if (logical.Count == 0) return null;

        var types = logical.Select(CoreType).ToList();
        var hybrid = types.All(t => t is not null);

        int? Cores(string type)
        {
            if (!hybrid) return null;
            var count = logical.Where((_, i) => types[i] == type).Select(c => c.CoreId).Where(id => id is not null).Distinct().Count();
            return count > 0 ? count : null;
        }
        int? Threads(string type) => hybrid ? types.Count(t => t == type) : null;

        var knownCores = logical.Select(c => c.CoreId).Where(id => id is not null).Distinct().Count();
        return new CpuLayout(
            LogicalProcessors: logical.Count,
            PhysicalCores: physicalCores ?? (knownCores > 0 && logical.All(c => c.CoreId is not null) ? knownCores : null),
            Hybrid: hybrid,
            PerformanceCores: Cores(Performance),
            EfficiencyCores: Cores(Efficiency),
            PerformanceThreads: Threads(Performance),
            EfficiencyThreads: Threads(Efficiency));
    }
}
