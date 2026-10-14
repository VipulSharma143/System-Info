using System.Globalization;
using System.Text.RegularExpressions;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Enumerates GPUs from DRM/sysfs (identity, memory size, driver). Live numbers are not read here: the native
/// overlay engine samples them and GpuService maps them onto these adapters.
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

    private GpuAdapter? ReadAdapter(string card, int index)
    {
        var device = Path.Combine(card, "device");
        var vendorId = ReadText(Path.Combine(device, "vendor"))?.ToLowerInvariant();
        var deviceId = ReadText(Path.Combine(device, "device"))?.ToLowerInvariant();
        if (vendorId is null || deviceId is null) return null;

        var uevent = ParseUevent(Path.Combine(device, "uevent"));
        uevent.TryGetValue("PCI_SLOT_NAME", out var pci);
        uevent.TryGetValue("DRIVER", out var driver);
        pci = GpuMath.NormalizePci(pci);

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

    private NvmlDevice? NvmlMatch(string? pci)
    {
        if (!_nvml.IsAvailable) return null;
        return _nvml.Devices.FirstOrDefault(d => d.PciAddress is not null && d.PciAddress == pci);
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
