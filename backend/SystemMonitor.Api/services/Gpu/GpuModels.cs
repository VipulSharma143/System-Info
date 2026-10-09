using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>Stable facts about one display adapter. Null means the platform did not report it, never zero.</summary>
public sealed record GpuAdapter(
    string Id,
    int Index,
    string Name,
    string? Vendor,
    string? VendorId,
    string? DeviceId,
    string? PciAddress,
    string? Driver,
    string? DriverVersion,
    string? DriverDate,
    bool? Integrated,
    bool? Primary,
    long? DedicatedMemoryBytes,
    long? SharedMemoryBytes,
    long? Luid = null);

/// <summary>
/// One live sample for the adapter with the same <see cref="Id"/>. Null means the platform did not report it.
/// <see cref="MemoryUsedBytes"/> and <see cref="MemoryTotalBytes"/> are the pair <see cref="MemoryUsagePercent"/> is
/// computed from: dedicated VRAM for discrete GPUs, dedicated + shared system memory for integrated ones.
/// </summary>
public sealed record GpuLiveReading(
    string Id,
    double? UtilizationPercent,
    long? MemoryUsedBytes,
    long? MemoryTotalBytes,
    long? SharedMemoryUsedBytes,
    double? MemoryUsagePercent,
    double? TemperatureC,
    double? MemoryTemperatureC,
    int? CoreClockMhz,
    int? MemoryClockMhz,
    double? PowerWatts,
    double? PowerLimitWatts,
    int? FanRpm,
    int? FanPercent,
    double? VoltageV,
    string? PerformanceState,
    IReadOnlyList<GpuEngineUsage>? Engines,
    string? Source,
    string? Note);

/// <summary>One adapter as DXGI enumerates it; the LUID is what Windows' performance counters are named by.</summary>
public sealed record DxgiAdapter(string? Name, long DedicatedBytes, long SharedBytes, long? Luid);

public sealed record GpuHardwareInfo(bool Available, IReadOnlyList<GpuAdapter> Adapters, string? Note);

public sealed record GpuLiveInfo(IReadOnlyList<GpuLiveReading> Readings, long SampledAtUnixMs);

/// <summary>Reads the stable facts about GPUs for one platform. Implementations must not throw for missing hardware.</summary>
public interface IGpuCollector
{
    IReadOnlyList<GpuAdapter> ReadHardware();
}

/// <summary>Live readings for the given adapters, one per adapter in the same order.</summary>
public interface IGpuLiveSource
{
    IReadOnlyList<GpuLiveReading> Read(IReadOnlyList<GpuAdapter> adapters);
}

public sealed record NvmlDevice(string Name, string? PciAddress, string? VendorId, string? DeviceId, long? MemoryTotalBytes);

/// <summary>What the NVIDIA driver says about the installed NVIDIA GPUs (identity only; live numbers come from the engine).</summary>
public interface INvmlSource
{
    bool IsAvailable { get; }
    string? DriverVersion { get; }
    IReadOnlyList<NvmlDevice> Devices { get; }
}
