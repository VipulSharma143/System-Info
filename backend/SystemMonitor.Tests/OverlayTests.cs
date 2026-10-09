using Microsoft.Extensions.Logging.Abstractions;
using SystemMonitor.Api.Services;

// The overlay service and the mapping onto GPU-page adapters, against a fake engine; plus a round trip through the
// real native engine when the library is present (so the JSON schema and the C# model can never drift apart).
static class OverlayTests
{
    sealed class FakeEngine : IOverlayEngine
    {
        public string? Json;
        public string? Problem { get; set; }
        public bool Started, Stopped;
        public bool Start(int intervalMs) { Started = true; return Problem is null; }
        public void Stop() => Stopped = true;
        public string? ReadSnapshotJson() => Json;
    }

    const string Sample = """
    {"schema":1,"seq":7,"sampledAtMs":1700000000000,"intervalMs":500,"platform":"windows",
     "engine":{"isa":2,"asmDemotions":0,"cycleMs":3.1,"nvml":"ok","gpuCounters":"ok"},
     "cpu":{"usagePercent":12.5,"temperatureC":null,"temperatureSource":null,"temperatureNote":"no sensor","clockMhz":3200,"logicalProcessors":2,"busiestCorePercent":20.0,"activeCores":1,
            "cores":[{"u":20.0,"mhz":3300},{"u":5.0,"mhz":null}],"note":null},
     "ram":{"totalBytes":17179869184,"usedBytes":8589934592,"availableBytes":8589934592,"usedPercent":50.0,"cachedBytes":null,"swapTotalBytes":0,"swapUsedBytes":0},
     "gpus":[
      {"id":"gpu-8086a7a0-0","name":"Intel(R) Iris(R) Xe Graphics","luid":"f1a2","vendor":"Intel","kind":"integrated","pciAddress":null,"vendorId":"0x8086","deviceId":"0xa7a0","driverVersion":null,
       "dedicatedBytes":134217728,"sharedBytes":8000000000,"utilizationPercent":4.0,"temperatureC":null,"memoryUsedBytes":500000000,"memoryTotalBytes":8134217728,"memoryPercent":6.1,"sharedUsedBytes":null,
       "powerWatts":null,"powerLimitWatts":null,"coreClockMhz":null,"memoryClockMhz":null,"fanPercent":null,"performanceState":null,"engines":[{"name":"3D","percent":4.0}],
       "source":{"utilization":"windows-counters","temperature":null,"memory":"windows-counters"},"note":null},
      {"id":"gpu-10de2882-0","name":"NVIDIA GeForce RTX 4060 Laptop GPU","luid":"f1b4","vendor":"NVIDIA","kind":"discrete","pciAddress":"0000:01:00.0","vendorId":"0x10de","deviceId":"0x2882","driverVersion":"576.80",
       "dedicatedBytes":8585740288,"sharedBytes":8000000000,"utilizationPercent":71.0,"temperatureC":67.0,"memoryUsedBytes":3200000000,"memoryTotalBytes":8585740288,"memoryPercent":37.3,"sharedUsedBytes":null,
       "powerWatts":62.4,"powerLimitWatts":115.0,"coreClockMhz":2370,"memoryClockMhz":8000,"fanPercent":null,"performanceState":"P0","engines":[],
       "source":{"utilization":"nvml","temperature":"nvml","memory":"nvml"},"note":null}],
     "history":{"intervalMs":500,"cpu":[1.0,null,3.0],"cpuTemp":[],"ram":[50.0],"gpus":{"gpu-10de2882-0":{"usage":[70.0,71.0],"temp":[66.0,67.0],"memory":[37.3]}}}}
    """;

    static GpuAdapter Adapter(string id, string name, string? vendorId = null, string? deviceId = null, string? pci = null, long? luid = null) =>
        new(id, 0, name, null, vendorId, deviceId, pci, null, null, null, null, null, null, null, luid);

    public static async Task<(int Failures, int Checks)> RunAsync()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }

        // ---- service over a fake engine
        var engine = new FakeEngine();
        var service = new OverlayService(engine, NullLogger<OverlayService>.Instance);
        await service.StartAsync(CancellationToken.None);
        Check(engine.Started, "the service starts the engine");
        Check(service.Read() is null, "no snapshot yet reads as null (the endpoint answers 503, not zeros)");

        engine.Json = Sample;
        var snap = service.Read();
        Check(snap is { Seq: 7, Platform: "windows" } && snap.Engine.Isa == 2, "snapshot is parsed");
        Check(snap!.Cpu.UsagePercent == 12.5 && snap.Cpu.TemperatureC is null && snap.Cpu.TemperatureNote == "no sensor", "unavailable CPU temperature stays null with its reason");
        Check(snap.Cpu.Cores.Count == 2 && snap.Cpu.Cores[1].Mhz is null && snap.Cpu.ActiveCores == 1, "per-core values keep their nulls");
        Check(snap.Ram.TotalBytes == 17179869184 && snap.Ram.CachedBytes is null, "64-bit byte counts survive");
        Check(snap.History.Cpu.Count == 3 && snap.History.Cpu[1] is null && snap.History.Gpus["gpu-10de2882-0"].Temp[1] == 67.0, "history series keep gaps as null");
        Check(ReferenceEquals(service.Read(), snap), "an unchanged snapshot is not re-parsed");
        engine.Json = "{ not json";
        Check(ReferenceEquals(service.Read(), snap), "a corrupt snapshot keeps the last good one");
        var waited = await service.ReadWhenReadyAsync(TimeSpan.FromMilliseconds(100));
        Check(waited is not null, "ReadWhenReady returns the available snapshot");
        engine.Json = null; engine.Problem = "native engine missing";
        Check(service.Problem == "native engine missing" && await service.ReadWhenReadyAsync(TimeSpan.FromSeconds(5)) is null, "an unavailable engine is reported, and waiting does not hang");
        await service.StopAsync(CancellationToken.None);
        Check(engine.Stopped, "the service stops the engine");

        // ---- mapping engine GPUs onto GPU-page adapters
        var gpus = snap.Gpus;
        var byLuid = GpuEngineMapper.Map([Adapter("luid-f1b4", "whatever", luid: 0xf1b4), Adapter("luid-f1a2", "other", luid: 0xf1a2)], gpus);
        Check(byLuid[0].TemperatureC == 67.0 && byLuid[0].UtilizationPercent == 71.0 && byLuid[0].Source == "nvml" && byLuid[0].PerformanceState == "P0", "LUID pairs the adapter with its own numbers (NVIDIA temperature and load)");
        Check(byLuid[1].UtilizationPercent == 4.0 && byLuid[1].TemperatureC is null && byLuid[1].Engines![0].InstanceName == "3D", "the iGPU keeps its own numbers, temperature stays null");
        Check(byLuid[0].CoreClockMhz == 2370 && byLuid[0].PowerWatts == 62.4 && byLuid[0].MemoryUsagePercent == 37.3 && byLuid[0].Id == "luid-f1b4", "clocks, power and memory map over, keyed by the page's own id");
        var byPci = GpuEngineMapper.Map([Adapter("0000:01:00.0", "x", pci: "0000:01:00.0")], gpus);
        Check(byPci[0].UtilizationPercent == 71.0, "PCI address pairs Linux adapters");
        var byIds = GpuEngineMapper.Map([Adapter("a", "x", "0x8086", "0xA7A0")], gpus);
        Check(byIds[0].UtilizationPercent == 4.0, "vendor+device ids pair adapters case-insensitively");
        var byName = GpuEngineMapper.Map([Adapter("a", "nvidia geforce rtx 4060 laptop gpu")], gpus);
        Check(byName[0].UtilizationPercent == 71.0, "exact name pairs adapters");
        var unmatched = GpuEngineMapper.Map([Adapter("a", "Mystery"), Adapter("b", "Other")], gpus);
        Check(unmatched.All(r => r.UtilizationPercent is null && r.Note is not null), "an unmatched adapter gets an explanation, never a borrowed number");
        var lone = GpuEngineMapper.Map([Adapter("only", "Anything")], [gpus[1]]);
        Check(lone[0].UtilizationPercent == 71.0, "a single adapter is paired with a single engine GPU");
        var twice = GpuEngineMapper.Map([Adapter("a", "NVIDIA GeForce RTX 4060 Laptop GPU"), Adapter("b", "NVIDIA GeForce RTX 4060 Laptop GPU")], gpus);
        Check(twice[1].UtilizationPercent is null, "one engine GPU is never given to two adapters");

        // ---- the real native engine, when its library is next to the tests
        try
        {
            var native = new NativeOverlayEngine();
            if (native.Start(100))
            {
                var real = new OverlayService(native, NullLogger<OverlayService>.Instance);
                var live = await real.ReadWhenReadyAsync(TimeSpan.FromSeconds(5));
                await Task.Delay(400);
                live = real.Read();
                Check(live is { Schema: 1 } && live.Ram.TotalBytes > 0 && live.Ram.UsedPercent is > 0 and <= 100, "native engine snapshot parses into the C# model with real RAM numbers");
                Check(live!.Cpu.LogicalProcessors > 0 && live.Cpu.UsagePercent is >= 0 and <= 100 && live.Engine.Isa is >= 0 and <= 2, "native CPU numbers are in range and the engine reports its assembly tier");
                Check(live.History.Cpu.Count >= 2, "native history accumulates");
                native.Stop();
            }
            else Console.WriteLine("SKIPPED native overlay engine round trip: " + native.Problem);
        }
        catch (Exception ex) when (ex is DllNotFoundException or BadImageFormatException)
        {
            Console.WriteLine("SKIPPED native overlay engine round trip: library not found.");
        }

        return (failures, checks);
    }
}
