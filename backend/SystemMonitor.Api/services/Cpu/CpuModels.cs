namespace SystemMonitor.Api.Services;

/// <summary>
/// One logical processor. Null means the platform did not report it. <paramref name="CoreId"/> is shared by the SMT
/// siblings of one physical core; <paramref name="CoreType"/> is "performance" or "efficiency" on hybrid CPUs and null otherwise.
/// </summary>
public sealed record CpuCoreReading(int Index, double? UsagePercent, int? ClockMhz, double? TemperatureC, int? CoreId = null, string? CoreType = null);

/// <summary>
/// Static shape of the processor. The core counts are exact only when the OS reports the hybrid split;
/// otherwise <see cref="Hybrid"/> is false and the performance/efficiency counts are null, never inferred.
/// </summary>
public sealed record CpuLayout(
    int LogicalProcessors,
    int? PhysicalCores,
    bool Hybrid,
    int? PerformanceCores,
    int? EfficiencyCores,
    int? PerformanceThreads,
    int? EfficiencyThreads);

/// <summary>Live CPU detail. Null means the platform did not report it, never zero.</summary>
public sealed record CpuDetail(
    double? TotalUsagePercent,
    IReadOnlyList<CpuCoreReading> Cores,
    int? AverageClockMhz,
    int? HighestClockMhz,
    int? BaseClockMhz,
    int? MaxClockMhz,
    double? PackageTemperatureC,
    double? PowerWatts,
    IReadOnlyList<double>? LoadAverage,
    string? TemperatureSource,
    string? Note,
    long SampledAtUnixMs,
    CpuLayout? Layout = null,
    double? SystemTemperatureC = null,
    string? SystemTemperatureSource = null);

/// <summary>Reads CPU telemetry for one platform. Usage and power are deltas, so the first read has no usage.</summary>
public interface ICpuCollector
{
    CpuDetail Read();
}
