using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

public class LinuxSystemInfoProvider : ISystemInfoProvider
{
    public Task<RamInfo> GetRamAsync()
    {
        var lines = File.ReadAllLines("/proc/meminfo");

        long GetValueKb(string key)
        {
            var line = lines.FirstOrDefault(l => l.StartsWith(key));
            if (line == null) return 0;
            var parts = line.Split(':', StringSplitOptions.TrimEntries);
            var numberPart = parts[1].Replace("kB", "").Trim();
            return long.Parse(numberPart);
        }

        long totalKb = GetValueKb("MemTotal");
        long availableKb = GetValueKb("MemAvailable");
        long usedKb = totalKb - availableKb;

        var result = new RamInfo(
            TotalMB: totalKb / 1024,
            UsedMB: usedKb / 1024,
            AvailableMB: availableKb / 1024,
            UsedPercent: Math.Round((double)usedKb / totalKb * 100, 1)
        );

        return Task.FromResult(result);
    }

    public async Task<CpuInfo> GetCpuAsync()
    {
        (long idle, long total) ReadCpuTimes()
        {
            var line = File.ReadAllLines("/proc/stat")[0];
            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries).Skip(1)
                             .Select(long.Parse).ToArray();
            long idleTime = parts[3];
            long total = parts.Sum();
            return (idleTime, total);
        }

        var (idle1, total1) = ReadCpuTimes();
        await Task.Delay(200);
        var (idle2, total2) = ReadCpuTimes();

        long idleDelta = idle2 - idle1;
        long totalDelta = total2 - total1;
        double usedPercent = totalDelta == 0 ? 0 : (1.0 - (double)idleDelta / totalDelta) * 100;

        return new CpuInfo(Math.Round(usedPercent, 1));
    }

    public Task<List<ProcessInfo>> GetProcessesAsync()
    {
        var processes = new List<ProcessInfo>();

        foreach (var dir in Directory.GetDirectories("/proc"))
        {
            var pidStr = Path.GetFileName(dir);
            if (!int.TryParse(pidStr, out int pid)) continue;

            try
            {
                var statusPath = Path.Combine(dir, "status");
                if (!File.Exists(statusPath)) continue;

                var lines = File.ReadAllLines(statusPath);
                string name = lines.FirstOrDefault(l => l.StartsWith("Name:"))?.Split(':', 2)[1].Trim() ?? "unknown";
                string vmRssLine = lines.FirstOrDefault(l => l.StartsWith("VmRSS:")) ?? "";
                long memoryKb = 0;
                if (vmRssLine.Length > 0)
                {
                    var numPart = vmRssLine.Split(':', 2)[1].Replace("kB", "").Trim();
                    long.TryParse(numPart, out memoryKb);
                }

                processes.Add(new ProcessInfo(pid, name, memoryKb / 1024));
            }
            catch
            {
                // process exited mid-read — skip it
            }
        }

        var top50 = processes.OrderByDescending(p => p.MemoryMB).Take(50).ToList();
        return Task.FromResult(top50);
    }

    public List<DiskInfo> GetDisks()
    {
        var drives = new List<DiskInfo>();

        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                if (!d.IsReady) continue;
                if (d.TotalSize <= 0) continue;

                if (d.DriveFormat is "tmpfs" or "devtmpfs" or "overlay" or "squashfs" or "proc" or "sysfs" or "cgroup" or "cgroup2")
                    continue;

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
        Dictionary<string, (long rx, long tx)> ReadNetStats()
        {
            var result = new Dictionary<string, (long, long)>();
            var lines = File.ReadAllLines("/proc/net/dev").Skip(2);

            foreach (var line in lines)
            {
                var parts = line.Split(':');
                if (parts.Length != 2) continue;
                var iface = parts[0].Trim();
                var stats = parts[1].Split(' ', StringSplitOptions.RemoveEmptyEntries);
                long rxBytes = long.Parse(stats[0]);
                long txBytes = long.Parse(stats[8]);
                result[iface] = (rxBytes, txBytes);
            }
            return result;
        }

        var sample1 = ReadNetStats();
        await Task.Delay(500);
        var sample2 = ReadNetStats();

        var interfaces = sample2.Keys.Select(iface =>
        {
            var (rx1, tx1) = sample1.GetValueOrDefault(iface, (0, 0));
            var (rx2, tx2) = sample2[iface];
            double rxKBps = Math.Round((rx2 - rx1) / 1024.0 / 0.5, 1);
            double txKBps = Math.Round((tx2 - tx1) / 1024.0 / 0.5, 1);
            return new NetworkInfo(iface, rxKBps, txKBps);
        }).ToList();

        return interfaces;
    }
}