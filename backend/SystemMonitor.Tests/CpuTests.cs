using Microsoft.Extensions.Logging.Abstractions;
using SystemMonitor.Api.Services;

// A fake /proc and /sys tree stands in for the kernel, so counter deltas and sensor layouts are testable anywhere.
static class CpuTests
{
    sealed class FakeCollector : ICpuCollector
    {
        public int Reads;
        public bool Throw;
        public CpuDetail Read()
        {
            Reads++;
            if (Throw) throw new InvalidOperationException("counter exploded");
            return new CpuDetail(12, [], null, null, null, null, null, null, null, null, null, 1);
        }
    }

    static void Write(string path, string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
    }

    static void Stat(string proc, params string[] lines) => Write(Path.Combine(proc, "stat"), string.Join('\n', lines) + "\n");

    public static async Task<(int Failures, int Checks)> RunAsync()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }

        var root = Path.Combine(Path.GetTempPath(), "sysinfo-cpu-" + Guid.NewGuid().ToString("N"));
        try
        {
            var proc = Path.Combine(root, "proc");
            var sys = Path.Combine(root, "sys");
            long now = 10_000;
            var collector = new LinuxCpuCollector(proc, sys, () => now);

            var empty = collector.Read();
            Check(empty.Cores.Count == 0 && empty.TotalUsagePercent is null && empty.PackageTemperatureC is null, "an empty /proc and /sys is not an error");

            Stat(proc, "cpu  1000 0 1000 8000 0 0 0 0 0 0", "cpu0 500 0 500 4000 0 0 0 0 0 0", "cpu1 500 0 500 4000 0 0 0 0 0 0");
            Write(Path.Combine(proc, "loadavg"), "1.50 0.75 0.25 1/200 1234\n");
            Write(Path.Combine(proc, "cpuinfo"), "processor\t: 0\ncpu MHz\t\t: 3000.7\n\nprocessor\t: 1\ncpu MHz\t\t: 2400.0\n");
            var first = collector.Read();
            Check(first.TotalUsagePercent is null && first.Cores.All(c => c.UsagePercent is null), "the first read has no usage, only deltas do");
            Check(first.Cores.Count == 2 && first.Cores[0].ClockMhz == 3001 && first.Cores[1].ClockMhz == 2400, "clocks fall back to /proc/cpuinfo");
            Check(first.LoadAverage is { Count: 3 } la && la[0] == 1.5 && la[2] == 0.25, "load averages");

            // cpu0: 600 busy of 1000 new ticks; cpu1: fully idle. iowait counts as idle.
            Stat(proc, "cpu  1600 0 1000 8400 1000 0 0 0 0 0", "cpu0 1100 0 500 4400 0 0 0 0 0 0", "cpu1 500 0 500 4000 1000 0 0 0 0 0");
            var second = collector.Read();
            Check(second.Cores[0].UsagePercent == 60.0 && second.Cores[1].UsagePercent == 0.0, "per-core usage from /proc/stat deltas, iowait counted as idle");
            Check(second.TotalUsagePercent == 30.0, "total usage is its own line, not an average of rounded cores");

            Stat(proc, "cpu  1600 0 1000 8400 1000 0 0 0 0 0", "cpu0 1100 0 500 4400 0 0 0 0 0 0", "cpu1 500 0 500 4000 1000 0 0 0 0 0");
            Check(collector.Read().Cores[0].UsagePercent is null, "no elapsed ticks means no usage, not a division by zero");

            var cpu0 = Path.Combine(sys, "devices", "system", "cpu", "cpu0");
            var cpu1 = Path.Combine(sys, "devices", "system", "cpu", "cpu1");
            Write(Path.Combine(cpu0, "cpufreq", "scaling_cur_freq"), "4200000\n");
            Write(Path.Combine(cpu0, "cpufreq", "cpuinfo_max_freq"), "4800000\n");
            Write(Path.Combine(cpu0, "cpufreq", "base_frequency"), "2400000\n");
            Write(Path.Combine(cpu1, "cpufreq", "scaling_cur_freq"), "1200000\n");
            Write(Path.Combine(cpu0, "topology", "core_id"), "0\n");
            Write(Path.Combine(cpu1, "topology", "core_id"), "1\n");
            var hw = Path.Combine(sys, "class", "hwmon", "hwmon2");
            Write(Path.Combine(hw, "name"), "coretemp\n");
            Write(Path.Combine(hw, "temp1_input"), "67000\n"); Write(Path.Combine(hw, "temp1_label"), "Package id 0\n");
            Write(Path.Combine(hw, "temp2_input"), "62000\n"); Write(Path.Combine(hw, "temp2_label"), "Core 0\n");
            Write(Path.Combine(hw, "temp3_input"), "58000\n"); Write(Path.Combine(hw, "temp3_label"), "Core 1\n");
            var detail = collector.Read();
            Check(detail.Cores[0].ClockMhz == 4200 && detail.Cores[1].ClockMhz == 1200 && detail.AverageClockMhz == 2700 && detail.HighestClockMhz == 4200, "cpufreq clocks, average and highest");
            Check(detail.BaseClockMhz == 2400 && detail.MaxClockMhz == 4800, "base and maximum clock");
            Check(detail.PackageTemperatureC == 67 && detail.Cores[0].TemperatureC == 62 && detail.Cores[1].TemperatureC == 58 && detail.TemperatureSource == "coretemp", "coretemp package and per-core temperatures");

            Directory.Delete(Path.Combine(sys, "class", "hwmon"), true);
            var amd = Path.Combine(sys, "class", "hwmon", "hwmon0");
            Write(Path.Combine(amd, "name"), "k10temp\n");
            Write(Path.Combine(amd, "temp1_input"), "71000\n"); Write(Path.Combine(amd, "temp1_label"), "Tctl\n");
            Write(Path.Combine(amd, "temp2_input"), "65000\n"); Write(Path.Combine(amd, "temp2_label"), "Tdie\n");
            var amdDetail = collector.Read();
            Check(amdDetail.PackageTemperatureC == 65 && amdDetail.Cores[0].TemperatureC is null && amdDetail.TemperatureSource == "k10temp", "k10temp prefers Tdie and reports no per-core temperature");

            Directory.Delete(Path.Combine(sys, "class", "hwmon"), true);
            var zone = Path.Combine(sys, "class", "thermal", "thermal_zone3");
            Write(Path.Combine(zone, "type"), "x86_pkg_temp\n"); Write(Path.Combine(zone, "temp"), "55000\n");
            Write(Path.Combine(sys, "class", "thermal", "thermal_zone0", "type"), "acpitz\n"); Write(Path.Combine(sys, "class", "thermal", "thermal_zone0", "temp"), "27000\n");
            var zoneDetail = collector.Read();
            Check(zoneDetail.PackageTemperatureC == 55 && zoneDetail.TemperatureSource == "thermal-zone", "thermal zone fallback ignores the generic acpitz zone");

            var rapl = Path.Combine(sys, "class", "powercap", "intel-rapl:0");
            Write(Path.Combine(rapl, "energy_uj"), "100000000\n");
            now = 20_000; Check(collector.Read().PowerWatts is null, "the first RAPL read has no power");
            Write(Path.Combine(rapl, "energy_uj"), "130000000\n");
            now = 22_000; Check(collector.Read().PowerWatts == 15.0, "package watts from the RAPL energy delta (30 J over 2 s)");
            Write(Path.Combine(rapl, "max_energy_range_uj"), "200000000\n");
            Write(Path.Combine(rapl, "energy_uj"), "10000000\n");
            now = 23_000; Check(collector.Read().PowerWatts == 80.0, "a wrapped RAPL counter still gives power");

            var fake = new FakeCollector();
            var service = new CpuService(fake, NullLogger<CpuService>.Instance);
            await service.GetAsync();
            await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => service.GetAsync()));
            Check(fake.Reads == 1, "concurrent CPU requests share one sample");

            var broken = new CpuService(new FakeCollector { Throw = true }, NullLogger<CpuService>.Instance);
            var failed = await broken.GetAsync();
            Check(failed.TotalUsagePercent is null && failed.Cores.Count == 0 && failed.Note is not null, "a failing collector yields an empty reading with a note");
        }
        finally
        {
            try { Directory.Delete(root, true); } catch (IOException) { }
        }
        return (failures, checks);
    }
}
