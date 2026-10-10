using Microsoft.Extensions.Logging.Abstractions;
using SystemMonitor.Api.Services;

// The CPU tab's service: the native document merged with the overlay engine's live numbers, against fixtures; plus a
// round trip through the real native library when it is present, so the JSON schema and the C# model cannot drift.
// Never asserts a specific CPU model, temperature or clock of the machine running it.
static class CpuDetailTests
{
    sealed class FakeCpuEngine : ICpuDetailEngine
    {
        public string? Json;
        public string? Problem { get; set; }
        public string? ReadJson() => Json;
    }

    sealed class FakeOverlayEngine : IOverlayEngine
    {
        public string? Json;
        public string? Problem { get; set; }
        public bool Start(int intervalMs) => true;
        public void Stop() { }
        public string? ReadSnapshotJson() => Json;
    }

    // A hybrid CPU: 2 P-cores with Hyper-Threading (cpu0-3) and 2 E-cores (cpu4-5). Core 8's sensor is the only one with a limit.
    const string Native = """
    {"schema":1,"sampledAtMs":1700000000500,"platform":"linux",
     "identity":{"model":"Fake CPU 9000","vendor":"GenuineIntel","architecture":"x86-64","family":6,"modelId":154,"stepping":3,"virtualized":false},
     "topology":{"packages":1,"physicalCores":4,"logicalProcessors":6,"performanceCores":2,"efficiencyCores":2,"lowPowerCores":null},
     "logical":[{"coreKey":0,"kind":"performance"},{"coreKey":0,"kind":"performance"},{"coreKey":1,"kind":"performance"},{"coreKey":1,"kind":"performance"},{"coreKey":8,"kind":"efficiency"},{"coreKey":9,"kind":"efficiency"}],
     "frequency":{"baseMhz":2500,"baseSource":"cpufreq","maxMhz":4900,"maxSource":"cpufreq","minMhz":800,"policyMaxMhz":4800,"governor":"powersave","driver":"intel_pstate","preference":null,"boost":true},
     "caches":[{"level":1,"type":"Data","totalBytes":163840,"instances":4,"perInstanceBytes":null},{"level":3,"type":"Unified","totalBytes":12582912,"instances":1,"perInstanceBytes":12582912}],
     "features":["SSE2","AVX2"],
     "sensors":[{"label":"Package id 0","kind":"package","coreKey":null,"tempC":61.0,"highC":100.0,"criticalC":105.0},
                {"label":"Core 0","kind":"core","coreKey":0,"tempC":58.0,"highC":null,"criticalC":null},
                {"label":"Core 8","kind":"core","coreKey":8,"tempC":55.0,"highC":100.0,"criticalC":105.0}],
     "sensorsNote":null,
     "power":{"packageWatts":12.5,"limit1Watts":45.0,"limit2Watts":90.0,"source":"rapl","note":null},
     "throttle":{"packageEvents":3,"coreEvents":null},
     "time":{"userPercent":20.0,"systemPercent":10.0,"idlePercent":70.0,"iowaitPercent":0.0,"irqPercent":0.0,"stealPercent":null},
     "system":{"load1":0.52,"load5":0.58,"load15":0.59,"runnableTasks":3,"queueLength":null,"threads":421,"processes":null,"contextSwitchesPerSec":4000,"interruptsPerSec":null,"systemCallsPerSec":null}}
    """;

    const string OverlayTemplate = """
    {"schema":1,"seq":9,"sampledAtMs":1700000001000,"intervalMs":500,"platform":"linux",
     "engine":{"isa":2,"asmDemotions":0,"cycleMs":1.0,"nvml":"ok","gpuCounters":"ok"},
     "cpu":{"usagePercent":33.3,"temperatureC":61.0,"temperatureSource":"coretemp","temperatureNote":null,"clockMhz":3000,"logicalProcessors":__COUNT__,"busiestCorePercent":90.0,"activeCores":2,
            "cores":[__CORES__],"note":null},
     "ram":{"totalBytes":1,"usedBytes":1,"availableBytes":0,"usedPercent":100.0,"cachedBytes":null,"swapTotalBytes":0,"swapUsedBytes":0},
     "gpus":[],
     "history":{"intervalMs":500,"cpu":[10.0,null,30.0],"cpuTemp":[60.0,61.0],"ram":[],"gpus":{}}}
    """;

    // Core 0: 90 % at 2000 MHz; core 1: load not measured; core 2: clock not measured; the rest 5 % at 2000 + 500 * index MHz.
    static string Overlay(int coreCount) => OverlayTemplate
        .Replace("__COUNT__", coreCount.ToString())
        .Replace("__CORES__", string.Join(",", Enumerable.Range(0, coreCount).Select(i =>
            "{\"u\":" + (i == 0 ? "90.0" : i == 1 ? "null" : "5.0") + ",\"mhz\":" + (i == 2 ? "null" : (2000 + i * 500).ToString()) + "}")));

    public static async Task<(int Failures, int Checks)> RunAsync()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }

        var cpuEngine = new FakeCpuEngine();
        var overlayEngine = new FakeOverlayEngine();
        var overlay = new OverlayService(overlayEngine, NullLogger<OverlayService>.Instance);
        var service = new CpuDetailService(cpuEngine, overlay, NullLogger<CpuDetailService>.Instance);

        // ---- nothing readable yet: null (the endpoint answers 503), never an empty document of zeros
        Check(service.Read() is null, "no native document reads as null");
        cpuEngine.Problem = "native CPU reader missing";
        Check(service.Problem == "native CPU reader missing", "an unavailable reader is reported");

        // ---- the native document alone (the overlay engine has produced nothing)
        cpuEngine.Json = Native;
        var alone = service.Read();
        Check(alone is not null && alone.Live is null && alone.Cores.Count == 0, "without live samples there is no live block and no cores — not zeros");
        Check(alone!.Identity.Model == "Fake CPU 9000" && alone.Topology.PhysicalCores == 4 && alone.Topology.LowPowerCores is null, "identity and topology parse, a missing class stays null");
        Check(alone.Frequency.BaseMhz == 2500 && alone.Frequency.Boost == true && alone.Frequency.Preference is null, "frequency keeps values and nulls");
        Check(alone.Caches.Count == 2 && alone.Caches[0].PerInstanceBytes is null && alone.Caches[1].TotalBytes == 12582912, "caches parse with 64-bit sizes and a null per-instance size");
        Check(alone.Activity.Load1 == 0.52 && alone.Activity.Processes is null && alone.Time.StealPercent is null, "activity and time keep their nulls (the 'system' key maps to Activity)");

        // ---- merged with live numbers
        overlayEngine.Json = Overlay(6);
        var merged = service.Read();
        Check(merged is { Live: not null } && merged.Cores.Count == 6 && merged.SampledAtMs == 1700000001000 && merged.IntervalMs == 500, "live block and per-core list appear; freshness follows the live sample");
        Check(merged!.Live!.UsagePercent == 33.3 && merged.Live.TemperatureC == 61.0 && merged.Live.TemperatureSource == "coretemp", "the headline temperature is the overlay engine's (one source for both tabs)");
        Check(merged.Live.HighestClockMhz == 4500 && merged.Live.LowestClockMhz == 2000, "highest / lowest clock come from the measured cores only");
        Check(merged.Cores[1].UsagePercent is null && merged.Cores[2].Mhz is null, "an unmeasured core stays null");
        Check(merged.Cores[0].Kind == "performance" && merged.Cores[4].Kind == "efficiency", "hybrid kind is attached to each logical processor");
        Check(merged.Cores[0].TemperatureC == 58.0 && merged.Cores[1].TemperatureC == 58.0, "SMT siblings share their physical core's temperature");
        Check(merged.Cores[2].TemperatureC is null && merged.Cores[4].TemperatureC == 55.0, "a core with no sensor has no temperature (never borrowed from a neighbour)");
        Check(merged.History.Usage.Count == 3 && merged.History.Usage[1] is null && merged.History.Temperature.Count == 2, "history keeps its gaps");

        // ---- the two engines disagree about how many processors there are: no identity is attached rather than a wrong one
        overlayEngine.Json = Overlay(5);
        var skew = service.Read();
        Check(skew!.Cores.Count == 5 && skew.Cores.All(c => c.Kind is null && c.CoreKey is null && c.TemperatureC is null), "mismatched processor counts attach no kind, key or temperature");

        // ---- corrupt document: the last good one is kept
        cpuEngine.Json = "{ not json";
        Check(service.Read() is { Identity.Model: "Fake CPU 9000" }, "a corrupt native document keeps the last good one");

        // ---- real native library, when its library is next to the tests
        try
        {
            var native = new NativeCpuDetailEngine();
            var json = native.ReadJson();
            if (json is null) Console.WriteLine("SKIPPED native CPU detail round trip: " + (native.Problem ?? "no document"));
            else
            {
                var real = new CpuDetailService(native, overlay, NullLogger<CpuDetailService>.Instance);
                var doc = real.Read();
                Check(doc is not null && doc.Platform is "linux" or "windows", "native CPU document parses into the C# model");
                Check(doc!.Topology.LogicalProcessors is > 0 && (doc.Topology.PhysicalCores is null || doc.Topology.PhysicalCores <= doc.Topology.LogicalProcessors), "topology is self-consistent");
                Check(doc.Sensors.All(s => s.TempC is > 0 and < 126), "every reported sensor value is plausible");
                Check(doc.Caches.All(c => c.Instances > 0 && c.TotalBytes is > 0), "every cache has a size");
                Check(doc.Activity.Load1 is null or >= 0, "load average is non-negative or unknown");
                await Task.Delay(0);
            }
        }
        catch (Exception ex) when (ex is DllNotFoundException or BadImageFormatException)
        {
            Console.WriteLine("SKIPPED native CPU detail round trip: library not found.");
        }

        return (failures, checks);
    }
}
