using System.Diagnostics;
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
}