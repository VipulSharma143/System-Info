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
    long? SharedMemoryBytes);

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

public sealed record GpuHardwareInfo(bool Available, IReadOnlyList<GpuAdapter> Adapters, string? Note);

public sealed record GpuLiveInfo(IReadOnlyList<GpuLiveReading> Readings, long SampledAtUnixMs);

/// <summary>Reads GPUs for one platform. Implementations must not throw for missing hardware or drivers.</summary>
public interface IGpuCollector
{
    IReadOnlyList<GpuAdapter> ReadHardware();

    IReadOnlyList<GpuLiveReading> ReadLive(IReadOnlyList<GpuAdapter> adapters);
}

public sealed record NvmlDevice(string Name, string? PciAddress, string? VendorId, string? DeviceId, long? MemoryTotalBytes);

public sealed record NvmlSample(
    double? UtilizationPercent,
    long? MemoryUsedBytes,
    long? MemoryTotalBytes,
    double? TemperatureC,
    int? CoreClockMhz,
    int? MemoryClockMhz,
    double? PowerWatts,
    double? PowerLimitWatts,
    int? FanPercent,
    string? PerformanceState);

/// <summary>NVIDIA's management library, which is the only supported source of NVIDIA telemetry on both platforms.</summary>
public interface INvmlSource
{
    bool IsAvailable { get; }

    string? DriverVersion { get; }

    IReadOnlyList<NvmlDevice> Devices { get; }

    NvmlSample? Sample(int deviceIndex);
}
