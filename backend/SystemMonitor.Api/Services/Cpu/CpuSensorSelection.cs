using System.Text.RegularExpressions;

namespace SystemMonitor.Api.Services;

/// <summary>One temperature sensor as a hardware library reports it, before any selection.</summary>
public sealed record RawTemperature(string Name, double? Value);

/// <summary>
/// CPU temperatures from a managed hardware library (Windows). PackageC is the headline reading, or null when no sensor
/// that is really the processor package reported one; History is that headline value over time (oldest first, gaps are null).
/// </summary>
public sealed record CpuSensorReading(
    double? PackageC, string? PackageLabel, IReadOnlyList<CpuDetailSensor> Sensors, string? Note, IReadOnlyList<double?> History);

/// <summary>A source of CPU temperatures that is not the native engine. Read never blocks and never throws.</summary>
public interface ICpuSensorSource
{
    CpuSensorReading? Read();
}

/// <summary>
/// Chooses the processor's temperatures out of everything a hardware library lists. Rules (readings are never mixed or averaged):
///   package  = "CPU Package" (Intel), else "Core (Tctl/Tdie)" / "Core (Tdie)" / "Core (Tctl)" (AMD), else the hottest "Core #N";
///   per core = "Core #N" or "CPU Core #N" (the library's Intel naming), per chiplet = "CCDn (Tdie)";
///   never    = "Core Max", "Core Average", "Distance to TjMax" (derived values, not a sensor of the die).
/// A value outside 1..125 °C is a broken sensor and is skipped. Nothing is estimated.
/// </summary>
public static class CpuSensorSelection
{
    public const string Source = "librehardwaremonitor";
    public const int HistoryLength = 120;

    private static readonly string[] PackageNames =
        ["CPU Package", "Core (Tctl/Tdie)", "Core (Tdie)", "Core (Tctl)", "CPU (Tctl/Tdie)"];
    private static readonly Regex CoreName = new(@"^(?:CPU )?Core #(\d+)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex CcdName = new(@"^CCD\d* ?\(Tdie\)$|^CCD #?\d+$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static bool Plausible(double? v) => v is > 1 and < 125 && !double.IsNaN(v.Value);

    public static CpuSensorReading Select(IReadOnlyList<RawTemperature> raw, string? failure, IReadOnlyList<double?> history)
    {
        var usable = raw.Where(r => Plausible(r.Value)).ToList();
        var sensors = new List<CpuDetailSensor>();

        RawTemperature? package = null;
        foreach (var name in PackageNames)
        {
            package = usable.FirstOrDefault(r => string.Equals(r.Name, name, StringComparison.OrdinalIgnoreCase));
            if (package is not null) break;
        }
        var hottestCore = usable.Where(r => CoreName.IsMatch(r.Name)).OrderByDescending(r => r.Value).FirstOrDefault();
        var packageC = package?.Value;
        var packageLabel = package?.Name;
        if (package is null && hottestCore is not null)
        {
            packageC = hottestCore.Value;
            packageLabel = hottestCore.Name + " (hottest core)";
        }

        if (package is not null) sensors.Add(new CpuDetailSensor(package.Name, "package", null, package.Value, null, null));
        foreach (var core in usable.Where(r => CoreName.IsMatch(r.Name)).OrderBy(r => CoreNumber(r.Name)))
            sensors.Add(new CpuDetailSensor(core.Name, "core", null, core.Value, null, null));
        foreach (var ccd in usable.Where(r => CcdName.IsMatch(r.Name)).OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase))
            sensors.Add(new CpuDetailSensor(ccd.Name, "ccd", null, ccd.Value, null, null));

        string? note = null;
        if (packageC is null)
        {
            note = failure ?? (raw.Count == 0
                ? "The hardware sensor library found no CPU temperature sensor on this computer."
                : "The CPU temperature sensors returned no usable value.");
            if (!note.Contains("administrator", StringComparison.OrdinalIgnoreCase))
                note += " Windows normally allows this reading only when System Info runs as administrator; some computers do not expose it at all.";
        }
        else if (package is null)
        {
            note = "This processor reports per-core temperatures but no package sensor; the headline value is the hottest core.";
        }
        return new CpuSensorReading(packageC, packageLabel, sensors, note, history);
    }

    /// <summary>The most specific true statement about why no processor temperature came back.</summary>
    public static string ExplainMissingTemperature(bool elevated, bool driverRegistered)
    {
        if (!elevated)
            return "System Info is not running as administrator, so Windows does not let it read the processor sensors.";
        if (!driverRegistered)
            return "System Info is running as administrator, but the PawnIO sensor driver does not appear to be installed (the sensor library needs it for processor temperatures).";
        return "System Info is running as administrator and the sensor driver is present, but this processor reported no temperature sensor.";
    }

    private static int CoreNumber(string name) => int.TryParse(CoreName.Match(name).Groups[1].Value, out var n) ? n : int.MaxValue;
}
