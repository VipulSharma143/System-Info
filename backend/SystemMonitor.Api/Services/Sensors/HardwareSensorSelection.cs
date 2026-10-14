namespace SystemMonitor.Api.Services;

/// <summary>
/// The rules that decide which sensor readings are shown, shared by the Linux (sysfs) and Windows (library) paths.
///   * A reading that cannot be real is dropped, not shown as a number: an unconnected sensor input reads 0 or −127 °C, a missing
///     voltage rail reads 0 V, a library "not a number" has no value.
///   * Nothing is estimated or converted into another quantity.
///   * Warning / critical temperature entries are limits, shown against the temperature they belong to, not as readings.
/// </summary>
public static class HardwareSensorSelection
{
    public const string Temperature = "temperature", Voltage = "voltage", Fan = "fan";

    public const string DrivesNoneLinux = "No drive reported a temperature. NVMe drives report one through the kernel's nvme driver when the drive supports it; SATA drives need the drivetemp kernel module (sudo modprobe drivetemp).";
    public const string BoardNoneLinux = "No motherboard sensor chip driver is loaded. Many laptops and some boards have none; installing lm-sensors and running sensors-detect can enable one.";
    public const string MemoryNoneLinux = "No memory module reports a temperature. DDR5 modules need the spd5118 kernel driver and DDR4 modules with a thermal sensor need jc42 (sudo modprobe jc42).";
    public const string DrivesNeedAdmin = "Drive temperatures need administrator rights on Windows. Reopen System Info as administrator.";
    public const string DrivesNoneWindows = "The sensor library found no drive that reports a temperature.";
    public const string BoardNoneWindows = "The sensor library does not support this computer's motherboard sensor chip (common on laptops, whose sensors sit in the embedded controller).";
    public const string MemoryOffWindows = "Memory module temperature on Windows is off by default, because reading it talks to the memory modules over the SMBus, which can misbehave on some computers. Set the environment variable SYSTEMINFO_DIMM_SENSORS=1 and restart System Info to turn it on.";
    public const string MemoryNoneWindows = "No memory module reported a temperature.";
    public const string Reading = "Reading the sensors…";

    /// <summary>True for a value that a real sensor of this kind could report.</summary>
    public static bool Plausible(string kind, double? value) => value is { } v && !double.IsNaN(v) && !double.IsInfinity(v) && kind switch
    {
        Temperature => v > 0 && v < 150,     // 0 and below is an unconnected input; nothing in a PC is a real 150 °C
        Voltage => Math.Abs(v) > 0.001 && Math.Abs(v) < 30,
        Fan => v >= 0 && v < 30_000,         // a stopped fan really is 0 RPM
        _ => false,
    };

    /// <summary>Plain-language label for a library sensor, or null for a quantity that is not shown.</summary>
    private static string? KindOf(string libraryType) => libraryType switch
    {
        "Temperature" => Temperature,
        "Voltage" => Voltage,
        "Fan" => Fan,
        _ => null,
    };

    private static string UnitOf(string kind) => kind switch { Temperature => "°C", Voltage => "V", _ => "RPM" };

    /// <summary>Turns a library device's sensors into shown sensors: plausible temperature, voltage and fan readings, with the device's warning and critical temperature attached.</summary>
    public static List<HwSensor> FromLibrary(IEnumerable<RawHwSensor> raw)
    {
        var all = raw.ToList();
        double? Limit(string word) => all.Where(r => r.Type == "Temperature" && r.Name.Contains(word, StringComparison.OrdinalIgnoreCase) && Plausible(Temperature, r.Value))
                                          .Select(r => r.Value).FirstOrDefault();
        var high = Limit("Warning");
        var critical = Limit("Critical");

        var sensors = new List<HwSensor>();
        foreach (var r in all)
        {
            if (KindOf(r.Type) is not { } kind) continue;
            if (kind == Temperature && (r.Name.Contains("Warning", StringComparison.OrdinalIgnoreCase) || r.Name.Contains("Critical", StringComparison.OrdinalIgnoreCase))) continue;
            if (!Plausible(kind, r.Value)) continue;
            sensors.Add(new HwSensor(r.Name.Trim(), kind, Math.Round(r.Value!.Value, kind == Voltage ? 3 : 1), UnitOf(kind), kind == Temperature ? high : null, kind == Temperature ? critical : null));
        }
        return Order(sensors);
    }

    /// <summary>Temperatures first, then voltages, then fans; each group keeps its original order.</summary>
    public static List<HwSensor> Order(IEnumerable<HwSensor> sensors) =>
        sensors.Select((s, i) => (s, i)).OrderBy(x => x.s.Kind switch { Temperature => 0, Voltage => 1, _ => 2 }).ThenBy(x => x.i).Select(x => x.s).ToList();

    public static HwCategory Category(List<HwDevice> devices, string noneNote) => new(devices, devices.Count == 0 ? noneNote : null);
}
