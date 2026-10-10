using System.Text.Json.Serialization;

namespace SystemMonitor.Api.Services;

// The CPU tab's data. Two layers:
//   NativeCpuDetail  — the native engine's document (native/src/cpu_detail.cpp): identity, topology, clock range, caches,
//                      instruction sets, per-core sensors, power, policy, activity. Parsed as-is.
//   CpuDetail        — what GET /api/system/cpu/detail returns: that document merged with the overlay engine's live
//                      per-processor load / clock / temperature, so this tab and the Overlay tab always agree.
// A null number means "not measurable on this machine": nothing here is ever a made-up 0.

public sealed record CpuDetailIdentity(
    string? Model, string? Vendor, string? Architecture, int? Family, int? ModelId, int? Stepping, bool? Virtualized);

public sealed record CpuDetailTopology(
    int? Packages, int? PhysicalCores, int? LogicalProcessors, int? PerformanceCores, int? EfficiencyCores, int? LowPowerCores);

/// <summary>One logical processor, in the overlay engine's order. Kind is set on hybrid CPUs only.</summary>
public sealed record CpuDetailLogical(int? CoreKey, string? Kind);

public sealed record CpuDetailFrequency(
    double? BaseMhz, string? BaseSource, double? MaxMhz, string? MaxSource, double? MinMhz, double? PolicyMaxMhz,
    string? Governor, string? Driver, string? Preference, bool? Boost);

public sealed record CpuDetailCache(int Level, string Type, long? TotalBytes, int Instances, long? PerInstanceBytes);

public sealed record CpuDetailSensor(string? Label, string? Kind, int? CoreKey, double? TempC, double? HighC, double? CriticalC);

public sealed record CpuDetailPower(double? PackageWatts, double? Limit1Watts, double? Limit2Watts, string? Source, string? Note);

public sealed record CpuDetailThrottle(long? PackageEvents, long? CoreEvents);

public sealed record CpuDetailTime(
    double? UserPercent, double? SystemPercent, double? IdlePercent, double? IowaitPercent, double? IrqPercent, double? StealPercent);

public sealed record CpuDetailActivity(
    double? Load1, double? Load5, double? Load15, double? RunnableTasks, double? QueueLength, double? Threads, double? Processes,
    double? ContextSwitchesPerSec, double? InterruptsPerSec, double? SystemCallsPerSec);

public sealed record NativeCpuDetail(
    int Schema, long SampledAtMs, string Platform,
    CpuDetailIdentity Identity, CpuDetailTopology Topology, IReadOnlyList<CpuDetailLogical> Logical,
    CpuDetailFrequency Frequency, IReadOnlyList<CpuDetailCache> Caches, IReadOnlyList<string> Features,
    IReadOnlyList<CpuDetailSensor> Sensors, string? SensorsNote, CpuDetailPower Power, CpuDetailThrottle Throttle,
    CpuDetailTime Time, [property: JsonPropertyName("system")] CpuDetailActivity Activity);

/// <summary>Live whole-CPU readings from the overlay engine.</summary>
public sealed record CpuDetailLive(
    double? UsagePercent, double? TemperatureC, string? TemperatureSource, string? TemperatureNote,
    double? ClockMhz, double? HighestClockMhz, double? LowestClockMhz, int? ActiveThreads, double? BusiestThreadPercent, string? Note);

/// <summary>One logical processor with its live load and clock; CoreKey / Kind / TemperatureC only when they can be matched honestly.</summary>
public sealed record CpuDetailCore(int Index, int? CoreKey, string? Kind, double? UsagePercent, double? Mhz, double? TemperatureC);

public sealed record CpuDetailTrend(int IntervalMs, IReadOnlyList<double?> Usage, IReadOnlyList<double?> Temperature);

public sealed record CpuDetail(
    string Platform, long SampledAtMs, int IntervalMs, long DetailSampledAtMs,
    CpuDetailIdentity Identity, CpuDetailTopology Topology,
    CpuDetailLive? Live, IReadOnlyList<CpuDetailCore> Cores,
    CpuDetailFrequency Frequency, IReadOnlyList<CpuDetailCache> Caches, IReadOnlyList<string> Features,
    IReadOnlyList<CpuDetailSensor> Sensors, string? SensorsNote,
    CpuDetailPower Power, CpuDetailThrottle Throttle, CpuDetailTime Time, CpuDetailActivity Activity,
    CpuDetailTrend History);
