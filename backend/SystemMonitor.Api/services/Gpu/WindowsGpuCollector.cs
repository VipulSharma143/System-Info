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

    public IReadOnlyList<GpuLiveReading> ReadLive(IReadOnlyList<GpuAdapter> adapters)
    {
        var instances = SafeEngineInstances();
        // null = counters not ready or missing: every adapter's load is unknown, which is not the same as idle.
        var countersReady = instances is not null;
        var memory = SafeMemoryUsage();
        var nvmlMatch = NvmlMatching.ByName(adapters.Select(a => (string?)a.Name).ToList(), _nvml.Devices);
        var onlyAdapter = adapters.Count == 1;

        var readings = new List<GpuLiveReading>(adapters.Count);
        for (var i = 0; i < adapters.Count; i++)
        {
            var adapter = adapters[i];
            // Each adapter only ever sees the counters carrying its own LUID, so one GPU's load can never be copied to another.
            // A hybrid laptop's discrete GPU gets a new LUID whenever it powers back up, so the LUID saved with the
            // hardware list can be stale; it is re-read from DXGI and the counters re-matched when none fit.
            var luid = ResolveLuid(adapter, adapters.Count, refresh: false);
            var engines = countersReady ? GpuCounters.EnginesFor(luid, onlyAdapter, instances!) : [];
            if (countersReady && engines.Count == 0 && !onlyAdapter)
            {
                luid = ResolveLuid(adapter, adapters.Count, refresh: true);
                engines = GpuCounters.EnginesFor(luid, onlyAdapter, instances!);
            }
            var allEngines = engines.Count > 0 ? GpuMath.AggregateEngines(engines) : null;
            // Idle engines are real zeros; an adapter with no counters at all stays unknown (null).
            double? utilization = allEngines is { Count: > 0 } ? allEngines.Max(e => e.UsagePercent) : null;
            var engineLoad = allEngines?.Where(e => e.UsagePercent > 0.1).ToList() is { Count: > 0 } busy ? busy : null;

            long? used = null, sharedUsed = null, memoryTotal = adapter.DedicatedMemoryBytes;
            if (GpuCounters.MemoryFor(luid, onlyAdapter, memory) is { } m)
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
            string? pstate = null;
            var source = utilization is null ? null : "performance-counter";
            var note = utilization is null
                ? !countersReady ? "Windows has not produced a GPU load sample yet."
                : luid is null && !onlyAdapter ? "This adapter cannot be told apart from the others, so its load is not shown."
                : "Windows reports no load counters for this adapter."
                : "Utilization is the busiest engine, summed across processes as Task Manager does.";

            var nvml = nvmlMatch[i];
            var nvmlIndex = nvml is null ? -1 : IndexOf(_nvml.Devices, nvml);
            if (nvmlIndex >= 0 && _nvml.Sample(nvmlIndex) is { } s)
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
            else if (adapter.Vendor == "NVIDIA")
            {
                // Say why the driver's numbers are missing instead of leaving a blank (or a stale value) unexplained.
                var why = _nvml.Problem ?? "the NVIDIA driver returned no sample";
                note = utilization is null ? $"NVIDIA telemetry unavailable: {why}" : $"Load comes from Windows counters; temperature unavailable: {why}";
            }

            readings.Add(new GpuLiveReading(adapter.Id, utilization, used, memoryTotal, sharedUsed, GpuMath.Percent(used, memoryTotal),
                temperature, null, core, memClock, power, limit, null, fan, null, pstate, engineLoad, source, note));
        }
        return readings;
    }

    private IReadOnlyList<DxgiAdapter> _dxgi = [];
    private long _dxgiAt;

    private long? ResolveLuid(GpuAdapter adapter, int adapterCount, bool refresh)
    {
        var now = Environment.TickCount64;
        if (refresh || _dxgi.Count == 0 || now - _dxgiAt > 10_000)
        {
            if (!refresh || now - _dxgiAt > 1_000)       // a forced refresh is still rate-limited
            {
                _dxgi = WindowsSystemInfoProvider.ReadDxgiAdapters();
                _dxgiAt = now;
            }
        }
        return GpuCounters.MatchDxgi(adapter.Name, adapterCount, _dxgi)?.Luid ?? adapter.Luid;
    }

    private static int IndexOf(IReadOnlyList<NvmlDevice> devices, NvmlDevice device)
    {
        for (var i = 0; i < devices.Count; i++)
        {
            if (ReferenceEquals(devices[i], device)) return i;
        }
        return -1;
    }

    private static IReadOnlyList<GpuEngineUsage>? SafeEngineInstances()
    {
        try
        {
            return GpuEngineSampler.Shared.Sample();
        }
        catch (Exception ex) when (ex is InvalidOperationException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        {
            return null;
        }
    }

    private static Dictionary<long, (long? Dedicated, long? Shared)> SafeMemoryUsage()
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
}
