namespace SystemMonitor.Api.Services;

// The overlay engine's snapshot (native/src/overlay/overlay_engine.cpp). A null number means "not measurable here":
// the engine never reports 0 for something it could not read.

public sealed record OverlaySnapshot(
    int Schema, long Seq, long SampledAtMs, int IntervalMs, string Platform,
    OverlayEngineInfo Engine, OverlayCpu Cpu, OverlayRam Ram, IReadOnlyList<OverlayGpu> Gpus, OverlayHistory History);

/// <summary>How the engine itself is doing: which assembly tier runs, how long a cycle takes, and why a source is missing.</summary>
public sealed record OverlayEngineInfo(int Isa, int AsmDemotions, double CycleMs, string Nvml, string GpuCounters);

public sealed record OverlayCore(double? U, double? Mhz);

public sealed record OverlayCpu(
    double? UsagePercent, double? TemperatureC, string? TemperatureSource, string? TemperatureNote, double? ClockMhz,
    int LogicalProcessors, double? BusiestCorePercent, int? ActiveCores, IReadOnlyList<OverlayCore> Cores, string? Note);

public sealed record OverlayRam(
    long? TotalBytes, long? UsedBytes, long? AvailableBytes, double? UsedPercent, long? CachedBytes, long? SwapTotalBytes, long? SwapUsedBytes);

public sealed record OverlayEngineLoad(string Name, double Percent);

/// <summary>Which backend produced each GPU number, so a wrong-looking value can be traced.</summary>
public sealed record OverlayGpuSource(string? Utilization, string? Temperature, string? Memory);

public sealed record OverlayGpu(
    string Id, string Name, string? Luid, string? Vendor, string? Kind, string? PciAddress, string? VendorId, string? DeviceId,
    string? DriverVersion, long? DedicatedBytes, long? SharedBytes,
    double? UtilizationPercent, double? TemperatureC, long? MemoryUsedBytes, long? MemoryTotalBytes, double? MemoryPercent,
    long? SharedUsedBytes, double? PowerWatts, double? PowerLimitWatts, double? CoreClockMhz, double? MemoryClockMhz,
    double? FanPercent, string? PerformanceState, IReadOnlyList<OverlayEngineLoad> Engines, OverlayGpuSource Source, string? Note);

public sealed record OverlayGpuHistory(IReadOnlyList<double?> Usage, IReadOnlyList<double?> Temp, IReadOnlyList<double?> Memory);

public sealed record OverlayHistory(
    int IntervalMs, IReadOnlyList<double?> Cpu, IReadOnlyList<double?> CpuTemp, IReadOnlyList<double?> Ram,
    IReadOnlyDictionary<string, OverlayGpuHistory> Gpus);
