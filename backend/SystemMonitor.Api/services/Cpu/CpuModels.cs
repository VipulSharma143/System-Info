namespace SystemMonitor.Api.Services;

/// <summary>One logical processor. Null means the platform did not report it.</summary>
public sealed record CpuCoreReading(int Index, double? UsagePercent, int? ClockMhz, double? TemperatureC);

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
    long SampledAtUnixMs);

/// <summary>Reads CPU telemetry for one platform. Usage and power are deltas, so the first read has no usage.</summary>
public interface ICpuCollector
{
    CpuDetail Read();
}
