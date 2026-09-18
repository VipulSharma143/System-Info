namespace SystemMonitor.Api.Interface;

public record RamInfo(long TotalMB, long UsedMB, long AvailableMB, double UsedPercent);
public record CpuInfo(double UsedPercent);
public record ProcessInfo(int Pid, string Name, long MemoryMB);
public record DiskInfo(string Name, string VolumeLabel, string DriveType, string DriveFormat,
double TotalGB, double FreeGB, double UsedGB, double UsedPercent);
public record NetworkInfo(string Iface, double RxKBps, double TxKBps);

public record BatteryInfo(
bool Available,
string? Status,
int? CapacityPercent,
long? CycleCount,
string? CycleCountNote,
double? DesignCapacityMah,
double? FullCapacityMah,
double? NowCapacityMah,
double? HealthPercent,
double? VoltageNow,
double? PowerWatts,
string? Model,
string? Manufacturer,
string? Note,
    // "mAh" (Linux, from sysfs charge_*) or "mWh" (Windows, from the battery
    // class driver's IOCTL_BATTERY_QUERY_INFORMATION, which never reports
    // in mAh). Defaults to "mAh" so existing Linux call sites that don't
    // pass this named argument keep their previous, correct meaning.
string? CapacityUnit = "mAh"
);

// One sample of a single GPU engine's utilization (spec §12: "GPU Engine"
// exposes many engines — 3D, Copy, VideoDecode, etc. — and blindly summing
// them isn't a defensible "GPU usage" number, so each active engine is
// reported individually instead).
public record GpuEngineUsage(string InstanceName, double UsagePercent);

// One detected display adapter (spec §11: a laptop may report more than
// one — integrated + discrete — so this is always returned as a list,
// never assumed singular). Every field is nullable: absent/zero values
// from the underlying query become null rather than a fabricated 0.
public record GpuInfo(
string? Name,
string? VideoProcessor,
long? AdapterMemoryBytes,
string? DriverVersion,
string? DriverDate,
string? Status,
int? ResolutionWidth,
int? ResolutionHeight,
int? RefreshRateHz,
List<GpuEngineUsage>? EngineUsage,
string? Note
);

// Static host identity (spec §6-§8): manufacturer/model/BIOS come from
// Win32_ComputerSystem/Win32_BIOS on Windows. This changes only across a
// reboot, so the frontend fetches it once rather than polling it.
public record SystemIdentity(
string? ComputerName,
string? Manufacturer,
string? Model,
string? BiosVersion,
string? WindowsEdition,
string? WindowsBuild,
string? Architecture,
DateTime? LastBootTime,
double? UptimeSeconds,
    // True physical CPU core count (sum of NumberOfCores across all
    // Win32_Processor instances on Windows; sum of unique physical-id/
    // cpu-cores pairs from /proc/cpuinfo on Linux). Distinct from
    // Environment.ProcessorCount ("logicalProcessors" in the API response),
    // which counts logical processors/threads, not physical cores — the
    // two were previously conflated (see SystemEndpoints.cs's removed
    // "coreCount" field). Null when the underlying query is unavailable,
    // never a fabricated value.
int? PhysicalCores = null
);

public interface ISystemInfoProvider
{
Task<RamInfo> GetRamAsync();
Task<CpuInfo> GetCpuAsync();
Task<List<ProcessInfo>> GetProcessesAsync();
List<DiskInfo> GetDisks();
Task<List<NetworkInfo>> GetNetworkAsync();
BatteryInfo GetBattery();
List<GpuInfo> GetGpus();
SystemIdentity GetSystemIdentity();
}