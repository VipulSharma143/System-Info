using System.Globalization;

namespace SystemMonitor.Api.Services;

/// <summary>
/// /proc/stat for usage, cpufreq for clocks, the CPU's own hwmon/thermal sensor for temperature (see
/// <see cref="CpuTemperatureSelection"/>; the generic acpitz zone is never used) and RAPL for package power. Everything beyond usage is optional: virtual machines and locked-down kernels expose little.
/// </summary>
public sealed class LinuxCpuCollector : ICpuCollector
{
    private readonly string _proc;
    private readonly string _sys;
    private readonly Func<long> _nowMs;

    private Dictionary<string, (ulong Total, ulong Idle)> _previousStat = [];
    private ulong? _previousEnergyUj;
    private long _previousEnergyMs;

    public LinuxCpuCollector(string procRoot = "/proc", string sysRoot = "/sys", Func<long>? nowMs = null)
    {
        _proc = procRoot;
        _sys = sysRoot;
        _nowMs = nowMs ?? (() => Environment.TickCount64);
    }

    public CpuDetail Read()
    {
        var now = _nowMs();
        var stat = ReadStat();
        var temps = ReadTemperatures(out var packageTemp, out var source);
        var cpuinfoMhz = ReadCpuinfoClocks();

        var cores = new List<CpuCoreReading>();
        foreach (var (label, _) in stat.Where(kv => kv.Key != "cpu").OrderBy(kv => int.Parse(kv.Key[3..], CultureInfo.InvariantCulture)))
        {
            var index = int.Parse(label[3..], CultureInfo.InvariantCulture);
            var clock = ReadKhz(Path.Combine(_sys, "devices", "system", "cpu", label, "cpufreq", "scaling_cur_freq")) is { } khz
                ? (int)(khz / 1000)
                : cpuinfoMhz.GetValueOrDefault(index, 0) is > 0 and var mhz ? mhz : (int?)null;
            var coreId = ReadLong(Path.Combine(_sys, "devices", "system", "cpu", label, "topology", "core_id"));
            cores.Add(new CpuCoreReading(index, Usage(label, stat), clock, coreId is { } id && temps.TryGetValue((int)id, out var t) ? t : null));
        }

        var clocks = cores.Where(c => c.ClockMhz is not null).Select(c => c.ClockMhz!.Value).ToList();
        var cpu0 = Path.Combine(_sys, "devices", "system", "cpu", "cpu0", "cpufreq");
        var total = stat.ContainsKey("cpu") ? Usage("cpu", stat) : null;
        var power = ReadPackagePower(now);
        _previousStat = stat;

        return new CpuDetail(
            TotalUsagePercent: total,
            Cores: cores,
            AverageClockMhz: clocks.Count > 0 ? (int)Math.Round(clocks.Average()) : null,
            HighestClockMhz: clocks.Count > 0 ? clocks.Max() : null,
            BaseClockMhz: ReadKhz(Path.Combine(cpu0, "base_frequency")) is { } b ? (int)(b / 1000) : null,
            MaxClockMhz: ReadKhz(Path.Combine(cpu0, "cpuinfo_max_freq")) is { } m ? (int)(m / 1000) : null,
            PackageTemperatureC: packageTemp,
            PowerWatts: power,
            LoadAverage: ReadLoadAverage(),
            TemperatureSource: source,
            Note: packageTemp is null ? "No CPU temperature sensor is exposed by this system." : null,
            SampledAtUnixMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    private Dictionary<string, (ulong Total, ulong Idle)> ReadStat()
    {
        var result = new Dictionary<string, (ulong, ulong)>();
        var text = ReadAll(Path.Combine(_proc, "stat"));
        if (text is null) return result;

        foreach (var line in text.Split('\n'))
        {
            if (!line.StartsWith("cpu", StringComparison.Ordinal)) continue;
            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 5) continue;

            // user nice system idle iowait irq softirq steal; guest time is already inside user.
            ulong total = 0, idle = 0;
            for (var i = 1; i < Math.Min(parts.Length, 9); i++)
            {
                if (!ulong.TryParse(parts[i], NumberStyles.None, CultureInfo.InvariantCulture, out var v)) continue;
                total += v;
                if (i is 4 or 5) idle += v;
            }
            result[parts[0]] = (total, idle);
        }
        return result;
    }

    private double? Usage(string label, Dictionary<string, (ulong Total, ulong Idle)> current)
    {
        if (!_previousStat.TryGetValue(label, out var before) || !current.TryGetValue(label, out var after)) return null;
        if (after.Total <= before.Total) return null;
        var totalDelta = after.Total - before.Total;
        var idleDelta = after.Idle >= before.Idle ? after.Idle - before.Idle : 0;
        return Math.Round(Math.Clamp((totalDelta - idleDelta) * 100.0 / totalDelta, 0, 100), 1);
    }

    private Dictionary<int, int> ReadCpuinfoClocks()
    {
        var result = new Dictionary<int, int>();
        var text = ReadAll(Path.Combine(_proc, "cpuinfo"));
        if (text is null) return result;

        var processor = -1;
        foreach (var line in text.Split('\n'))
        {
            var colon = line.IndexOf(':');
            if (colon < 0) continue;
            var key = line[..colon].Trim();
            var value = line[(colon + 1)..].Trim();
            if (key == "processor" && int.TryParse(value, out var p)) processor = p;
            else if (key == "cpu MHz" && processor >= 0 &&
                     double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var mhz)) result[processor] = (int)Math.Round(mhz);
        }
        return result;
    }

    /// <summary>Per-core temperatures keyed by the kernel's core id, plus the package temperature. Live on every call.</summary>
    private Dictionary<int, double> ReadTemperatures(out double? package, out string? source)
    {
        var reading = CpuTemperatureSelection.Read(_sys);
        package = reading?.PackageCelsius;
        source = reading?.Source;
        return reading is null ? [] : new Dictionary<int, double>(reading.Cores);
    }

    // RAPL reports energy, not power: watts = delta energy / delta time, so the first read has none.
    // The counter is root-only on recent kernels (CVE-2020-8694); an unreadable file simply means no power figure.
private double? ReadPackagePower(long now)
{
    var powercapRoot = Path.Combine(_sys, "class", "powercap");
    if (!Directory.Exists(powercapRoot))
        return null;

    var domain = Directory
        .EnumerateDirectories(powercapRoot, "intel-rapl*")
        .OrderBy(path => path, StringComparer.Ordinal)
        .FirstOrDefault();

    if (domain is null)
        return null;

    if (ReadLong(Path.Combine(domain, "energy_uj")) is not { } raw || raw < 0)
        return null;

    var energy = (ulong)raw;

    var previous = _previousEnergyUj;
    var previousMs = _previousEnergyMs;

    _previousEnergyUj = energy;
    _previousEnergyMs = now;

    if (previous is null || now <= previousMs)
        return null;

    ulong delta;

    if (energy >= previous.Value)
    {
        delta = energy - previous.Value;
    }
    else if (ReadLong(Path.Combine(domain, "max_energy_range_uj")) is { } range && range > 0)
    {
        delta = (ulong)range - previous.Value + energy;
    }
    else
    {
        return null;
    }

    return Math.Round(
        delta / 1_000_000.0 /
        ((now - previousMs) / 1000.0),
        1);
}
    private double[]? ReadLoadAverage()
    {
        var parts = ReadAll(Path.Combine(_proc, "loadavg"))?.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts is not { Length: >= 3 }) return null;
        var values = new double[3];
        for (var i = 0; i < 3; i++)
        {
            if (!double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out values[i])) return null;
        }
        return values;
    }

    private static long? ReadKhz(string path) => ReadLong(path) is { } v && v > 0 ? v : null;

    private static string? ReadAll(string path)
    {
        try
        {
            return File.Exists(path) ? File.ReadAllText(path) : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static string? ReadText(string path) => ReadAll(path)?.Trim() is { Length: > 0 } t ? t : null;

    private static long? ReadLong(string path) =>
        long.TryParse(ReadText(path), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : null;
}
