using System.Globalization;
using System.Text.RegularExpressions;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Enumerates GPUs from DRM/sysfs and reads telemetry from the driver's own files (amdgpu, i915/xe, nouveau
/// hwmon). NVIDIA's proprietary driver exposes nothing useful there, so NVML supplies its numbers.
/// </summary>
public sealed partial class LinuxGpuCollector : IGpuCollector
{
    private const string NvidiaVendor = "0x10de";

    private readonly string _sysRoot;
    private readonly INvmlSource _nvml;
    private readonly PciIds _pciIds;

    public LinuxGpuCollector(INvmlSource nvml, PciIds pciIds, string sysRoot = "/sys")
    {
        _nvml = nvml;
        _pciIds = pciIds;
        _sysRoot = sysRoot;
    }

    [GeneratedRegex(@"^card\d+$")]
    private static partial Regex CardPattern();

    public IReadOnlyList<GpuAdapter> ReadHardware()
    {
        var drm = Path.Combine(_sysRoot, "class", "drm");
        if (!Directory.Exists(drm)) return [];

        var adapters = new List<GpuAdapter>();
        foreach (var card in Directory.EnumerateDirectories(drm).Where(d => CardPattern().IsMatch(Path.GetFileName(d))).Order())
        {
            try
            {
                var adapter = ReadAdapter(card, adapters.Count);
                if (adapter is not null) adapters.Add(adapter);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // One unreadable card must not hide the others.
            }
        }
        return adapters;
    }

    public IReadOnlyList<GpuLiveReading> ReadLive(IReadOnlyList<GpuAdapter> adapters)
    {
        var readings = new List<GpuLiveReading>(adapters.Count);
        foreach (var adapter in adapters)
        {
            try
            {
                readings.Add(ReadReading(adapter));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                readings.Add(Empty(adapter.Id, "Live readings could not be read."));
            }
        }
        return readings;
    }

    private GpuAdapter? ReadAdapter(string card, int index)
    {
        var device = Path.Combine(card, "device");
        var vendorId = ReadText(Path.Combine(device, "vendor"))?.ToLowerInvariant();
        var deviceId = ReadText(Path.Combine(device, "device"))?.ToLowerInvariant();
        if (vendorId is null || deviceId is null) return null;

        var uevent = ParseUevent(Path.Combine(device, "uevent"));
        uevent.TryGetValue("PCI_SLOT_NAME", out var pci);
        uevent.TryGetValue("DRIVER", out var driver);
        pci = NvmlGpuSource.NormalizePci(pci);

        var (vendorName, deviceName) = _pciIds.Lookup(vendorId, deviceId);
        var vendor = vendorId switch
        {
            NvidiaVendor => "NVIDIA",
            "0x1002" => "AMD",
            "0x8086" => "Intel",
            _ => vendorName,
        };
        var name = deviceName is null ? $"{vendor ?? "Unknown"} GPU ({deviceId})" : $"{vendor} {deviceName}".Trim();
        string? driverVersion = null;
        long? dedicated = ReadLong(Path.Combine(device, "mem_info_vram_total"));
        long? shared = ReadLong(Path.Combine(device, "mem_info_gtt_total"));

        if (vendorId == NvidiaVendor && NvmlMatch(pci) is { } nv)
        {
            name = nv.Name;
            dedicated = nv.MemoryTotalBytes ?? dedicated;
            driverVersion = _nvml.DriverVersion;
        }

        // Integrated GPUs sit on the root PCI bus (00); add-in cards are behind a bridge.
        bool? integrated = pci is { Length: >= 7 } ? pci.Substring(5, 2) == "00" : null;

        return new GpuAdapter(
            Id: pci ?? Path.GetFileName(card),
            Index: index,
            Name: name,
            Vendor: vendor,
            VendorId: vendorId,
            DeviceId: deviceId,
            PciAddress: pci,
            Driver: driver,
            DriverVersion: driverVersion,
            DriverDate: null,
            Integrated: integrated,
            Primary: ReadText(Path.Combine(device, "boot_vga")) is { } boot ? boot == "1" : null,
            DedicatedMemoryBytes: dedicated is > 0 ? dedicated : null,
            SharedMemoryBytes: shared is > 0 ? shared : null);
    }

    private GpuLiveReading ReadReading(GpuAdapter adapter)
    {
        var card = FindCard(adapter);
        if (card is null) return Empty(adapter.Id, "The adapter is no longer present.");
        var device = Path.Combine(card, "device");

        double? utilization = ReadLong(Path.Combine(device, "gpu_busy_percent"));
        long? used = ReadLong(Path.Combine(device, "mem_info_vram_used"));
        long? sharedUsed = ReadLong(Path.Combine(device, "mem_info_gtt_used"));
        var hw = ReadHwmon(device);
        string? source = hw.Any ? "sysfs" : null;
        string? note = null;

        var coreClock = hw.CoreClockMhz ?? ReadDpmClock(Path.Combine(device, "pp_dpm_sclk")) ?? IntelClock(card, device);
        var memClock = hw.MemoryClockMhz ?? ReadDpmClock(Path.Combine(device, "pp_dpm_mclk"));

        double? temp = hw.TemperatureC, memTemp = hw.MemoryTemperatureC, power = hw.PowerWatts, limit = hw.PowerLimitWatts;
        int? fanRpm = hw.FanRpm, fanPct = hw.FanPercent;
        string? pstate = null;

        if (adapter.VendorId == NvidiaVendor)
        {
            if (NvmlIndex(adapter) is { } nvmlIndex && _nvml.Sample(nvmlIndex) is { } s)
            {
                utilization = s.UtilizationPercent;
                used = s.MemoryUsedBytes;
                temp = s.TemperatureC ?? temp;
                coreClock = s.CoreClockMhz ?? coreClock;
                memClock = s.MemoryClockMhz ?? memClock;
                power = s.PowerWatts ?? power;
                limit = s.PowerLimitWatts ?? limit;
                fanPct = s.FanPercent ?? fanPct;
                pstate = s.PerformanceState;
                source = "nvml";
            }
            else if (!_nvml.IsAvailable && source is null)
            {
                note = "NVIDIA's management library was not found, so live telemetry is unavailable.";
            }
        }
        else if (adapter.VendorId == "0x8086" && utilization is null)
        {
            note = "The Intel driver does not expose a usage percentage through sysfs.";
        }

        double? memPercent = used is { } u && adapter.DedicatedMemoryBytes is > 0 and var total
            ? Math.Round(u * 100.0 / total, 1)
            : null;

        return new GpuLiveReading(adapter.Id, utilization, used, sharedUsed, memPercent, temp, memTemp, coreClock, memClock,
            power, limit, fanRpm, fanPct, hw.VoltageV, pstate, null, source, note);
    }

    private NvmlDevice? NvmlMatch(string? pci)
    {
        if (!_nvml.IsAvailable) return null;
        return _nvml.Devices.FirstOrDefault(d => d.PciAddress is not null && d.PciAddress == pci);
    }

    private int? NvmlIndex(GpuAdapter adapter)
    {
        if (!_nvml.IsAvailable || adapter.PciAddress is null) return null;
        for (var i = 0; i < _nvml.Devices.Count; i++)
        {
            if (_nvml.Devices[i].PciAddress == adapter.PciAddress) return i;
        }
        return null;
    }

    private string? FindCard(GpuAdapter adapter)
    {
        var drm = Path.Combine(_sysRoot, "class", "drm");
        if (!Directory.Exists(drm)) return null;
        foreach (var card in Directory.EnumerateDirectories(drm).Where(d => CardPattern().IsMatch(Path.GetFileName(d))))
        {
            var slot = NvmlGpuSource.NormalizePci(ParseUevent(Path.Combine(card, "device", "uevent")).GetValueOrDefault("PCI_SLOT_NAME"));
            if ((slot ?? Path.GetFileName(card)) == adapter.Id) return card;
        }
        return null;
    }

    private readonly record struct Hwmon(
        double? TemperatureC, double? MemoryTemperatureC, double? PowerWatts, double? PowerLimitWatts,
        int? FanRpm, int? FanPercent, double? VoltageV, int? CoreClockMhz, int? MemoryClockMhz)
    {
        public bool Any => TemperatureC is not null || PowerWatts is not null || FanRpm is not null || FanPercent is not null ||
                           MemoryTemperatureC is not null || VoltageV is not null || CoreClockMhz is not null;
    }

    private static Hwmon ReadHwmon(string device)
    {
        var root = Path.Combine(device, "hwmon");
        if (!Directory.Exists(root)) return default;
        var dir = Directory.EnumerateDirectories(root).Order().FirstOrDefault();
        if (dir is null) return default;

        double? edge = null, junction = null, memory = null;
        foreach (var file in Directory.EnumerateFiles(dir, "temp*_input"))
        {
            var prefix = file[..^"_input".Length];
            var value = ReadLong(file) is { } milli ? milli / 1000.0 : (double?)null;
            switch (ReadText(prefix + "_label"))
            {
                case "junction" or "hotspot": junction = value; break;
                case "mem": memory = value; break;
                default: edge ??= value; break;
            }
        }

        double? Micro(string name) => ReadLong(Path.Combine(dir, name)) is { } v && v > 0 ? v / 1_000_000.0 : null;
        int? Mhz(string name) => ReadLong(Path.Combine(dir, name)) is { } hz && hz > 0 ? (int)(hz / 1_000_000) : null;

        int? fanPercent = null;
        if (ReadLong(Path.Combine(dir, "pwm1")) is { } pwm)
        {
            var max = ReadLong(Path.Combine(dir, "pwm1_max")) ?? 255;
            if (max > 0) fanPercent = (int)Math.Round(pwm * 100.0 / max);
        }

        return new Hwmon(
            TemperatureC: edge ?? junction,
            MemoryTemperatureC: memory,
            PowerWatts: Micro("power1_average") ?? Micro("power1_input"),
            PowerLimitWatts: Micro("power1_cap"),
            FanRpm: ReadLong(Path.Combine(dir, "fan1_input")) is { } rpm && rpm > 0 ? (int)rpm : null,
            FanPercent: fanPercent,
            VoltageV: ReadLong(Path.Combine(dir, "in0_input")) is { } mv && mv > 0 ? mv / 1000.0 : null,
            CoreClockMhz: Mhz("freq1_input"),
            MemoryClockMhz: Mhz("freq2_input"));
    }

    // "1: 1500Mhz *": the starred line is the current DPM level.
    private static int? ReadDpmClock(string path)
    {
        var text = ReadAll(path);
        if (text is null) return null;
        foreach (var line in text.Split('\n'))
        {
            if (!line.TrimEnd().EndsWith('*')) continue;
            var match = DpmPattern().Match(line);
            if (match.Success && int.TryParse(match.Groups[1].Value, CultureInfo.InvariantCulture, out var mhz)) return mhz;
        }
        return null;
    }

    [GeneratedRegex(@"(\d+)\s*[Mm][Hh][Zz]")]
    private static partial Regex DpmPattern();

    // i915 publishes the clock under the card, xe under the device's tile/gt tree.
    private static int? IntelClock(string card, string device)
    {
        foreach (var path in new[]
                 {
                     Path.Combine(card, "gt_cur_freq_mhz"),
                     Path.Combine(device, "tile0", "gt0", "freq0", "cur_freq"),
                 })
        {
            if (ReadLong(path) is { } mhz && mhz > 0) return (int)mhz;
        }
        return null;
    }

    private static Dictionary<string, string> ParseUevent(string path)
    {
        var result = new Dictionary<string, string>();
        var text = ReadAll(path);
        if (text is null) return result;
        foreach (var line in text.Split('\n'))
        {
            var eq = line.IndexOf('=');
            if (eq > 0) result[line[..eq]] = line[(eq + 1)..].Trim();
        }
        return result;
    }

    private static GpuLiveReading Empty(string id, string note) =>
        new(id, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, note);

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

    // sysfs attributes can fail with EINVAL/EIO while a GPU is suspended; that is "no value", not an error.
    private static string? ReadText(string path) => ReadAll(path)?.Trim() is { Length: > 0 } t ? t : null;

    private static long? ReadLong(string path) =>
        long.TryParse(ReadText(path), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : null;
}
