using System.Globalization;

namespace SystemMonitor.Api.Services;

/// <summary>Looks vendor and device names up in the system's pci.ids (one streaming pass, no full load).</summary>
public sealed class PciIds
{
    private static readonly string[] DefaultPaths =
        ["/usr/share/hwdata/pci.ids", "/usr/share/misc/pci.ids", "/usr/share/pci.ids", "/var/lib/pciutils/pci.ids"];

    private readonly string[] _paths;

    public PciIds(params string[] paths) => _paths = paths.Length > 0 ? paths : DefaultPaths;

    public (string? Vendor, string? Device) Lookup(string vendorId, string deviceId)
    {
        var vendor = Strip(vendorId);
        var device = Strip(deviceId);
        var path = _paths.FirstOrDefault(File.Exists);
        if (path is null || vendor.Length != 4) return (null, null);

        try
        {
            string? vendorName = null;
            var inVendor = false;
            foreach (var line in File.ReadLines(path))
            {
                if (line.Length == 0 || line[0] == '#') continue;
                if (line[0] == 'C' && line.Length > 1 && line[1] == ' ') break;

                if (line[0] != '\t')
                {
                    if (inVendor) break;
                    if (line.StartsWith(vendor, StringComparison.OrdinalIgnoreCase) && line.Length > 6)
                    {
                        inVendor = true;
                        vendorName = line[6..].Trim();
                    }
                }
                else if (inVendor && line.Length > 7 && line[1] != '\t' &&
                         line.AsSpan(1, 4).Equals(device, StringComparison.OrdinalIgnoreCase))
                {
                    return (vendorName, line[7..].Trim());
                }
            }
            return (vendorName, null);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return (null, null);
        }
    }

    private static string Strip(string id) =>
        id.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? id[2..].PadLeft(4, '0') : id;

    public static bool TryParseHex(string? text, out int value)
    {
        value = 0;
        if (string.IsNullOrWhiteSpace(text)) return false;
        var t = text.Trim();
        return int.TryParse(t.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? t[2..] : t,
            NumberStyles.HexNumber, CultureInfo.InvariantCulture, out value);
    }
}
