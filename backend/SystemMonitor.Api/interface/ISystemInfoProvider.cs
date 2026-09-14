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

public interface ISystemInfoProvider
{
Task<RamInfo> GetRamAsync();
Task<CpuInfo> GetCpuAsync();
Task<List<ProcessInfo>> GetProcessesAsync();
List<DiskInfo> GetDisks();
Task<List<NetworkInfo>> GetNetworkAsync();
BatteryInfo GetBattery();
}