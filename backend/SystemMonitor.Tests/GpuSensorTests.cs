using Microsoft.Extensions.Logging.Abstractions;
using SystemMonitor.Api.Services;

// Windows integrated-GPU temperature: which library sensor counts, how a library adapter is paired with the engine's adapter,
// and that the value only ever fills a gap (never replaces a native value, never reaches a discrete adapter, never invented).
// Fixtures only; never asserts anything about the machine running the test.
static class GpuSensorTests
{
    sealed class FakeOverlayEngine : IOverlayEngine
    {
        public string? Json;
        public string? Problem => null;
        public bool Start(int intervalMs) => true;
        public void Stop() { }
        public string? ReadSnapshotJson() => Json;
    }

    sealed class FakeCpu(CpuSensorReading? reading) : ICpuSensorSource
    {
        public CpuSensorReading? Read() => reading;
    }

    sealed class FakeGpu(GpuSensorSnapshot? snapshot) : IGpuSensorSource
    {
        public int Reads;
        public GpuSensorSnapshot? Read() { Reads++; return snapshot; }
    }

    static string Gpu(string id, string name, string vendorId, string kind, string temp, string tempSource = "null", string note = "null") =>
        $$"""{"id":"{{id}}","name":"{{name}}","luid":null,"vendor":null,"kind":"{{kind}}","pciAddress":null,"vendorId":"{{vendorId}}","deviceId":null,"driverVersion":null,"dedicatedBytes":null,"sharedBytes":null,"utilizationPercent":5.0,"temperatureC":{{temp}},"memoryUsedBytes":null,"memoryTotalBytes":null,"memoryPercent":null,"sharedUsedBytes":null,"powerWatts":null,"powerLimitWatts":null,"coreClockMhz":null,"memoryClockMhz":null,"fanPercent":null,"performanceState":null,"engines":[],"source":{"utilization":"windows-counters","temperature":{{tempSource}},"memory":null},"note":{{note}}}""";

    static string Overlay(params string[] gpus)
    {
        var history = string.Join(",", gpus
            .Select(g => System.Text.Json.JsonDocument.Parse(g).RootElement.GetProperty("id").GetString())
            .Select(id => "\"" + id + "\":{\"usage\":[1,2,3,4],\"temp\":[null,null,null,null],\"memory\":[null,null,null,null]}"));
        return $$"""
            {"schema":1,"seq":1,"sampledAtMs":1,"intervalMs":500,"platform":"windows",
             "engine":{"isa":2,"asmDemotions":0,"cycleMs":1.0,"nvml":"ok","gpuCounters":"ok"},
             "cpu":{"usagePercent":10.0,"temperatureC":null,"temperatureSource":null,"temperatureNote":"native says unavailable","clockMhz":3000,"logicalProcessors":0,"busiestCorePercent":null,"activeCores":null,"cores":[],"note":null},
             "ram":{"totalBytes":1,"usedBytes":1,"availableBytes":0,"usedPercent":100.0,"cachedBytes":null,"swapTotalBytes":0,"swapUsedBytes":0},
             "gpus":[{{string.Join(",", gpus)}}],
             "history":{"intervalMs":500,"cpu":[1.0,2.0,3.0,4.0],"cpuTemp":[null,null,null,null],"ram":[],"gpus":{ {{history}} } } }
            """;
    }

    static GpuSensorAdapter A(string vendor, string name, double? core, params double?[] history) =>
        new(vendor, name, core, history.Length > 0 ? history : [core]);

    static OverlaySnapshot Read(string json, IGpuSensorSource? gpu, ICpuSensorSource? cpu = null)
    {
        var engine = new FakeOverlayEngine { Json = json };
        return new OverlayService(engine, NullLogger<OverlayService>.Instance, cpu, gpu).Read()!;
    }

    const string Intel = GpuSensorSelection.IntelVendorId, Amd = GpuSensorSelection.AmdVendorId;

    public static (int Failures, int Checks) Run()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }
        static RawTemperature T(string n, double? v) => new(n, v);

        var igpu = Gpu("gpu-intel", "Intel(R) UHD Graphics 770", "0x8086", "integrated", "null");
        var nvidia = Gpu("gpu-nv", "NVIDIA GeForce RTX 4060", "0x10de", "discrete", "58.0", "\"nvml\"");

        // ---- which sensor counts: only "GPU Core"; other temperatures are different quantities, broken values are dropped
        Check(GpuSensorSelection.PickCore([T("GPU Hot Spot", 80), T("GPU Core", 61), T("GPU Memory", 70), T("GPU VR SoC", 66)]) == 61, "GPU Core is the headline, hot spot/memory/regulator ignored");
        Check(GpuSensorSelection.PickCore([T("GPU Hot Spot", 80), T("GPU Memory", 70)]) is null, "no GPU Core sensor: null, another sensor is never substituted");
        Check(GpuSensorSelection.PickCore([T("GPU Core", 0)]) is null && GpuSensorSelection.PickCore([T("GPU Core", 130)]) is null && GpuSensorSelection.PickCore([T("GPU Core", null)]) is null, "0, 130 and null are not temperatures");
        Check(GpuSensorSelection.PickCore([T(" gpu core ", 55)]) == 55, "sensor name compare ignores case and padding");

        // ---- names compare without the trademark marks drivers add inconsistently
        Check(GpuSensorSelection.Normalize("Intel(R) UHD Graphics 770") == GpuSensorSelection.Normalize("Intel UHD Graphics 770"), "(R) and spacing do not matter");
        Check(GpuSensorSelection.Normalize("AMD Radeon(TM) Graphics") == "amdradeongraphics", "(TM) dropped, lower-case letters and digits kept");
        Check(GpuSensorSelection.Normalize(null) == "" && GpuSensorSelection.Normalize("  ") == "", "null / blank name normalise to empty");

        // ---- who is asked for a temperature
        OverlaySnapshot Parse(params string[] g) => Read(Overlay(g), null);
        Check(GpuSensorSelection.Wants(Parse(igpu).Gpus[0]), "integrated Intel without a temperature is wanted");
        Check(GpuSensorSelection.Wants(Parse(Gpu("a", "AMD Radeon(TM) Graphics", "0x1002", "integrated", "null")).Gpus[0]), "integrated AMD without a temperature is wanted");
        Check(!GpuSensorSelection.Wants(Parse(nvidia).Gpus[0]), "a discrete NVIDIA adapter is never wanted");
        Check(!GpuSensorSelection.Wants(Parse(Gpu("a", "AMD Radeon RX 7800 XT", "0x1002", "discrete", "null")).Gpus[0]), "a discrete AMD adapter is never wanted");
        Check(!GpuSensorSelection.Wants(Parse(Gpu("a", "Intel(R) UHD Graphics", "0x8086", "integrated", "48.0", "\"nvml\"")).Gpus[0]), "an adapter that already has a native temperature is not wanted");
        Check(!GpuSensorSelection.Wants(Parse(Gpu("a", "Mystery GPU", "0x1234", "integrated", "null")).Gpus[0]), "an unknown vendor is not asked of the Intel/AMD library path");

        // ---- no managed source: the engine's snapshot is returned untouched (every non-Windows host)
        var plain = Read(Overlay(igpu), null);
        Check(plain.Gpus[0].TemperatureC is null && plain.Gpus[0].Note is null && plain.Gpus[0].Source.Temperature is null, "without a source nothing changes");

        // ---- the main case: hybrid laptop. The iGPU is filled; the NVIDIA GPU keeps its native value and source untouched
        var good = new FakeGpu(new GpuSensorSnapshot([A(Intel, "Intel(R) UHD Graphics 770", 52.0, null, 50.0, 51.0, 52.0)], null));
        var hybrid = Read(Overlay(igpu, nvidia), good);
        Check(hybrid.Gpus[0].TemperatureC == 52.0 && hybrid.Gpus[0].Source.Temperature == GpuSensorSelection.Source && hybrid.Gpus[0].Note is null, "iGPU gets the library temperature, labelled with its source, no note");
        Check(hybrid.Gpus[1].TemperatureC == 58.0 && hybrid.Gpus[1].Source.Temperature == "nvml" && hybrid.Gpus[1].Note is null, "the dedicated GPU's native value and source are unchanged");
        Check(hybrid.Gpus[0].UtilizationPercent == 5.0 && hybrid.Gpus[0].Source.Utilization == "windows-counters", "other iGPU fields are untouched");
        var hist = hybrid.History.Gpus["gpu-intel"].Temp;
        Check(hist.Count == 4 && hist[0] is null && hist[1] == 50.0 && hist[3] == 52.0, "temperature trend aligned to the engine's length, newest last, gap null");
        Check(hybrid.History.Gpus["gpu-nv"].Temp.All(v => v is null), "the dedicated GPU's history is untouched");

        // ---- a native value is never replaced, and the library is not even consulted
        var native = new FakeGpu(new GpuSensorSnapshot([A(Intel, "Intel(R) UHD Graphics 770", 99.0)], null));
        var nativeRead = Read(Overlay(Gpu("gpu-intel", "Intel(R) UHD Graphics 770", "0x8086", "integrated", "47.0", "\"sysfs\"")), native);
        Check(nativeRead.Gpus[0].TemperatureC == 47.0 && nativeRead.Gpus[0].Source.Temperature == "sysfs" && native.Reads == 0, "a native iGPU value stands and the library is not read");

        // ---- gating: a machine with no integrated Intel/AMD adapter never touches the library
        var idle = new FakeGpu(good.Read());
        Read(Overlay(nvidia), idle);
        Read(Overlay(Gpu("a", "AMD Radeon RX 7800 XT", "0x1002", "discrete", "null")), idle);
        Check(idle.Reads == 0, "no integrated adapter needing a temperature: the library source is never read");

        // ---- not sampled yet: nothing is shown or claimed
        var early = Read(Overlay(igpu), new FakeGpu(null));
        Check(early.Gpus[0].TemperatureC is null && early.Gpus[0].Note is null, "before the first library sample the engine's state stands");

        // ---- the adapter has no usable sensor: null plus the reason, never a number
        var noSensor = Read(Overlay(igpu), new FakeGpu(new GpuSensorSnapshot([A(Intel, "Intel(R) UHD Graphics 770", null)], null)));
        Check(noSensor.Gpus[0].TemperatureC is null && noSensor.Gpus[0].Note == GpuSensorSelection.NoSensorNote && noSensor.Gpus[0].Source.Temperature is null, "driver without a temperature sensor: null with an explanation");

        // ---- the library cannot read adapters at all: its own reason is shown
        var broken = Read(Overlay(igpu), new FakeGpu(new GpuSensorSnapshot([], "The hardware sensor library could not read the graphics adapters (X).")));
        Check(broken.Gpus[0].TemperatureC is null && broken.Gpus[0].Note!.Contains("could not read the graphics adapters"), "library failure: null with the failure reason");

        // ---- the library lists nothing for this vendor
        var missing = Read(Overlay(igpu), new FakeGpu(new GpuSensorSnapshot([A(Amd, "AMD Radeon(TM) Graphics", 60.0)], null)));
        Check(missing.Gpus[0].TemperatureC is null && missing.Gpus[0].Note == GpuSensorSelection.NotListedNote, "an AMD library entry is never given to an Intel adapter");

        // ---- an existing engine note is kept, the explanation is appended
        var withNote = Read(Overlay(Gpu("gpu-intel", "Intel(R) UHD Graphics 770", "0x8086", "integrated", "null", "null", "\"Windows has not produced a GPU load sample yet.\"")),
            new FakeGpu(new GpuSensorSnapshot([A(Intel, "Intel(R) UHD Graphics 770", null)], null)));
        Check(withNote.Gpus[0].Note == "Windows has not produced a GPU load sample yet. " + GpuSensorSelection.NoSensorNote, "existing note is kept and extended, not overwritten");

        // ---- pairing safety
        var arc = Gpu("gpu-arc", "Intel(R) Arc(TM) A380 Graphics", "0x8086", "discrete", "null");
        // by name, even though the library lists the discrete card first
        var byName = Read(Overlay(igpu, arc), new FakeGpu(new GpuSensorSnapshot([A(Intel, "Intel(R) Arc(TM) A380 Graphics", 70.0), A(Intel, "Intel(R) UHD Graphics 770", 44.0)], null)));
        Check(byName.Gpus[0].TemperatureC == 44.0 && byName.Gpus[1].TemperatureC is null, "iGPU paired by name; the discrete Arc is never filled and never lends its value");
        // different names, but only one adapter of the vendor on both sides: paired by elimination
        var lone = Read(Overlay(igpu), new FakeGpu(new GpuSensorSnapshot([A(Intel, "Intel Graphics", 46.0)], null)));
        Check(lone.Gpus[0].TemperatureC == 46.0, "lone adapter on both sides is paired even when the driver names it differently");
        // the engine also has a discrete Intel card, the library lists one differently named entry: it could be the Arc, so no number
        var risky = Read(Overlay(igpu, arc), new FakeGpu(new GpuSensorSnapshot([A(Intel, "Intel Graphics", 71.0)], null)));
        Check(risky.Gpus[0].TemperatureC is null && risky.Gpus[0].Note == GpuSensorSelection.AmbiguousNote, "a possibly-discrete library entry is not assigned to the iGPU");
        // two library entries both match the name
        var twins = Read(Overlay(igpu), new FakeGpu(new GpuSensorSnapshot([A(Intel, "Intel(R) UHD Graphics 770", 40.0), A(Intel, "Intel UHD Graphics 770", 41.0)], null)));
        Check(twins.Gpus[0].TemperatureC is null && twins.Gpus[0].Note == GpuSensorSelection.AmbiguousNote, "two equally named library entries: no guess");
        // two identical engine adapters: neither is guessed
        var two = Read(Overlay(Gpu("g1", "Intel(R) UHD Graphics 770", "0x8086", "integrated", "null"), Gpu("g2", "Intel(R) UHD Graphics 770", "0x8086", "integrated", "null")),
            new FakeGpu(new GpuSensorSnapshot([A(Intel, "Intel(R) UHD Graphics 770", 40.0)], null)));
        Check(two.Gpus.All(g => g.TemperatureC is null), "identically named engine adapters are not paired by guesswork");
        // AMD APU next to a discrete AMD card: names decide
        var apu = Gpu("gpu-apu", "AMD Radeon(TM) Graphics", "0x1002", "integrated", "null");
        var rx = Gpu("gpu-rx", "AMD Radeon RX 7800 XT", "0x1002", "discrete", "null");
        var amd = Read(Overlay(apu, rx), new FakeGpu(new GpuSensorSnapshot([A(Amd, "AMD Radeon RX 7800 XT", 66.0), A(Amd, "AMD Radeon(TM) Graphics", 49.0)], null)));
        Check(amd.Gpus[0].TemperatureC == 49.0 && amd.Gpus[1].TemperatureC is null, "AMD APU takes its own sensor; the discrete AMD card stays untouched");

        // ---- the input snapshot is never modified (records are shared with the cached native snapshot)
        var engine = new FakeOverlayEngine { Json = Overlay(igpu) };
        var service = new OverlayService(engine, NullLogger<OverlayService>.Instance, null, good);
        _ = service.Read();
        engine.Json = Overlay(igpu);   // same content; a second read must start from the engine's own values again
        Check(service.Read()!.Gpus[0].Note is null, "repeated reads do not accumulate notes");

        // ---- the CPU temperature merge is unaffected when both sources exist
        var cpuReading = CpuSensorSelection.Select([T("CPU Package", 64)], null, [null, 63.0, 64.0]);
        var both = Read(Overlay(igpu), good, new FakeCpu(cpuReading));
        Check(both.Cpu.TemperatureC == 64 && both.Cpu.TemperatureSource == CpuSensorSelection.Source && both.Gpus[0].TemperatureC == 52.0, "CPU and iGPU are both filled, each from its own source");
        var cpuOnly = Read(Overlay(igpu), null, new FakeCpu(cpuReading));
        Check(cpuOnly.Cpu.TemperatureC == 64 && cpuOnly.Gpus[0].TemperatureC is null, "with no GPU source the CPU path behaves exactly as before");

        return (failures, checks);
    }
}
