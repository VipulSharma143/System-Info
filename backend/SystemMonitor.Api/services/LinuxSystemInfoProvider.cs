using System.Text;
using System.Text.Json;
using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Native;

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

    public RamDetails GetRamDetails() =>
        RamDetailsReader.Read(() => MemoryMapping.FromMeminfo(File.ReadAllLines("/proc/meminfo")));

    // CPU and network rates are deltas between two readings. The previous reading is kept
    // between calls (the background sampler is the only caller), so a call never sleeps
    // except the very first one, which needs a short window to measure against.
    private static readonly TimeSpan MinCpuWindow = TimeSpan.FromMilliseconds(200);
    private static readonly TimeSpan MinNetWindow = TimeSpan.FromMilliseconds(250);
    private readonly object _cpuLock = new();
    private (long Idle, long Total, long Tick)? _prevCpu;

    private static (long Idle, long Total, long Tick) ReadCpuTimes()
    {
        // The first line of /proc/stat is the aggregate "cpu" row: user nice system idle iowait ...
        using var reader = new StreamReader("/proc/stat");
        var line = reader.ReadLine() ?? throw new IOException("/proc/stat is empty");
        long idle = 0, total = 0;
        int field = 0;
        foreach (var part in line.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (field++ == 0) continue;
            var v = long.Parse(part);
            if (field == 5) idle = v;
            total += v;
        }
        return (idle, total, Environment.TickCount64);
    }

    public async Task<CpuInfo> GetCpuAsync()
    {
        (long Idle, long Total, long Tick) prev;
        lock (_cpuLock) prev = _prevCpu ?? ReadCpuTimes();
        var wait = MinCpuWindow.TotalMilliseconds - (Environment.TickCount64 - prev.Tick);
        if (wait > 0) await Task.Delay((int)wait);

        var now = ReadCpuTimes();
        lock (_cpuLock) _prevCpu = now;

        long totalDelta = now.Total - prev.Total;
        double used = totalDelta <= 0 ? 0 : (1.0 - (double)(now.Idle - prev.Idle) / totalDelta) * 100;
        return new CpuInfo(Math.Round(used, 1));
    }

    public Task<List<ProcessInfo>> GetProcessesAsync()
    {
        var processes = new List<ProcessInfo>(256);
        foreach (var dir in Directory.EnumerateDirectories("/proc"))
        {
            if (!int.TryParse(Path.GetFileName(dir.AsSpan()), out var pid)) continue;
            try
            {
                string name = "unknown";
                long rssKb = 0;
                foreach (var line in File.ReadLines(dir + "/status"))
                {
                    if (line.StartsWith("Name:", StringComparison.Ordinal)) name = line[5..].Trim();
                    else if (line.StartsWith("VmRSS:", StringComparison.Ordinal))
                    {
                        long.TryParse(line.AsSpan(6).Trim().TrimEnd("kB").Trim(), out rssKb);
                        break;   // VmRSS comes after Name in the file
                    }
                }
                processes.Add(new ProcessInfo(pid, name, rssKb / 1024));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // exited while being read
            }
        }

        processes.Sort((a, b) => b.MemoryMB.CompareTo(a.MemoryMB));
        if (processes.Count > 50) processes.RemoveRange(50, processes.Count - 50);
        return Task.FromResult(processes);
    }

    public List<DiskInfo> GetDisks()
    {
        var drives = new List<DiskInfo>();

        // The native enumerator lists only block-device-backed filesystems (it reads
        // /proc/mounts, skips loop/squashfs/pseudo mounts and collapses bind mounts).
        // DriveInfo then supplies the label/type for exactly those. If the native
        // library cannot answer, fall back to DriveInfo with RAM/network mounts excluded.
        Dictionary<string, string>? realMounts = null;   // mount point -> filesystem type
        try
        {
            var vols = NativeHardware.GetStorageVolumes();
            if (vols.Count > 0) realMounts = vols.GroupBy(v => v.Mount).ToDictionary(g => g.Key, g => g.First().FileSystem, StringComparer.Ordinal);
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException) { /* fall back below */ }

        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                if (realMounts is not null ? !realMounts.ContainsKey(d.Name) : d.DriveType is DriveType.Ram or DriveType.Network or DriveType.CDRom or DriveType.Unknown)
                    continue;
                if (!d.IsReady || d.TotalSize <= 0) continue;
                if (realMounts is null && d.DriveFormat is "tmpfs" or "devtmpfs" or "overlay" or "squashfs" or "proc" or "sysfs" or "cgroup" or "cgroup2" or "udev")
                    continue;

                drives.Add(new DiskInfo(
                    Name: d.Name,
                    VolumeLabel: d.VolumeLabel,
                    DriveType: d.DriveType.ToString(),
                    // .NET misidentifies some filesystems (ext4 reported as ext3); /proc/mounts is authoritative.
                    DriveFormat: realMounts is not null && realMounts.TryGetValue(d.Name, out var fsType) ? fsType : d.DriveFormat,
                    TotalGB: Math.Round(d.TotalSize / 1024.0 / 1024 / 1024, 1),
                    FreeGB: Math.Round(d.AvailableFreeSpace / 1024.0 / 1024 / 1024, 1),
                    UsedGB: Math.Round((d.TotalSize - d.AvailableFreeSpace) / 1024.0 / 1024 / 1024, 1),
                    UsedPercent: Math.Round((1.0 - (double)d.AvailableFreeSpace / d.TotalSize) * 100, 1)
                ));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // unmounted/permission-restricted mid-read: skip this one volume, keep the rest
            }
        }

        return drives;
    }

    private readonly object _netLock = new();
    private (Dictionary<string, (long Rx, long Tx)> Counters, long Tick)? _prevNet;

    private static (Dictionary<string, (long Rx, long Tx)> Counters, long Tick) ReadNetStats()
    {
        var result = new Dictionary<string, (long, long)>();
        foreach (var line in File.ReadLines("/proc/net/dev").Skip(2))
        {
            var colon = line.IndexOf(':');
            if (colon < 0) continue;
            var stats = line[(colon + 1)..].Split(' ', StringSplitOptions.RemoveEmptyEntries);
            result[line[..colon].Trim()] = (long.Parse(stats[0]), long.Parse(stats[8]));
        }
        return (result, Environment.TickCount64);
    }

    public async Task<List<NetworkInfo>> GetNetworkAsync()
    {
        (Dictionary<string, (long Rx, long Tx)> Counters, long Tick) prev;
        lock (_netLock) prev = _prevNet ?? ReadNetStats();
        var wait = MinNetWindow.TotalMilliseconds - (Environment.TickCount64 - prev.Tick);
        if (wait > 0) await Task.Delay((int)wait);

        var now = ReadNetStats();
        lock (_netLock) _prevNet = now;

        double seconds = Math.Max(0.001, (now.Tick - prev.Tick) / 1000.0);
        var interfaces = new List<NetworkInfo>(now.Counters.Count);
        foreach (var (iface, (rx, tx)) in now.Counters)
        {
            var (rx0, tx0) = prev.Counters.GetValueOrDefault(iface, (rx, tx));
            interfaces.Add(new NetworkInfo(iface,
                Math.Round((rx - rx0) / 1024.0 / seconds, 1),
                Math.Round((tx - tx0) / 1024.0 / seconds, 1)));
        }
        return interfaces;
    }

    // Battery — routed through the native C++ engine (matches CPU temp/GPU/fan,
    // not the direct-C# pattern used for RAM/disk). No delta sampling needed;
    // it's a single-pass sysfs read, same shape as GetDisks().
    public BatteryInfo GetBattery()
    {
        static BatteryInfo None(string note) => new(
            Available: false, Status: null, CapacityPercent: null, CycleCount: null,
            CycleCountNote: null, DesignCapacityMah: null, FullCapacityMah: null,
            NowCapacityMah: null, HealthPercent: null, VoltageNow: null, PowerWatts: null,
            Model: null, Manufacturer: null, Note: note);

        // 2 KB: a long manufacturer/model string must not truncate the JSON mid-token.
        var buffer = new StringBuilder(2048);
        if (NativeInterop.GetBatteryInfoJson(buffer, buffer.Capacity) < 0)
            return None("Battery information could not be read");

        using var doc = JsonDocument.Parse(buffer.ToString());
        var root = doc.RootElement;

        // Every field is optional: sysfs exposes different attributes per vendor/driver
        // (charge_* vs energy_*, no cycle_count, no voltage...). A missing one is "unknown", not an error.
        double? Num(string name) => root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;
        string? Text(string name) => root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        // The native layer reports 0 when an attribute is absent; for capacities and voltage 0 is never a real reading.
        double? Positive(double? v) => v is > 0 ? v : null;

        if (!(root.TryGetProperty("present", out var present) && present.ValueKind == JsonValueKind.True))
            return None("No battery detected on this system");

        var cycles = Num("cycleCount");
        var health = Num("healthPercent");
        var power = Num("powerWatts");

        return new BatteryInfo(
            Available: true,
            Status: Text("status"),
            CapacityPercent: Num("capacityPercent") is { } cp ? (int)Math.Round(cp) : null,
            CycleCount: cycles is >= 0 ? (long)cycles : null,
            CycleCountNote: cycles == 0 ? "Firmware reports 0 — not all hardware tracks cycle count reliably" : null,
            DesignCapacityMah: Positive(Num("designCapacityMah")) is { } dc ? Math.Round(dc, 0) : null,
            FullCapacityMah: Positive(Num("fullCapacityMah")) is { } fc ? Math.Round(fc, 0) : null,
            NowCapacityMah: Positive(Num("nowCapacityMah")) is { } nc ? Math.Round(nc, 0) : null,
            HealthPercent: health is >= 0 ? Math.Round(health.Value, 1) : null,
            VoltageNow: Positive(Num("voltageNow")),
            PowerWatts: power is { } w ? Math.Round(w, 1) : null,
            Model: Text("model"),
            Manufacturer: Text("manufacturer"),
            Note: null
        );
    }

    // GPU telemetry on Linux already flows through the native engine via
    // /api/native/gpu (vendor-conditional AMD sysfs / Intel debugfs reads —
    // see NativeEndpoints.cs). This interface method exists for parity with
    // WindowsSystemInfoProvider so /api/system/gpu doesn't 404 on Linux, but
    // isn't the primary Linux GPU path, so it returns an empty list rather
    // than duplicating that vendor-detection logic here.
    public List<GpuInfo> GetGpus()
    {
        return new List<GpuInfo>();
    }

    // System Identity (spec §6-§8 equivalent for Linux): DMI sysfs files and
    // /etc/os-release. Each read is independent and best-effort — a missing
    // file (common in containers/VMs where DMI isn't exposed) leaves that
    // field null rather than failing the whole response.
    public SystemIdentity GetSystemIdentity()
    {
        string? ReadDmi(string file)
        {
            try
            {
                var path = $"/sys/class/dmi/id/{file}";
                return File.Exists(path) ? File.ReadAllText(path).Trim() : null;
            }
            catch
            {
                return null;
            }
        }

        string? manufacturer = ReadDmi("sys_vendor");
        string? model = ReadDmi("product_name");
        string? biosVersion = ReadDmi("bios_version");

        string? prettyName = null;
        try
        {
            if (File.Exists("/etc/os-release"))
            {
                var line = File.ReadAllLines("/etc/os-release")
                    .FirstOrDefault(l => l.StartsWith("PRETTY_NAME="));
                if (line != null)
                {
                    prettyName = line.Split('=', 2)[1].Trim().Trim('"');
                }
            }
        }
        catch
        {
            // /etc/os-release unavailable — leave null.
        }

        DateTime? lastBoot = null;
        double? uptimeSeconds = null;
        try
        {
            var uptimeText = File.ReadAllText("/proc/uptime").Split(' ', StringSplitOptions.RemoveEmptyEntries)[0];
            if (double.TryParse(uptimeText, out var seconds))
            {
                uptimeSeconds = seconds;
                lastBoot = DateTime.Now.AddSeconds(-seconds);
            }
        }
        catch
        {
            // /proc/uptime unavailable — leave null.
        }

        // Physical core count (distinct from logical processor count, which
        // Environment.ProcessorCount already covers elsewhere). /proc/cpuinfo
        // has one block per logical processor; "physical id" identifies the
        // socket a block belongs to and "cpu cores" is that socket's physical
        // core count, repeated on every logical block for the same socket.
        // Grouping by physical id and taking one "cpu cores" value per group
        // (rather than counting blocks) avoids double-counting hyperthreaded
        // siblings, and summing across groups covers the rare multi-socket
        // case. A machine that omits "physical id" (some VMs/containers) is
        // treated as a single implicit socket.
        int? physicalCores = null;
        try { physicalCores = NativeHardware.GetCpuTopology()?.PhysicalCores; }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException) { /* fall back to /proc/cpuinfo */ }
        if (physicalCores is null)
        try
        {
            var lines = File.ReadAllLines("/proc/cpuinfo");
            var coresBySocket = new Dictionary<string, int>();
            string currentSocket = "0";

            foreach (var line in lines)
            {
                if (line.StartsWith("physical id"))
                {
                    var colonPos = line.IndexOf(':');
                    if (colonPos != -1) currentSocket = line[(colonPos + 1)..].Trim();
                }
                else if (line.StartsWith("cpu cores"))
                {
                    var colonPos = line.IndexOf(':');
                    if (colonPos != -1 && int.TryParse(line[(colonPos + 1)..].Trim(), out var cores))
                    {
                        coresBySocket[currentSocket] = cores; // last write per socket wins; value is constant per socket
                    }
                }
            }

            if (coresBySocket.Count > 0)
            {
                physicalCores = coresBySocket.Values.Sum();
            }
        }
        catch
        {
            // /proc/cpuinfo unavailable or unparsable — leave null.
        }

        return new SystemIdentity(
            ComputerName: Environment.MachineName,
            Manufacturer: string.IsNullOrWhiteSpace(manufacturer) ? null : manufacturer,
            Model: string.IsNullOrWhiteSpace(model) ? null : model,
            BiosVersion: string.IsNullOrWhiteSpace(biosVersion) ? null : biosVersion,
            WindowsEdition: prettyName,
            WindowsBuild: null,
            Architecture: System.Runtime.InteropServices.RuntimeInformation.OSArchitecture.ToString(),
            LastBootTime: lastBoot,
            UptimeSeconds: uptimeSeconds,
            PhysicalCores: physicalCores
        );
    }
}