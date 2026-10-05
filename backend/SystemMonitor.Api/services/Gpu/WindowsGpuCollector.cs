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

            var shared = SharedFor(name, gpus.Count, dxgi);
            bool? integrated = null;
            if (IsUnifiedMemory(vendor, name, dedicated, shared)) integrated = true;
            else if (vendor == "NVIDIA" || name.Contains("Arc", StringComparison.OrdinalIgnoreCase)) integrated = false;

            adapters.Add(new GpuAdapter(
                Id: $"adapter{i}",
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
                SharedMemoryBytes: shared));
        }
        return adapters;
    }

    public IReadOnlyList<GpuLiveReading> ReadLive(IReadOnlyList<GpuAdapter> adapters)
    {
        var engines = _provider.GetGpus();
        var memory = SafeMemoryUsage();
        var nvmlMatch = NvmlMatching.ByName(adapters.Select(a => (string?)a.Name).ToList(), _nvml.Devices);

        var readings = new List<GpuLiveReading>(adapters.Count);
        for (var i = 0; i < adapters.Count; i++)
        {
            var adapter = adapters[i];
            var usage = adapter.Index < engines.Count ? engines[adapter.Index].EngineUsage : null;
            var engineLoad = usage is { Count: > 0 } ? GpuMath.AggregateEngines(usage) : null;
            double? utilization = engineLoad is { Count: > 0 } ? engineLoad[0].UsagePercent : null;
            long? used = null, sharedUsed = null, memoryTotal = adapter.DedicatedMemoryBytes;
            if (memory.TryGetValue(adapter.Index, out var m))
            {
                (used, sharedUsed) = (m.Dedicated, m.Shared);
                if (adapter.Integrated == true)
                {
                    // Integrated GPUs allocate from system memory, so "dedicated usage" can exceed the small
                    // firmware carve-out; the meaningful pool is dedicated + shared.
                    used = (m.Dedicated ?? 0) + (m.Shared ?? 0);
                    memoryTotal = (adapter.DedicatedMemoryBytes ?? 0) + (adapter.SharedMemoryBytes ?? 0);
                }
            }

            double? temperature = null, power = null, limit = null;
            int? core = null, memClock = null, fan = null;
            string? pstate = null, source = utilization is null ? null : "performance-counter";
            string? note = utilization is null ? null : "Utilization is the busiest engine, summed across processes as Task Manager does.";

            if (nvmlMatch[i] is not null && _nvml.Devices.ToList().IndexOf(nvmlMatch[i]!) is var idx && idx >= 0 &&
                _nvml.Sample(idx) is { } s)
            {
                utilization = s.UtilizationPercent ?? utilization;
                used = s.MemoryUsedBytes ?? used;
                memoryTotal = s.MemoryTotalBytes ?? adapter.DedicatedMemoryBytes;
                temperature = s.TemperatureC;
                core = s.CoreClockMhz;
                memClock = s.MemoryClockMhz;
                power = s.PowerWatts;
                limit = s.PowerLimitWatts;
                fan = s.FanPercent;
                pstate = s.PerformanceState;
                source = "nvml";
                note = null;
            }

            readings.Add(new GpuLiveReading(adapter.Id, utilization, used, memoryTotal, sharedUsed, GpuMath.Percent(used, memoryTotal), temperature, null, core, memClock,
                power, limit, null, fan, null, pstate, engineLoad, source, note));
        }
        return readings;
    }

    private static Dictionary<int, (long? Dedicated, long? Shared)> SafeMemoryUsage()
    {
        try
        {
            return WindowsSystemInfoProvider.ReadGpuMemoryUsage();
        }
        catch (Exception ex) when (ex is InvalidOperationException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        {
            return [];
        }
    }

    // Intel iGPUs (not Arc) and any adapter with only a small firmware carve-out share system memory.
    private static bool IsUnifiedMemory(string? vendor, string name, long? dedicated, long? shared) =>
        (vendor == "Intel" && !name.Contains("Arc", StringComparison.OrdinalIgnoreCase)) ||
        (shared is > 0 && (dedicated is null || dedicated < 1L << 30));

    private static string? VendorOf(string name) =>
        name.Contains("NVIDIA", StringComparison.OrdinalIgnoreCase) ? "NVIDIA"
        : name.Contains("AMD", StringComparison.OrdinalIgnoreCase) || name.Contains("Radeon", StringComparison.OrdinalIgnoreCase) ? "AMD"
        : name.Contains("Intel", StringComparison.OrdinalIgnoreCase) ? "Intel"
        : null;

    // DXGI's order differs from WMI's, so a multi-GPU system is only matched when exactly one DXGI name fits.
    private static long? SharedFor(string name, int adapterCount, List<(string? Name, long DedicatedBytes, long SharedBytes)> dxgi)
    {
        if (adapterCount == 1 && dxgi.Count == 1) return dxgi[0].SharedBytes > 0 ? dxgi[0].SharedBytes : null;

        var matches = dxgi.Where(d => d.Name is { Length: > 0 } &&
            (d.Name.Contains(name, StringComparison.OrdinalIgnoreCase) || name.Contains(d.Name, StringComparison.OrdinalIgnoreCase))).ToList();
        return matches.Count == 1 && matches[0].SharedBytes > 0 ? matches[0].SharedBytes : null;
    }
}
