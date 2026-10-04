using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Native;

namespace SystemMonitor.Api.Services;

[SupportedOSPlatform("windows")]
public partial class WindowsSystemInfoProvider
{
    // GPU (spec §11-§13). Static adapter info comes from Win32_VideoController;
    // live per-engine utilization comes from the "GPU Engine" performance
    // counter category, which is only enumerated/attached when present —
    // it doesn't exist on every Windows build/driver combination.
    // The adapter list (WMI + DXGI) is fixed while the app runs; only per-engine utilization is
    // live, so only that is sampled per call. An empty result is not cached.
    private List<GpuInfo>? _gpuAdapters;

    public List<GpuInfo> GetGpus()
    {
        var adapters = _gpuAdapters;
        if (adapters is null)
        {
            adapters = ReadAdapters();
            if (adapters.Count > 0) _gpuAdapters = adapters;
        }
        return AttachEngineUsage(adapters);
    }

    // Start-up cache hooks (see SystemInfoService): seed with the last launch's list, then re-read.
    public void SeedGpuAdapters(List<GpuInfo> adapters) => _gpuAdapters ??= adapters;

    public List<GpuInfo> RefreshGpuAdapters()
    {
        var adapters = ReadAdapters();
        if (adapters.Count > 0) _gpuAdapters = adapters;
        return adapters;
    }

    private List<GpuInfo> ReadAdapters()
    {
        var gpus = new List<GpuInfo>();

        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT Name, VideoProcessor, AdapterRAM, DriverVersion, DriverDate, Status, " +
                "CurrentHorizontalResolution, CurrentVerticalResolution, CurrentRefreshRate " +
                "FROM Win32_VideoController");

            foreach (ManagementObject obj in searcher.Get())
            {
                string? name = obj["Name"]?.ToString();
                string? videoProcessor = obj["VideoProcessor"]?.ToString();

                // Win32_VideoController.AdapterRAM is a 32-bit field and overflows
                // (reports as a small/negative garbage value) for adapters with
                // 4GB+ VRAM — a known WMI limitation, not a bug here. Used only
                // as a last-resort fallback: ApplyDxgiVram() below replaces this
                // with the correct 64-bit value from DXGI whenever DXGI
                // enumeration succeeds and can be confidently matched to this
                // adapter.
                long? adapterRam = null;
                if (obj["AdapterRAM"] is { } ramVal)
                {
                    try
                    {
                        var raw = Convert.ToInt64(ramVal);
                        adapterRam = raw > 0 ? raw : null;
                    }
                    catch
                    {
                        adapterRam = null;
                    }
                }

                string? driverVersion = obj["DriverVersion"]?.ToString();

                string? driverDate = null;
                if (obj["DriverDate"] is { } dateVal)
                {
                    try
                    {
                        driverDate = ManagementDateTimeConverter
                            .ToDateTime(dateVal.ToString()!)
                            .ToString("yyyy-MM-dd");
                    }
                    catch
                    {
                        driverDate = null;
                    }
                }

                string? status = obj["Status"]?.ToString();

                int? ToPositiveInt(object? value)
                {
                    if (value == null) return null;
                    try
                    {
                        var n = Convert.ToInt32(value);
                        return n > 0 ? n : (int?)null;
                    }
                    catch
                    {
                        return null;
                    }
                }

                gpus.Add(new GpuInfo(
                    Name: string.IsNullOrWhiteSpace(name) ? null : name,
                    VideoProcessor: string.IsNullOrWhiteSpace(videoProcessor) ? null : videoProcessor,
                    AdapterMemoryBytes: adapterRam,
                    DriverVersion: string.IsNullOrWhiteSpace(driverVersion) ? null : driverVersion,
                    DriverDate: driverDate,
                    Status: string.IsNullOrWhiteSpace(status) ? null : status,
                    ResolutionWidth: ToPositiveInt(obj["CurrentHorizontalResolution"]),
                    ResolutionHeight: ToPositiveInt(obj["CurrentVerticalResolution"]),
                    RefreshRateHz: ToPositiveInt(obj["CurrentRefreshRate"]),
                    EngineUsage: null,
                    Note: null
                ));
            }
        }
        catch
        {
            // Win32_VideoController unavailable — return whatever we already
            // have (possibly nothing) rather than fabricating an adapter.
        }

        // Replace the (possibly overflowed/null) WMI VRAM figure with the
        // correct 64-bit value from DXGI wherever it can be confidently
        // attributed to an adapter. Never throws past this point — a DXGI
        // failure just leaves the WMI-derived value in place.
        try
        {
            ApplyDxgiVram(gpus);
        }
        catch
        {
            // Leave whatever GetGpus() already built untouched.
        }

        return gpus;
    }

    private static List<GpuInfo> AttachEngineUsage(List<GpuInfo> adapters)
    {
        var gpus = new List<GpuInfo>(adapters);
        List<GpuEngineUsage> engineUsage;
        try
        {
            engineUsage = ReadGpuEngineUsage();
        }
        catch
        {
            engineUsage = new List<GpuEngineUsage>();
        }

        if (gpus.Count == 1 && engineUsage.Count > 0)
        {
            // Only one adapter — every sampled engine belongs to it.
            gpus[0] = gpus[0] with { EngineUsage = engineUsage };
        }
        else if (gpus.Count > 1 && engineUsage.Count > 0)
        {
            // GPU Engine instance names look like
            // "pid_1234_luid_0x...._phys_0_eng_0_engtype_3D" — the "_phys_N_"
            // segment maps to the Nth adapter Win32_VideoController enumerated.
            // Attribute by that when present; otherwise leave that adapter's
            // engine usage unavailable rather than guessing which one it belongs to.
            for (int i = 0; i < gpus.Count; i++)
            {
                var matching = engineUsage
                    .Where(e => e.InstanceName.Contains($"_phys_{i}_", StringComparison.OrdinalIgnoreCase))
                    .ToList();
                if (matching.Count > 0)
                {
                    gpus[i] = gpus[i] with { EngineUsage = matching };
                }
            }
        }

        return gpus;
    }

    // Reads every DXGI adapter's dedicated VRAM (see native_engine.h's
    // get_gpu_vram_bytes) and, wherever it can be attributed to exactly one
    // WMI-enumerated adapter, overwrites that adapter's AdapterMemoryBytes.
    //
    // DXGI's enumeration order is not guaranteed to match
    // Win32_VideoController's, so correlation is done by name rather than
    // by index — except in the single-GPU case, where there is nothing to
    // disambiguate and the index-0 DXGI adapter is unambiguously the one
    // WMI adapter. On a multi-GPU system, a WMI adapter is only updated
    // when exactly one DXGI adapter's description matches its name; zero or
    // multiple matches leave that adapter's VRAM as "unavailable" with an
    // explanatory note rather than guessing.
    private static void ApplyDxgiVram(List<GpuInfo> gpus)
    {
        var dxgiAdapters = ReadDxgiAdapters();
        if (dxgiAdapters.Count == 0) return;

        if (gpus.Count == 1 && dxgiAdapters.Count == 1)
        {
            var vram = dxgiAdapters[0].DedicatedBytes;
            gpus[0] = gpus[0] with { AdapterMemoryBytes = vram > 0 ? vram : null };
            return;
        }

        var used = new bool[dxgiAdapters.Count];
        for (int i = 0; i < gpus.Count; i++)
        {
            var gpuName = gpus[i].Name;
            if (string.IsNullOrWhiteSpace(gpuName)) continue;

            var candidateIndices = new List<int>();
            for (int d = 0; d < dxgiAdapters.Count; d++)
            {
                if (used[d]) continue;
                var dxgiName = dxgiAdapters[d].Name;
                if (string.IsNullOrWhiteSpace(dxgiName)) continue;

                if (dxgiName.Contains(gpuName, StringComparison.OrdinalIgnoreCase) ||
                    gpuName.Contains(dxgiName, StringComparison.OrdinalIgnoreCase))
                {
                    candidateIndices.Add(d);
                }
            }

            if (candidateIndices.Count == 1)
            {
                var d = candidateIndices[0];
                used[d] = true;
                var vram = dxgiAdapters[d].DedicatedBytes;
                gpus[i] = gpus[i] with { AdapterMemoryBytes = vram > 0 ? vram : null };
            }
            else
            {
                gpus[i] = gpus[i] with
                {
                    AdapterMemoryBytes = null,
                    Note = AppendNote(gpus[i].Note, "Dedicated VRAM could not be reliably matched to this adapter.")
                };
            }
        }
    }

    private static string? AppendNote(string? existing, string addition) =>
        string.IsNullOrWhiteSpace(existing) ? addition : $"{existing} {addition}";

    // Loops adapterIndex = 0, 1, 2, ... until get_gpu_vram_bytes reports no
    // such adapter. 16 is a generous sanity ceiling — no real system has
    // more DXGI adapters than that; it only exists to guarantee this loop
    // terminates even if the native side ever returns 1 unexpectedly forever.
    private static List<(string? Name, long DedicatedBytes, long SharedBytes)> ReadDxgiAdapters()
    {
        var results = new List<(string?, long, long)>();
        var nameBuffer = new System.Text.StringBuilder(256);

        for (int i = 0; i < 16; i++)
        {
            nameBuffer.Clear();
            int found = NativeInterop.GetGpuVramBytes(i, nameBuffer, nameBuffer.Capacity, out long dedicated, out long shared);
            if (found == 0) break;
            results.Add((nameBuffer.ToString(), dedicated, shared));
        }

        return results;
    }

    // Samples every "GPU Engine" performance-counter instance twice, 200ms
    // apart (rate counters read 0 on their first sample — same reasoning as
    // the CPU counter's warm-up above). Only engines with non-trivial
    // utilization are returned; an idle engine isn't reported as "0% GPU",
    // it's simply absent (spec §12).
    private static List<GpuEngineUsage> ReadGpuEngineUsage()
    {
        var result = new List<GpuEngineUsage>();

        if (!PerformanceCounterCategory.Exists("GPU Engine"))
            return result;

        string[] instanceNames;
        try
        {
            instanceNames = new PerformanceCounterCategory("GPU Engine").GetInstanceNames();
        }
        catch
        {
            return result;
        }

        var counters = new List<PerformanceCounter>();
        try
        {
            foreach (var name in instanceNames)
            {
                try
                {
                    var counter = new PerformanceCounter("GPU Engine", "Utilization Percentage", name, readOnly: true);
                    counter.NextValue(); // baseline read, always 0
                    counters.Add(counter);
                }
                catch
                {
                    // Instance vanished between enumeration and open — skip it.
                }
            }

            Thread.Sleep(200);

            foreach (var counter in counters)
            {
                try
                {
                    float value = counter.NextValue();
                    if (value > 0.1f)
                    {
                        result.Add(new GpuEngineUsage(counter.InstanceName, Math.Round(value, 2)));
                    }
                }
                catch
                {
                    // skip
                }
            }
        }
        finally
        {
            foreach (var c in counters) c.Dispose();
        }

        return result.OrderByDescending(e => e.UsagePercent).Take(20).ToList();
    }
}
