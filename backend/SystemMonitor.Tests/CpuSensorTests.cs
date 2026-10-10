using Microsoft.Extensions.Logging.Abstractions;
using SystemMonitor.Api.Services;

// Windows CPU temperature: which sensor of a hardware library counts as "the CPU", and how it fills the Overlay / CPU tab
// only where the native engine has nothing. Fixtures only; never asserts anything about the machine running the test.
static class CpuSensorTests
{
    sealed class FakeOverlayEngine : IOverlayEngine
    {
        public string? Json;
        public string? Problem => null;
        public bool Start(int intervalMs) => true;
        public void Stop() { }
        public string? ReadSnapshotJson() => Json;
    }

    sealed class FakeSource(CpuSensorReading? reading) : ICpuSensorSource
    {
        public CpuSensorReading? Read() => reading;
    }

    static string Overlay(string temp) => """
        {"schema":1,"seq":1,"sampledAtMs":1,"intervalMs":500,"platform":"windows",
         "engine":{"isa":2,"asmDemotions":0,"cycleMs":1.0,"nvml":"ok","gpuCounters":"ok"},
         "cpu":{"usagePercent":10.0,"temperatureC":__T__,"temperatureSource":null,"temperatureNote":"native says unavailable","clockMhz":3000,"logicalProcessors":0,"busiestCorePercent":null,"activeCores":null,"cores":[],"note":null},
         "ram":{"totalBytes":1,"usedBytes":1,"availableBytes":0,"usedPercent":100.0,"cachedBytes":null,"swapTotalBytes":0,"swapUsedBytes":0},
         "gpus":[],"history":{"intervalMs":500,"cpu":[1.0,2.0,3.0,4.0],"cpuTemp":[null,null,null,null],"ram":[],"gpus":{}}}
        """.Replace("__T__", temp);

    static RawTemperature T(string n, double? v) => new(n, v);

    public static (int Failures, int Checks) Run()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }
        IReadOnlyList<double?> none = [];

        // ---- Intel: the package sensor is the headline; derived values and broken sensors are ignored
        var intel = CpuSensorSelection.Select([
            T("Core #2", 60), T("Core #1", 58), T("CPU Package", 65), T("Core Max", 66), T("Core Average", 59),
            T("Core #1 Distance to TjMax", 40), T("Core #3", 0), T("Core #4", null)], null, none);
        Check(intel.PackageC == 65 && intel.PackageLabel == "CPU Package" && intel.Note is null, "Intel headline is CPU Package, no note");
        Check(intel.Sensors.Select(s => s.Label).SequenceEqual(["CPU Package", "Core #1", "Core #2"]), "package first, cores in order, derived and broken sensors dropped");
        Check(intel.Sensors.All(s => s.CoreKey is null), "a library core number is never passed off as an OS core key");

        // ---- the library's Intel naming ("CPU Core #N") counts as per-core sensors too
        var intelNamed = CpuSensorSelection.Select([T("CPU Core #2", 57), T("CPU Core #1", 55)], null, none);
        Check(intelNamed.PackageC == 57 && intelNamed.Sensors.Count(s => s.Kind == "core") == 2, "CPU Core #N names are per-core sensors");

        // ---- the reason for a missing reading says what is actually wrong
        Check(CpuSensorSelection.ExplainMissingTemperature(false, true).Contains("not running as administrator"), "not elevated is named first");
        Check(CpuSensorSelection.ExplainMissingTemperature(true, false).Contains("PawnIO"), "elevated without the driver names the driver");
        Check(!CpuSensorSelection.ExplainMissingTemperature(true, true).Contains("not running"), "elevated with the driver blames the processor, not the user");

        // ---- AMD: Tctl/Tdie headline, chiplets listed separately and never averaged in
        var amd = CpuSensorSelection.Select([T("CCD1 (Tdie)", 52), T("Core (Tctl/Tdie)", 61), T("CCD2 (Tdie)", 50)], null, none);
        Check(amd.PackageC == 61 && amd.Sensors.Count(s => s.Kind == "ccd") == 2, "AMD headline is Tctl/Tdie, CCDs listed");

        // ---- cores only: the hottest core is used and the note says so
        var coresOnly = CpuSensorSelection.Select([T("Core #1", 50), T("Core #2", 57)], null, none);
        Check(coresOnly.PackageC == 57 && coresOnly.PackageLabel!.Contains("hottest core") && coresOnly.Note is not null, "no package sensor: hottest core, labelled");

        // ---- nothing usable: null plus a reason, never 0
        var empty = CpuSensorSelection.Select([], null, none);
        Check(empty.PackageC is null && empty.Sensors.Count == 0 && empty.Note!.Contains("administrator"), "no sensors: null with an explanation");
        var failed = CpuSensorSelection.Select([], "The library could not start.", none);
        Check(failed.PackageC is null && failed.Note!.StartsWith("The library could not start."), "a failure reason is kept");
        Check(CpuSensorSelection.Select([T("CPU Package", 0), T("CPU Package", 130)], null, none).PackageC is null, "0 and 130 are broken sensors, not temperatures");

        // ---- overlay: filled only where the native engine has nothing
        var engine = new FakeOverlayEngine { Json = Overlay("null") };
        var plain = new OverlayService(engine, NullLogger<OverlayService>.Instance);
        Check(plain.Read()!.Cpu.TemperatureC is null, "without a managed source the native 'unavailable' stands");

        var withSensor = new OverlayService(engine, NullLogger<OverlayService>.Instance,
            new FakeSource(CpuSensorSelection.Select([T("CPU Package", 64)], null, [null, 63.0, 64.0])));
        var filled = withSensor.Read()!;
        Check(filled.Cpu.TemperatureC == 64 && filled.Cpu.TemperatureSource == CpuSensorSelection.Source && filled.Cpu.TemperatureNote is null, "temperature, source and cleared note");
        Check(filled.History.CpuTemp.Count == 4 && filled.History.CpuTemp[0] is null && filled.History.CpuTemp[1] is null && filled.History.CpuTemp[3] == 64.0, "trend is aligned to the engine's length, newest last, gaps null");

        var noValue = new OverlayService(engine, NullLogger<OverlayService>.Instance, new FakeSource(empty)).Read()!;
        Check(noValue.Cpu.TemperatureC is null && noValue.Cpu.TemperatureNote!.Contains("administrator"), "no managed value: still null, with the better reason");

        engine.Json = Overlay("55.0");
        var native = new OverlayService(engine, NullLogger<OverlayService>.Instance, new FakeSource(intel)).Read()!;
        Check(native.Cpu.TemperatureC == 55.0 && native.Cpu.TemperatureSource is null, "a native value is never replaced");

        // ---- CPU tab merge: managed sensors only when native has none
        var cpuNative = System.Text.Json.JsonSerializer.Deserialize<NativeCpuDetail>(
            """{"schema":1,"sampledAtMs":1,"platform":"windows","identity":{},"topology":{},"logical":[],"frequency":{},"caches":[],"features":[],"sensors":[],"sensorsNote":"native note","power":{},"throttle":{},"time":{},"system":{}}""",
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!;
        var merged = CpuDetailService.Merge(cpuNative, null, intel);
        Check(merged.Sensors.Count == 3 && merged.SensorsNote is null, "managed sensors fill an empty native list and clear the note");
        var unmerged = CpuDetailService.Merge(cpuNative, null, empty);
        Check(unmerged.Sensors.Count == 0 && unmerged.SensorsNote!.Contains("administrator"), "no managed sensors: empty list, honest reason");
        Check(CpuDetailService.Merge(cpuNative, null).SensorsNote == "native note", "no managed source: native note unchanged");

        return (failures, checks);
    }
}
