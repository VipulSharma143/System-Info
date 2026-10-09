using System.Runtime.Versioning;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Windows adapters come from WMI + DXGI (via <see cref="WindowsSystemInfoProvider"/>); NVIDIA telemetry from
/// NVML; everything else from the "GPU Engine" and "GPU Adapter Memory" performance counters.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class WindowsGpuCollector : IGpuCollector
{
    private readonly WindowsSystemInfoProvider _provider;
    private readonly INvmlSource _nvml;

    public WindowsGpuCollector(WindowsSystemInfoProvider provider, INvmlSource nvml)
    {
        _provider = provider;
        _nvml = nvml;
    }

    public IReadOnlyList<GpuAdapter> ReadHardware()
    {
        var gpus = _provider.GetAdapters();
        var dxgi = WindowsSystemInfoProvider.ReadDxgiAdapters();
        var nvmlMatch = NvmlMatching.ByName(gpus.Select(g => g.Name).ToList(), _nvml.Devices);

        var adapters = new List<GpuAdapter>(gpus.Count);
        for (var i = 0; i < gpus.Count; i++)
        {
            var g = gpus[i];
            var name = g.Name ?? g.VideoProcessor ?? $"Display adapter {i}";
            var vendor = VendorOf(name);
            long? dedicated = g.AdapterMemoryBytes;
            string? driverVersion = g.DriverVersion;
            string? vendorId = null, deviceId = null;

            if (nvmlMatch[i] is { } n)
            {
                dedicated = n.MemoryTotalBytes ?? dedicated;
                driverVersion = _nvml.DriverVersion ?? driverVersion;
                vendorId = n.VendorId;
                deviceId = n.DeviceId;
            }

            var dxgiMatch = GpuCounters.MatchDxgi(name, gpus.Count, dxgi);
            long? shared = dxgiMatch is { } m && m.SharedBytes > 0 ? m.SharedBytes : null;
            long? luid = dxgiMatch?.Luid;
            bool? integrated = null;
            if (IsUnifiedMemory(vendor, name, dedicated, shared)) integrated = true;
            else if (vendor == "NVIDIA" || name.Contains("Arc", StringComparison.OrdinalIgnoreCase)) integrated = false;

            adapters.Add(new GpuAdapter(
                Id: luid is { } l ? $"luid-{l:x}" : $"adapter{i}",
                Index: i,
                Name: name,
                Vendor: vendor,
                VendorId: vendorId,
                DeviceId: deviceId,
                PciAddress: nvmlMatch[i]?.PciAddress,
                Driver: null,
                DriverVersion: driverVersion,
                DriverDate: g.DriverDate,
                Integrated: integrated,
                Primary: null,
                DedicatedMemoryBytes: dedicated is > 0 ? dedicated : null,
                SharedMemoryBytes: shared,
                Luid: luid));
        }
        return adapters;
    }

    private static bool IsUnifiedMemory(string? vendor, string name, long? dedicated, long? shared) =>
        (vendor == "Intel" && !name.Contains("Arc", StringComparison.OrdinalIgnoreCase)) ||
        (shared is > 0 && (dedicated is null || dedicated < 1L << 30));

    private static string? VendorOf(string name) =>
        name.Contains("NVIDIA", StringComparison.OrdinalIgnoreCase) ? "NVIDIA"
        : name.Contains("AMD", StringComparison.OrdinalIgnoreCase) || name.Contains("Radeon", StringComparison.OrdinalIgnoreCase) ? "AMD"
        : name.Contains("Intel", StringComparison.OrdinalIgnoreCase) ? "Intel"
        : null;
}
