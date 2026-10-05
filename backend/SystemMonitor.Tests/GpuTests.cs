using SystemMonitor.Api.Interface;
using Microsoft.Extensions.Logging.Abstractions;
using SystemMonitor.Api.Services;

// A fake /sys tree stands in for real hardware, so every vendor shape is covered on any machine.
static class GpuTests
{
    sealed class FakeNvml : INvmlSource
    {
        public bool IsAvailable { get; init; } = true;
        public string? DriverVersion => "550.54";
        public IReadOnlyList<NvmlDevice> Devices { get; init; } = [];
        public int Samples;
        public NvmlSample? Sample(int i) { Samples++; return new NvmlSample(34, 3_200_000_000, 8_000_000_000, 58, 2100, 8000, 48, 115, 40, "P2"); }
    }

    sealed class FakeCollector : IGpuCollector
    {
        public int HardwareReads, LiveReads;
        public bool Throw;
        public IReadOnlyList<GpuAdapter> ReadHardware()
        {
            HardwareReads++;
            if (Throw) throw new InvalidOperationException("driver exploded");
            return [new GpuAdapter("a", 0, "Test GPU", "NVIDIA", null, null, null, null, null, null, false, true, 1000, null)];
        }
        public IReadOnlyList<GpuLiveReading> ReadLive(IReadOnlyList<GpuAdapter> a)
        {
            LiveReads++;
            return a.Select(x => new GpuLiveReading(x.Id, 10, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null)).ToList();
        }
    }

    static void Write(string path, string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
    }

    static void Card(string sys, string card, string pci, string vendor, string device, string driver, bool bootVga)
    {
        var d = Path.Combine(sys, "class", "drm", card, "device");
        Write(Path.Combine(d, "vendor"), vendor + "\n");
        Write(Path.Combine(d, "device"), device + "\n");
        Write(Path.Combine(d, "uevent"), $"DRIVER={driver}\nPCI_SLOT_NAME={pci}\n");
        Write(Path.Combine(d, "boot_vga"), bootVga ? "1\n" : "0\n");
    }

    public static async Task<(int Failures, int Checks)> RunAsync()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }

        var root = Path.Combine(Path.GetTempPath(), "sysinfo-gpu-" + Guid.NewGuid().ToString("N"));
        try
        {
            var sys = Path.Combine(root, "sys");
            var pciIds = Path.Combine(root, "pci.ids");
            Write(pciIds, "# comment\n1002  Advanced Micro Devices, Inc. [AMD/ATI]\n\t73ff  Navi 23 [Radeon RX 6600]\n\t7340  Navi 14\n8086  Intel Corporation\n\t9a49  TigerLake-LP GT2 [Iris Xe Graphics]\nC 00  Unclassified device\n");
            var ids = new PciIds(pciIds);

            Check(ids.Lookup("0x1002", "0x73ff") is ("Advanced Micro Devices, Inc. [AMD/ATI]", "Navi 23 [Radeon RX 6600]"), "pci.ids resolves vendor and device");
            Check(ids.Lookup("0x1002", "0xffff") is ("Advanced Micro Devices, Inc. [AMD/ATI]", null), "unknown device still resolves the vendor");
            Check(ids.Lookup("0x9999", "0x0001") is (null, null), "unknown vendor resolves to nothing");
            Check(new PciIds(Path.Combine(root, "missing")).Lookup("0x1002", "0x73ff") is (null, null), "missing pci.ids is not an error");

            var collector = new LinuxGpuCollector(new FakeNvml(), ids, sys);
            Check(collector.ReadHardware().Count == 0, "no drm directory means no GPUs, not an exception");

            Card(sys, "card0", "0000:00:02.0", "0x8086", "0x9a49", "i915", bootVga: true);
            Card(sys, "card1", "0000:03:00.0", "0x1002", "0x73ff", "amdgpu", bootVga: false);
            Directory.CreateDirectory(Path.Combine(sys, "class", "drm", "card1-HDMI-A-1"));
            Directory.CreateDirectory(Path.Combine(sys, "class", "drm", "renderD128"));
            Write(Path.Combine(sys, "class", "drm", "card1", "device", "mem_info_vram_total"), "8589934592\n");
            Write(Path.Combine(sys, "class", "drm", "card1", "device", "mem_info_vram_used"), "2147483648\n");
            Write(Path.Combine(sys, "class", "drm", "card1", "device", "mem_info_gtt_total"), "16777216000\n");
            Write(Path.Combine(sys, "class", "drm", "card1", "device", "gpu_busy_percent"), "42\n");
            var hw = Path.Combine(sys, "class", "drm", "card1", "device", "hwmon", "hwmon3");
            Write(Path.Combine(hw, "temp1_input"), "61000\n");
            Write(Path.Combine(hw, "temp1_label"), "edge\n");
            Write(Path.Combine(hw, "temp2_input"), "75000\n");
            Write(Path.Combine(hw, "temp2_label"), "junction\n");
            Write(Path.Combine(hw, "temp3_input"), "70000\n");
            Write(Path.Combine(hw, "temp3_label"), "mem\n");
            Write(Path.Combine(hw, "power1_average"), "48000000\n");
            Write(Path.Combine(hw, "power1_cap"), "132000000\n");
            Write(Path.Combine(hw, "fan1_input"), "1200\n");
            Write(Path.Combine(hw, "pwm1"), "128\n");
            Write(Path.Combine(hw, "freq1_input"), "2100000000\n");
            Write(Path.Combine(hw, "freq2_input"), "875000000\n");
            Write(Path.Combine(hw, "in0_input"), "1050\n");

            var adapters = collector.ReadHardware();
            Check(adapters.Count == 2, "connectors and render nodes are not counted as GPUs");
            Check(adapters[0].Vendor == "Intel" && adapters[0].Integrated == true && adapters[0].Primary == true, "Intel iGPU on bus 00 is integrated and primary");
            Check(adapters[0].DedicatedMemoryBytes is null, "an iGPU without VRAM files reports no dedicated memory, not zero");
            Check(adapters[1].Vendor == "AMD" && adapters[1].Integrated == false && adapters[1].Driver == "amdgpu", "AMD card behind a bridge is discrete");
            Check(adapters[1].Name.Contains("Navi 23") && adapters[1].DedicatedMemoryBytes == 8589934592 && adapters[1].SharedMemoryBytes == 16777216000, "AMD name and memory come from pci.ids and sysfs");
            Check(adapters[1].Id == "0000:03:00.0" && adapters[1].PciAddress == "0000:03:00.0", "adapters are identified by PCI address");

            var live = collector.ReadLive(adapters);
            var amd = live[1];
            Check(amd.UtilizationPercent == 42 && amd.MemoryUsedBytes == 2147483648 && amd.MemoryUsagePercent == 25.0, "AMD utilization and VRAM percentage");
            Check(amd.TemperatureC == 61 && amd.MemoryTemperatureC == 70, "edge temperature is the headline, memory temperature is separate");
            Check(amd.PowerWatts == 48 && amd.PowerLimitWatts == 132, "power in watts from microwatts");
            Check(amd.FanRpm == 1200 && amd.FanPercent == 50, "fan rpm and pwm percentage");
            Check(amd.CoreClockMhz == 2100 && amd.MemoryClockMhz == 875 && amd.VoltageV == 1.05, "clocks and voltage");
            Check(live[0].UtilizationPercent is null && live[0].TemperatureC is null && live[0].Note is not null, "Intel iGPU unavailable values stay null with an explanation");

            Write(Path.Combine(sys, "class", "drm", "card0", "gt_cur_freq_mhz"), "1100\n");
            Check(collector.ReadLive(adapters)[0].CoreClockMhz == 1100, "i915 current frequency is read when present");

            // NVIDIA: NVML supplies the numbers and is matched by PCI address.
            Card(sys, "card2", "0000:01:00.0", "0x10de", "0x2882", "nvidia", bootVga: false);
            var nvml = new FakeNvml { Devices = [new NvmlDevice("NVIDIA GeForce RTX 4060", "0000:01:00.0", "0x10de", "0x2882", 8_000_000_000)] };
            var withNvidia = new LinuxGpuCollector(nvml, ids, sys);
            var all = withNvidia.ReadHardware();
            var nv = all.Single(a => a.Vendor == "NVIDIA");
            Check(all.Count == 3 && nv.Name == "NVIDIA GeForce RTX 4060" && nv.DedicatedMemoryBytes == 8_000_000_000 && nv.DriverVersion == "550.54", "NVIDIA name, VRAM and driver come from NVML");
            var nvLive = withNvidia.ReadLive(all).Single(r => r.Id == nv.Id);
            Check(nvLive.UtilizationPercent == 34 && nvLive.MemoryUsagePercent == 40.0 && nvLive.TemperatureC == 58 && nvLive.PerformanceState == "P2" && nvLive.Source == "nvml", "NVIDIA telemetry through NVML");

            var noNvml = new LinuxGpuCollector(new FakeNvml { IsAvailable = false }, ids, sys);
            var fallback = noNvml.ReadHardware().Single(a => a.Vendor == "NVIDIA");
            Check(fallback.Name.StartsWith("NVIDIA") && noNvml.ReadLive([fallback])[0].Note is not null && noNvml.ReadLive([fallback])[0].UtilizationPercent is null, "NVIDIA without NVML degrades with a note and no fake numbers");

            Directory.Delete(Path.Combine(sys, "class", "drm", "card2"), true);
            Check(noNvml.ReadLive([fallback])[0].Note is not null, "an adapter that disappeared yields an empty reading, not an exception");

            var m = NvmlMatching.ByName(["NVIDIA GeForce RTX 4060", "NVIDIA GeForce RTX 3050", "Intel UHD"],
                [new NvmlDevice("NVIDIA GeForce RTX 3050", null, null, null, 1), new NvmlDevice("NVIDIA GeForce RTX 4060", null, null, null, 2)]);
            Check(m[0]?.MemoryTotalBytes == 2 && m[1]?.MemoryTotalBytes == 1 && m[2] is null, "NVML devices are paired by name and Intel gets none");
            var dup = NvmlMatching.ByName(["NVIDIA X", "NVIDIA X"], [new NvmlDevice("NVIDIA X", null, null, null, 1), new NvmlDevice("NVIDIA X", null, null, null, 2)]);
            Check(dup[0]?.MemoryTotalBytes == 1 && dup[1]?.MemoryTotalBytes == 2, "identical GPUs are paired one-to-one");
            Check(GpuMath.Percent(829_700_000, 128_000_000) == 100.0, "usage above the pool total is clamped, never 648%");
            Check(GpuMath.Percent(1_000, 0) is null && GpuMath.Percent(null, 10) is null, "no total or no usage means no percentage");
            var agg = GpuMath.AggregateEngines([
                new GpuEngineUsage("pid_1_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 23), new GpuEngineUsage("pid_2_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 7),
                new GpuEngineUsage("pid_3_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 1), new GpuEngineUsage("pid_2_luid_0x0_0x1_phys_0_eng_1_engtype_Copy", 2),
                new GpuEngineUsage("pid_4_luid_0x0_0x1_phys_0_eng_0_engtype_VideoDecode", 80), new GpuEngineUsage("pid_5_luid_0x0_0x1_phys_0_eng_0_engtype_VideoDecode", 60)]);
            Check(agg.Count == 3 && agg[0].InstanceName == "VideoDecode" && agg[0].UsagePercent == 100 && agg[1].InstanceName == "3D" && agg[1].UsagePercent == 31, "engine instances are summed per engine across processes, capped at 100");
            Check(GpuMath.AggregateEngines([new GpuEngineUsage("garbage", 5)]).Count == 0, "unrecognised engine names are ignored");
            Check(NvmlGpuSource.NormalizePci("00000000:01:00.0") == "0000:01:00.0", "NVML bus ids normalise to sysfs form");

            // GpuService: cached across launches, live sampling shared, failures isolated.
            var cache = new SystemInfoCache(Path.Combine(root, "cache"), NullLogger<SystemInfoCache>.Instance);
            var first = new FakeCollector();
            var svc1 = new GpuService(first, cache, NullLogger<GpuService>.Instance);
            Check((await svc1.GetHardwareAsync()).Available && first.HardwareReads == 1, "first launch reads hardware");
            await svc1.GetHardwareAsync();
            Check(first.HardwareReads == 1, "hardware is not re-read per request");

            var live1 = await svc1.GetLiveAsync();
            await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => svc1.GetLiveAsync()));
            Check(first.LiveReads == 1 && live1.Readings.Count == 1, "concurrent live requests share one sample");

            var second = new FakeCollector { Throw = true };
            var svc2 = new GpuService(second, cache, NullLogger<GpuService>.Instance);
            var warm = svc2.WarmUpAsync();
            await Task.Delay(0);
            await warm;
            var served = await svc2.GetHardwareAsync();
            Check(served.Available && served.Adapters.Count == 1, "a failing fresh read keeps serving the cached adapters");

            var broken = new GpuService(new FakeCollector { Throw = true }, new SystemInfoCache(Path.Combine(root, "cache2"), NullLogger<SystemInfoCache>.Instance), NullLogger<GpuService>.Instance);
            var none = await broken.GetHardwareAsync();
            Check(!none.Available && none.Adapters.Count == 0 && none.Note is not null, "GPU detection failure is reported as unavailable");
            Check((await broken.GetLiveAsync()).Readings.Count == 0, "live readings with no adapters are empty, not an error");

            File.WriteAllText(Path.Combine(root, "cache", "gpu-hardware.json"), "{ nope");
            var third = new FakeCollector();
            var svc3 = new GpuService(third, cache, NullLogger<GpuService>.Instance);
            await svc3.WarmUpAsync();
            Check((await svc3.GetHardwareAsync()).Available && third.HardwareReads == 1, "a corrupt GPU cache is rebuilt from a fresh read");
        }
        finally
        {
            try { Directory.Delete(root, true); } catch (IOException) { }
        }
        return (failures, checks);
    }
}
