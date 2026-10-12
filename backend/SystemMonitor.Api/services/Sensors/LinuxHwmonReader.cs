using System.Globalization;
using System.Text.RegularExpressions;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Drive, motherboard and memory-module sensors on Linux, read straight from the kernel's hwmon files under /sys/class/hwmon
/// (no root needed, no library). A hwmon device is sorted by the name its driver registers:
///   nvme, drivetemp          -> drives (NVMe through the nvme driver, SATA through the drivetemp module)
///   spd5118, jc42            -> memory modules (DDR5 SPD hub, DDR4 thermal sensor)
///   known sensor-chip names  -> motherboard (nct*, it8*, f71*, w83*, acpitz, pch_*, thinkpad, dell_smm, ...)
/// Anything else (coretemp, k10temp, GPUs, batteries, Wi-Fi) belongs to another page and is left alone. The root is a parameter so
/// tests can point it at a fake tree. A file that cannot be read or holds an impossible value is skipped, never replaced by a guess.
/// </summary>
public static class LinuxHwmonReader
{
    private static readonly Regex BoardChip = new(
        @"^(nct\d\w*|it\d{4}\w*|it8\w*|f7\w+|w83\w+|asus\w*|gigabyte\w*|acpitz|pch_\w+|thinkpad|dell_smm|applesmc|lm7\d\w*|lm9\d\w*|adt7\w+|msi\w*|corsair\w*|nzxt\w*)$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex InputFile = new(@"^(temp|in|fan)(\d+)_input$", RegexOptions.Compiled);

    public static HardwareSensors Read(string sysRoot, long nowMs)
    {
        var drives = new List<HwDevice>();
        var board = new List<HwDevice>();
        var memory = new List<HwDevice>();
        var root = Path.Combine(sysRoot, "class", "hwmon");

        if (Directory.Exists(root))
        {
            foreach (var dir in Directory.EnumerateDirectories(root).OrderBy(Index).ThenBy(d => d, StringComparer.Ordinal))
            {
                var chip = ReadText(Path.Combine(dir, "name"));
                if (chip is null) continue;
                var sensors = ReadSensors(dir);
                if (sensors.Count == 0) continue;
                var id = Path.GetFileName(dir);

                if (chip == "nvme") drives.Add(new HwDevice(id, Model(dir) ?? "NVMe drive", "NVMe", sensors));
                else if (chip == "drivetemp") drives.Add(new HwDevice(id, Model(dir) ?? "SATA drive", "SATA", sensors));
                else if (chip is "spd5118" or "jc42") memory.Add(new HwDevice(id, MemoryName(dir), chip == "spd5118" ? "DDR5 SPD hub" : "DDR4 thermal sensor", sensors));
                else if (BoardChip.IsMatch(chip)) board.Add(new HwDevice(id, chip, chip == "acpitz" ? "Firmware thermal zone" : "Motherboard sensor chip", sensors));
            }
        }

        return new HardwareSensors(true, "linux", "sysfs hwmon", nowMs,
            HardwareSensorSelection.Category([.. drives.OrderBy(d => d.Name, StringComparer.OrdinalIgnoreCase)], HardwareSensorSelection.DrivesNoneLinux),
            HardwareSensorSelection.Category(board, HardwareSensorSelection.BoardNoneLinux),
            HardwareSensorSelection.Category(memory, HardwareSensorSelection.MemoryNoneLinux));
    }

    private static int Index(string dir) => int.TryParse(Path.GetFileName(dir).Replace("hwmon", ""), out var n) ? n : int.MaxValue;

    private static List<HwSensor> ReadSensors(string dir)
    {
        var found = new List<(string Prefix, int N)>();
        foreach (var file in Directory.EnumerateFiles(dir))
        {
            var m = InputFile.Match(Path.GetFileName(file));
            if (m.Success) found.Add((m.Groups[1].Value, int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture)));
        }

        var sensors = new List<HwSensor>();
        foreach (var (prefix, n) in found.OrderBy(f => f.Prefix).ThenBy(f => f.N))
        {
            if (!long.TryParse(ReadText(Path.Combine(dir, $"{prefix}{n}_input")), NumberStyles.Integer, CultureInfo.InvariantCulture, out var raw)) continue;
            var label = ReadText(Path.Combine(dir, $"{prefix}{n}_label"));
            switch (prefix)
            {
                case "temp":
                {
                    var c = raw / 1000.0;
                    if (!HardwareSensorSelection.Plausible(HardwareSensorSelection.Temperature, c)) continue;
                    sensors.Add(new HwSensor(label ?? $"Temperature {n}", HardwareSensorSelection.Temperature, Math.Round(c, 1), "°C",
                        Limit(dir, $"temp{n}_max"), Limit(dir, $"temp{n}_crit")));
                    break;
                }
                case "in":
                {
                    var v = raw / 1000.0;   // the kernel reports millivolts
                    if (!HardwareSensorSelection.Plausible(HardwareSensorSelection.Voltage, v)) continue;
                    sensors.Add(new HwSensor(label ?? $"Voltage {n}", HardwareSensorSelection.Voltage, Math.Round(v, 3), "V", null, null));
                    break;
                }
                default:
                {
                    if (!HardwareSensorSelection.Plausible(HardwareSensorSelection.Fan, raw)) continue;
                    sensors.Add(new HwSensor(label ?? $"Fan {n}", HardwareSensorSelection.Fan, raw, "RPM", null, null));
                    break;
                }
            }
        }
        return HardwareSensorSelection.Order(sensors);
    }

    private static double? Limit(string dir, string file) =>
        long.TryParse(ReadText(Path.Combine(dir, file)), NumberStyles.Integer, CultureInfo.InvariantCulture, out var raw) && HardwareSensorSelection.Plausible(HardwareSensorSelection.Temperature, raw / 1000.0)
            ? Math.Round(raw / 1000.0, 1) : null;

    /// <summary>The drive's model string: "model" on an NVMe controller, "vendor model" on a SCSI/SATA device (the generic "ATA" vendor is dropped).</summary>
    private static string? Model(string hwmonDir)
    {
        var device = Path.Combine(hwmonDir, "device");
        var model = ReadText(Path.Combine(device, "model"));
        if (model is null) return null;
        var vendor = ReadText(Path.Combine(device, "vendor"));
        return string.IsNullOrEmpty(vendor) || vendor.Equals("ATA", StringComparison.OrdinalIgnoreCase) ? model : $"{vendor} {model}";
    }

    /// <summary>"Memory module (SMBus 0x50)": the address is the part after the dash in the i2c device name, e.g. "1-0050".</summary>
    private static string MemoryName(string hwmonDir)
    {
        var device = new DirectoryInfo(Path.Combine(hwmonDir, "device"));
        var name = (device.ResolveLinkTarget(true) as DirectoryInfo ?? device).Name;
        var dash = name.IndexOf('-');
        return dash > 0 && dash < name.Length - 1 ? $"Memory module (SMBus 0x{name[(dash + 1)..].TrimStart('0').PadLeft(2, '0')})" : "Memory module";
    }

    private static string? ReadText(string path)
    {
        try
        {
            var text = File.ReadAllText(path).Trim();
            return text.Length == 0 ? null : text;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;   // e.g. EIO from a sensor that is not connected
        }
    }
}
