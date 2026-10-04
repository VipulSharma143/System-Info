using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Management;
using System.Threading;
using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Native;

namespace SystemMonitor.Api.Services;

// [SupportedOSPlatform] tells the compiler this class uses Windows-only APIs —
// it will warn if this class is ever instantiated on a non-Windows build target.
[SupportedOSPlatform("windows")]
public partial class WindowsSystemInfoProvider : ISystemInfoProvider
{
    // PerformanceCounter is a built-in .NET/Windows API for reading live system
    // metrics — the same underlying data Task Manager itself uses.
    private readonly PerformanceCounter _cpuCounter = CreatePrimedCpuCounter();

    private static PerformanceCounter CreatePrimedCpuCounter()
    {
        var counter = new PerformanceCounter("Processor", "% Processor Time", "_Total");
        counter.NextValue();
        return counter;
    }

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
    public RamDetails GetRamDetails() =>
        RamDetailsReader.Read(() =>
        {
            // Managed fallback: the WMI reading the dashboard already uses (completes synchronously).
            var ram = GetRamAsync().GetAwaiter().GetResult();
            return MemoryMapping.FromBasic(ram.TotalMB * 1024 * 1024, ram.AvailableMB * 1024 * 1024);
        });

    // PerformanceCounter reports the average since its previous NextValue(), and its first
    // read is always 0. The counter is primed here, so every later call returns the load
    // since the last call without sleeping; only a call made right after construction waits
    // out the short window a meaningful first reading needs.
    private long _cpuPrimedAt = Environment.TickCount64;

    public async Task<CpuInfo> GetCpuAsync()
    {
        var wait = 200 - (Environment.TickCount64 - _cpuPrimedAt);
        if (wait > 0) await Task.Delay((int)wait);
        _cpuPrimedAt = 0;
        return new CpuInfo(Math.Round(_cpuCounter.NextValue(), 1));
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
                // DriveType is answered locally by the OS. IsReady is NOT: on a mapped network
                // drive whose server is unreachable it can block for tens of seconds, so never
                // call it for network/optical/RAM/unknown drives. Only local volumes belong in
                // a hardware storage view.
                if (d.DriveType is not (DriveType.Fixed or DriveType.Removable)) continue;
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

    private readonly object _netLock = new();
    private (Dictionary<string, (long Rx, long Tx)> Counters, long Tick)? _prevNet;

    private static (Dictionary<string, (long Rx, long Tx)> Counters, long Tick) ReadNetStats()
    {
        var counters = new Dictionary<string, (long, long)>();
        foreach (var ni in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up) continue;
            var stats = ni.GetIPv4Statistics();
            counters[ni.Name] = (stats.BytesReceived, stats.BytesSent);
        }
        return (counters, Environment.TickCount64);
    }

    // Throughput is the delta against the previous call (the background sampler is the only
    // caller); only the first call waits, to have a window to measure over.
    public async Task<List<NetworkInfo>> GetNetworkAsync()
    {
        (Dictionary<string, (long Rx, long Tx)> Counters, long Tick) prev;
        lock (_netLock) prev = _prevNet ?? ReadNetStats();
        var wait = 250 - (Environment.TickCount64 - prev.Tick);
        if (wait > 0) await Task.Delay((int)wait);

        var now = ReadNetStats();
        lock (_netLock) _prevNet = now;

        double seconds = Math.Max(0.001, (now.Tick - prev.Tick) / 1000.0);
        var result = new List<NetworkInfo>(now.Counters.Count);
        foreach (var (name, (rx, tx)) in now.Counters)
        {
            var (rx0, tx0) = prev.Counters.GetValueOrDefault(name, (rx, tx));
            result.Add(new NetworkInfo(name, Math.Round((rx - rx0) / 1024.0 / seconds, 1), Math.Round((tx - tx0) / 1024.0 / seconds, 1)));
        }
        return result;
    }
}
