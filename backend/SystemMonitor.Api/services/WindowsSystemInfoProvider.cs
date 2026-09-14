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

    // Battery — reads real data via GetSystemPowerStatus() (see the P/Invoke
    // declaration above). BatteryFlag 128 means "no system battery" (the
    // normal desktop case) and 255 means "unknown status" — both are treated
    // as no battery present, same honesty convention as get_fan_rpm()/
    // get_amd_gpu_usage_percent() elsewhere in this project. Capacity in
    // mAh, health %, voltage, cycle count, model, and manufacturer require
    // WMI's Win32_Battery/Win32_PortableBattery, which are unreliable across
    // vendors and not wired up here — left null with an honest note rather
    // than guessed.
    public BatteryInfo GetBattery()
    {
        if (!GetSystemPowerStatus(out var status) ||
            status.BatteryFlag == 128 ||
            status.BatteryFlag == 255)
        {
            return new BatteryInfo(
                Available: false, Status: null, CapacityPercent: null, CycleCount: null,
                CycleCountNote: null, DesignCapacityMah: null, FullCapacityMah: null,
                NowCapacityMah: null, HealthPercent: null, VoltageNow: null, PowerWatts: null,
                Model: null, Manufacturer: null,
                Note: "No battery detected on this system"
            );
        }

        // BatteryFlag bit 3 (value 8) means "charging". Otherwise, on AC
        // power at 100% counts as fully charged; on AC but not full/charging
        // is treated as charging too (Windows briefly reports this state
        // right after plugging in); off AC is discharging.
        var charging = (status.BatteryFlag & 0x08) != 0;
        string batteryStatus = charging
            ? "Charging"
            : status.ACLineStatus == 1 && status.BatteryLifePercent >= 100
                ? "Fully Charged"
                : status.ACLineStatus == 1
                    ? "Charging"
                    : "Discharging";

        int? capacityPercent = status.BatteryLifePercent <= 100 ? status.BatteryLifePercent : null;

        return new BatteryInfo(
            Available: true,
            Status: batteryStatus,
            CapacityPercent: capacityPercent,
            CycleCount: null,
            CycleCountNote: "Cycle count is not exposed by the Windows Power API used here (GetSystemPowerStatus).",
            DesignCapacityMah: null,
            FullCapacityMah: null,
            NowCapacityMah: null,
            HealthPercent: null,
            VoltageNow: null,
            PowerWatts: null,
            Model: null,
            Manufacturer: null,
            Note: "Charge % and status from Windows' Power API. Capacity, health, voltage, model, and manufacturer are not implemented yet (would require WMI's Win32_Battery/Win32_PortableBattery)."
        );
    }
}