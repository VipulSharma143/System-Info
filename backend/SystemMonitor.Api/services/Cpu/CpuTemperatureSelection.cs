using System.Globalization;

namespace SystemMonitor.Api.Services;

/// <summary>One chosen CPU temperature: the package figure, per-core figures when the driver has them, and the sensor's name.</summary>
public sealed record CpuTemperatureReading(double PackageCelsius, IReadOnlyDictionary<int, double> Cores, string Source);

/// <summary>
/// Picks the CPU's own sensor from hwmon / thermal sysfs and reads it. The rules are the same as the native
/// <c>si_cpu_temperature</c> (native/src/cpu_temperature.cpp) and a contract test keeps the two in agreement:
/// generic firmware zones such as <c>acpitz</c> sit at a fixed ~27-28 C and are never reported as the CPU, and a
/// reading outside 1..125 C is a broken sensor and is skipped.
/// </summary>
public static class CpuTemperatureSelection
{
    private static readonly string[] HwmonNames = ["coretemp", "k10temp", "zenpower", "cpu_thermal", "soc_thermal"];
    private static readonly string[] ZoneTypes = ["x86_pkg_temp", "cpu-thermal", "cpu_thermal", "soc-thermal", "soc_thermal"];

    public static bool Plausible(double celsius) => celsius is >= 1 and < 125;

    /// <summary>Null when the machine exposes no real CPU sensor. Reads the kernel on every call.</summary>
    public static CpuTemperatureReading? Read(string sysRoot)
    {
        var hwmonRoot = Path.Combine(sysRoot, "class", "hwmon");
        if (Directory.Exists(hwmonRoot))
        {
            foreach (var dir in SafeDirectories(hwmonRoot, "hwmon*"))
            {
                var name = ReadText(Path.Combine(dir, "name"));
                if (name is null || !HwmonNames.Contains(name, StringComparer.Ordinal)) continue;
                if (ReadHwmon(dir, name) is { } reading) return reading;
            }
        }

        var thermalRoot = Path.Combine(sysRoot, "class", "thermal");
        if (Directory.Exists(thermalRoot))
        {
            foreach (var zone in SafeDirectories(thermalRoot, "thermal_zone*"))
            {
                var type = ReadText(Path.Combine(zone, "type"));
                if (type is null || !ZoneTypes.Contains(type, StringComparer.Ordinal)) continue;
                if (ReadCelsius(Path.Combine(zone, "temp")) is { } celsius)
                    return new CpuTemperatureReading(celsius, new Dictionary<int, double>(), "thermal-zone");
            }
        }
        return null;
    }

    private static CpuTemperatureReading? ReadHwmon(string dir, string name)
    {
        double? package = null, tdie = null, tctl = null, unlabelled = null;
        var cores = new Dictionary<int, double>();

        foreach (var file in SafeFiles(dir, "temp*_input"))
        {
            if (ReadCelsius(file) is not { } celsius) continue;
            var label = ReadText(file[..^"_input".Length] + "_label") ?? "";

            if (label.StartsWith("Core ", StringComparison.Ordinal) && int.TryParse(label.AsSpan(5), NumberStyles.None, CultureInfo.InvariantCulture, out var core)) cores[core] = celsius;
            else if (label.StartsWith("Package", StringComparison.Ordinal)) package ??= celsius;
            else if (label == "Tdie") tdie = celsius;
            else if (label == "Tctl") tctl = celsius;
            else if (label.Length == 0) unlabelled ??= celsius;
        }

        double? hottestCore = cores.Count > 0 ? cores.Values.Max() : null;
        double? armSingle = name is "cpu_thermal" or "soc_thermal" ? unlabelled : null;
        var chosen = package ?? tdie ?? tctl ?? hottestCore ?? armSingle;
        return chosen is { } value ? new CpuTemperatureReading(value, cores, name) : null;
    }

    private static double? ReadCelsius(string path)
    {
        var text = ReadText(path);
        if (text is null || !long.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var milli)) return null;
        var celsius = milli / 1000.0;
        return Plausible(celsius) ? celsius : null;
    }

    private static string? ReadText(string path)
    {
        try
        {
            return File.Exists(path) && File.ReadAllText(path).Trim() is { Length: > 0 } text ? text : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static IEnumerable<string> SafeDirectories(string root, string pattern)
    {
        try { return Directory.EnumerateDirectories(root, pattern).Order(StringComparer.Ordinal).ToList(); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return []; }
    }

    private static IEnumerable<string> SafeFiles(string root, string pattern)
    {
        try { return Directory.EnumerateFiles(root, pattern).Order(StringComparer.Ordinal).ToList(); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return []; }
    }
}

/// <summary>
/// Guards a GENERIC temperature zone (the Windows ACPI thermal zone) against being a constant. Real CPU sensors
/// are never judged by this: a plateau at idle is normal for them. A generic zone that does not move at all while
/// the CPU load swings widely is not measuring the CPU, and showing its number as "CPU temperature" is the bug
/// this guards: after <see cref="Window"/> samples with a range under <see cref="MaxFlatRange"/> C while load
/// varied by at least <see cref="MinLoadSwing"/> points, the reading is withheld and a note says why.
/// </summary>
public sealed class TemperatureFlatlineGuard
{
    public const int Window = 40;
    public const double MaxFlatRange = 0.6;
    public const double MinLoadSwing = 25;

    private readonly Queue<(double Celsius, double? Load)> _samples = new();

    /// <summary>Records a sample; returns true when the zone has proven it does not follow the CPU.</summary>
    public bool Observe(double celsius, double? loadPercent)
    {
        _samples.Enqueue((celsius, loadPercent));
        while (_samples.Count > Window) _samples.Dequeue();
        if (_samples.Count < Window) return false;

        var temps = _samples.Select(s => s.Celsius).ToList();
        var loads = _samples.Where(s => s.Load is not null).Select(s => s.Load!.Value).ToList();
        if (loads.Count < Window / 2) return false;
        return temps.Max() - temps.Min() <= MaxFlatRange && loads.Max() - loads.Min() >= MinLoadSwing;
    }

    public void Reset() => _samples.Clear();
}
