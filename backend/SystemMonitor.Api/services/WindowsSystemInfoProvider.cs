using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Management;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

// [SupportedOSPlatform] tells the compiler this class uses Windows-only APIs —
// it will warn if this class is ever instantiated on a non-Windows build target.
[SupportedOSPlatform("windows")]
public class WindowsSystemInfoProvider : ISystemInfoProvider
{
    // PerformanceCounter is a built-in .NET/Windows API for reading live system
    // metrics — the same underlying data Task Manager itself uses.
    private readonly PerformanceCounter _cpuCounter =
        new("Processor", "% Processor Time", "_Total");

    // GetSystemPowerStatus is the same Win32 API the Windows taskbar battery
    // icon itself reads from — simpler and far more reliable than WMI's
    // Win32_Battery (whose BatteryStatus enum is notoriously vendor-dependent
    // and doesn't map cleanly to "charging"/"discharging").
    [StructLayout(LayoutKind.Sequential)]
    private struct SYSTEM_POWER_STATUS
    {
        public byte ACLineStatus;
        public byte BatteryFlag;
        public byte BatteryLifePercent;
        public byte SystemStatusFlag; // reserved, unused
        public int BatteryLifeTime; // seconds remaining; -1 if unknown
        public int BatteryFullLifeTime; // seconds; -1 if unknown
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS status);

 public Task<RamInfo> GetRamAsync()
{
    // WMI (Windows Management Instrumentation) is the standard way to query
    // system hardware info from Windows — same underlying data source Task
    // Manager and PowerShell's Get-CimInstance both use.
    using var searcher = new ManagementObjectSearcher(
        "SELECT TotalVisibleMemorySize, FreePhysicalMemory FROM Win32_OperatingSystem");

    ulong totalKb = 0, freeKb = 0;

    foreach (ManagementObject obj in searcher.Get())
    {
        totalKb = Convert.ToUInt64(obj["TotalVisibleMemorySize"]);
        freeKb = Convert.ToUInt64(obj["FreePhysicalMemory"]);
    }

    ulong usedKb = totalKb - freeKb;

    var result = new RamInfo(
        TotalMB: (long)(totalKb / 1024),
        UsedMB: (long)(usedKb / 1024),
        AvailableMB: (long)(freeKb / 1024),
        UsedPercent: totalKb > 0 ? Math.Round((double)usedKb / totalKb * 100, 1) : 0
    );

    return Task.FromResult(result);
}
    public async Task<CpuInfo> GetCpuAsync()
    {
        // PerformanceCounter's first read is always 0 — it needs a baseline sample first.
        _cpuCounter.NextValue();
        await Task.Delay(200);
        float usedPercent = _cpuCounter.NextValue();

        return new CpuInfo(Math.Round(usedPercent, 1));
    }

    public Task<List<ProcessInfo>> GetProcessesAsync()
    {
        var processes = Process.GetProcesses()
            .Select(p =>
            {
                try
                {
                    return new ProcessInfo(p.Id, p.ProcessName, p.WorkingSet64 / 1024 / 1024);
                }
                catch
                {
                    // Some processes (system/protected) throw on access — skip them
                    return null;
                }
            })
            .Where(p => p != null)
            .Cast<ProcessInfo>()
            .OrderByDescending(p => p.MemoryMB)
            .Take(50)
            .ToList();

        return Task.FromResult(processes);
    }

    public List<DiskInfo> GetDisks()
    {
        // DriveInfo is cross-platform — this part is identical in spirit to the
        // Linux version, just without the Linux-specific pseudo-filesystem filtering
        // (Windows doesn't have tmpfs/overlay/cgroup style mounts).
        var drives = new List<DiskInfo>();

        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                if (!d.IsReady) continue;
                if (d.TotalSize <= 0) continue;

                drives.Add(new DiskInfo(
                    Name: d.Name,
                    VolumeLabel: d.VolumeLabel,
                    DriveType: d.DriveType.ToString(),
                    DriveFormat: d.DriveFormat,
                    TotalGB: Math.Round(d.TotalSize / 1024.0 / 1024 / 1024, 1),
                    FreeGB: Math.Round(d.AvailableFreeSpace / 1024.0 / 1024 / 1024, 1),
                    UsedGB: Math.Round((d.TotalSize - d.AvailableFreeSpace) / 1024.0 / 1024 / 1024, 1),
                    UsedPercent: Math.Round((1.0 - (double)d.AvailableFreeSpace / d.TotalSize) * 100, 1)
                ));
            }
            catch
            {
                // drive became unavailable mid-read — skip it
            }
        }

        return drives;
    }

    public async Task<List<NetworkInfo>> GetNetworkAsync()
    {
        // NetworkInterface is cross-platform .NET, but GetIPv4Statistics() only
        // returns meaningful live throughput data reliably on Windows/Linux both —
        // we sample twice, same pattern as the Linux /proc/net/dev approach.
        var interfaces = System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces()
            .Where(ni => ni.OperationalStatus == System.Net.NetworkInformation.OperationalStatus.Up)
            .ToList();

        var sample1 = interfaces.ToDictionary(
            ni => ni.Name,
            ni => (rx: ni.GetIPv4Statistics().BytesReceived, tx: ni.GetIPv4Statistics().BytesSent)
        );

        await Task.Delay(500);

        var result = new List<NetworkInfo>();
        foreach (var ni in interfaces)
        {
            var stats = ni.GetIPv4Statistics();
            var (rx1, tx1) = sample1.GetValueOrDefault(ni.Name, (0, 0));

            double rxKBps = Math.Round((stats.BytesReceived - rx1) / 1024.0 / 0.5, 1);
            double txKBps = Math.Round((stats.BytesSent - tx1) / 1024.0 / 0.5, 1);

            result.Add(new NetworkInfo(ni.Name, rxKBps, txKBps));
        }

        return result;
    }

    // Battery — GetSystemPowerStatus (above) only covers basic power state:
    // AC connected, charge %, and a coarse charging flag. It has no concept
    // of cycle count, designed/full-charge capacity, or voltage, so it is
    // no longer treated as the complete battery source. Those fields come
    // from WindowsBatteryInterop, which talks to the battery class driver
    // directly via IOCTL_BATTERY_QUERY_INFORMATION / IOCTL_BATTERY_QUERY_STATUS
    // — the same interface Windows' own "powercfg /batteryreport" uses.
    public BatteryInfo GetBattery()
    {
        bool haveStatus = GetSystemPowerStatus(out var status);

        List<WindowsBatteryInterop.RawBatteryData> devices;
        try
        {
            devices = WindowsBatteryInterop.QueryAllBatteries();
        }
        catch
        {
            // A driver/permission failure here must degrade to the basic
            // power-status path below, not crash the whole endpoint.
            devices = new List<WindowsBatteryInterop.RawBatteryData>();
        }

        bool noBatteryPerStatus = !haveStatus || status.BatteryFlag == 128 || status.BatteryFlag == 255;

        if (noBatteryPerStatus && devices.Count == 0)
        {
            return new BatteryInfo(
                Available: false, Status: null, CapacityPercent: null, CycleCount: null,
                CycleCountNote: null, DesignCapacityMah: null, FullCapacityMah: null,
                NowCapacityMah: null, HealthPercent: null, VoltageNow: null, PowerWatts: null,
                Model: null, Manufacturer: null,
                Note: "No battery detected on this system"
            );
        }

        int? capacityPercent = haveStatus && status.BatteryLifePercent <= 100
            ? status.BatteryLifePercent
            : (int?)null;

        // Combine power-state flags across every enumerated battery device
        // (desktops normally have zero, laptops normally have exactly one;
        // this also tolerates the multi-battery case without hardcoding a
        // device count).
        uint combinedPowerState = 0;
        foreach (var d in devices) combinedPowerState |= d.PowerState;

        bool isCharging = devices.Count > 0 && WindowsBatteryInterop.IsCharging(combinedPowerState);
        bool isDischarging = devices.Count > 0 && WindowsBatteryInterop.IsDischarging(combinedPowerState);
        bool isPluggedIn = (haveStatus && status.ACLineStatus == 1) ||
                            (devices.Count > 0 && WindowsBatteryInterop.IsPluggedIn(combinedPowerState));

        string batteryStatus;
        if (isPluggedIn && isCharging)
            batteryStatus = "Charging";
        else if (isPluggedIn && capacityPercent >= 100)
            batteryStatus = "Fully Charged";
        else if (isPluggedIn)
            // AC connected but the driver reports neither "charging" nor
            // 100% — a legitimate state (charge limits, sensor rounding,
            // trickle-charge holds), not an error to paper over.
            batteryStatus = "Not Charging";
        else if (isDischarging || !isPluggedIn)
            batteryStatus = "Discharging";
        else
            batteryStatus = "Unknown";

        if (devices.Count == 0)
        {
            // IOCTL enumeration found nothing usable, but GetSystemPowerStatus
            // did detect a battery — report what basic power status gives us
            // and say plainly that the detailed fields are unavailable rather
            // than fabricating them.
            return new BatteryInfo(
                Available: true,
                Status: batteryStatus,
                CapacityPercent: capacityPercent,
                CycleCount: null,
                CycleCountNote: "This battery/Windows driver does not expose cycle-count information.",
                DesignCapacityMah: null,
                FullCapacityMah: null,
                NowCapacityMah: null,
                HealthPercent: null,
                VoltageNow: null,
                PowerWatts: null,
                Model: null,
                Manufacturer: null,
                Note: "Charge % and status from Windows' basic power API. The battery device did not respond to the detailed battery-information query (IOCTL_BATTERY_QUERY_INFORMATION), so capacity, health, voltage, and cycle count are unavailable.",
                CapacityUnit: "mWh"
            );
        }

        // Aggregate capacities across all batteries (preferred approach when
        // more than one is present — see engineering-spec §7). Cycle count is
        // per-battery and is never summed; with multiple batteries we surface
        // the first one that reports it and note the limitation.
        double? designedSum = SumIfAnyPresent(devices.Select(d => d.DesignedCapacityMWh));
        double? fullSum = SumIfAnyPresent(devices.Select(d => d.FullChargedCapacityMWh));
        double? currentSum = SumIfAnyPresent(devices.Select(d => d.CurrentCapacityMWh));

        double? healthPercent = null;
        if (designedSum is > 0 && fullSum is not null)
        {
            healthPercent = Math.Clamp(Math.Round(fullSum.Value / designedSum.Value * 100, 1), 0, 100);
        }

        var cycleDevice = devices.FirstOrDefault(d => d.CycleCount != null);
        long? cycleCount = cycleDevice?.CycleCount;
        string? cycleNote = cycleCount == null
            ? "This battery/Windows driver does not expose cycle-count information."
            : devices.Count > 1
                ? $"Multiple batteries detected; cycle count shown is from the first battery that reports it ({devices.Count} batteries total)."
                : null;

        double? voltageV = devices.FirstOrDefault(d => d.VoltageMV != null)?.VoltageMV is { } mv
            ? Math.Round(mv / 1000.0, 2)
            : null;

        double? powerWatts = null;
        var rates = devices.Where(d => d.RateMW != null).Select(d => d.RateMW!.Value).ToList();
        if (rates.Count > 0)
        {
            powerWatts = Math.Round(Math.Abs(rates.Sum()) / 1000.0, 1);
        }

        return new BatteryInfo(
            Available: true,
            Status: batteryStatus,
            CapacityPercent: capacityPercent,
            CycleCount: cycleCount,
            CycleCountNote: cycleNote,
            DesignCapacityMah: designedSum,
            FullCapacityMah: fullSum,
            NowCapacityMah: currentSum,
            HealthPercent: healthPercent,
            VoltageNow: voltageV,
            PowerWatts: powerWatts,
            Model: null,
            Manufacturer: null,
            Note: devices.Count > 1
                ? $"Aggregated from {devices.Count} battery devices via IOCTL_BATTERY_QUERY_INFORMATION/STATUS."
                : null,
            CapacityUnit: "mWh"
        );
    }

    private static double? SumIfAnyPresent(IEnumerable<double?> values)
    {
        var present = values.Where(v => v != null).Select(v => v!.Value).ToList();
        return present.Count > 0 ? present.Sum() : null;
    }
}