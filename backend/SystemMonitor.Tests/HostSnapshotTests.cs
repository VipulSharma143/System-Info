using SystemMonitor.Api.Native;
using SystemMonitor.Api.Services;

// The shared snapshot service: caching rules, failure behaviour, and (when the native library is present) properties
// that hold on any machine. No test asserts a specific CPU, RAM size or temperature.
static class HostSnapshotTests
{
    static HostSnapshot Sample(long at, ulong busy = 10, ulong total = 100) =>
        new(true, busy, total, true, 8_000_000, 5_000_000, 1_000_000, false, 0, 0, false, 0, at);

    public static (int Failures, int Checks) Run()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }

        // Concurrent callers inside the accepted age share one native read.
        long clock = 1_000;
        int calls = 0;
        var service = new HostSnapshotService(() => { calls++; return Sample(calls); }, () => clock);
        var first = service.Read(TimeSpan.FromMilliseconds(400));
        var second = service.Read(TimeSpan.FromMilliseconds(400));
        Check(calls == 1 && ReferenceEquals(first, second), "a reading inside the accepted age is shared, not re-read");
        Parallel.For(0, 64, _ => service.Read(TimeSpan.FromMilliseconds(400)));
        Check(calls == 1, "64 concurrent callers cause no extra native reads");

        clock += 399;
        service.Read(TimeSpan.FromMilliseconds(400));
        Check(calls == 1, "just inside the age limit is still shared");
        clock += 2;
        var third = service.Read(TimeSpan.FromMilliseconds(400));
        Check(calls == 2 && !ReferenceEquals(first, third), "past the age limit a new read is taken");

        service.Read(TimeSpan.Zero);
        service.Read(TimeSpan.Zero);
        Check(calls == 4, "maxAge zero always reads fresh (CPU deltas need real samples)");
        Check(service.NativeReads == 4, "the read counter matches");

        // A failed read is null and never serves the previous value as if it were current.
        var failNext = false;
        var flaky = new HostSnapshotService(() => failNext ? null : Sample(1), () => clock);
        Check(flaky.Read(TimeSpan.FromSeconds(1)) is not null, "first read succeeds");
        failNext = true;
        clock += 2_000;
        Check(flaky.Read(TimeSpan.FromSeconds(1)) is null, "a failing read returns null");
        Check(flaky.Read(TimeSpan.FromSeconds(1)) is null, "and the old value is not resurrected inside the age window");
        failNext = false;
        Check(flaky.Read(TimeSpan.FromSeconds(1)) is not null, "it recovers on the next successful read");

        // Field mapping honours the validity mask.
        var raw = new SiHostSnapshot { ValidMask = HostSnapshot.MemoryBit | HostSnapshot.CpuTempBit, MemTotalKb = 100, MemAvailableKb = 40, CpuTemperatureC = 61.5, SampledUnixMs = 123 };
        var mapped = HostSnapshot.FromNative(raw);
        Check(mapped.HasMemory && !mapped.HasCpuTicks && !mapped.HasSwap && mapped.HasCpuTemperature && mapped.CpuTemperatureC == 61.5 && mapped.SampledUnixMs == 123, "validity bits map to Has* flags");

        // Native sanity: only properties that hold on every healthy system.
        if (NativeTests.LoadedLibrary is null)
        {
            Console.WriteLine("SKIPPED native host snapshot checks: native library not found.");
        }
        else
        {
            var live = NativeHost.Read();
            Check(live is not null, "the native snapshot is readable on this machine");
            if (live is not null)
            {
                Check(live.SampledUnixMs > 1_700_000_000_000, "the snapshot carries a real timestamp");
                if (live.HasMemory) Check(live.MemTotalKb > 0 && live.MemAvailableKb <= live.MemTotalKb, "native memory figures are consistent");
                if (live.HasCpuTicks) Check(live.CpuBusyTicks <= live.CpuTotalTicks, "native busy ticks never exceed total");
                if (live.HasCpuTemperature) Check(CpuTemperatureSelection.Plausible(live.CpuTemperatureC), "a native temperature is plausible");
            }
        }
        if (NativeTests.LoadedLibrary is not null && OperatingSystem.IsLinux())
        {
            // Informational only (never asserted: speed is hardware dependent): the old managed RAM read vs the native snapshot.
            const int n = 5000;
            for (var i = 0; i < 200; i++) { NativeHost.Read(); ManagedRam(); }
            var sw = System.Diagnostics.Stopwatch.StartNew();
            long alloc0 = GC.GetAllocatedBytesForCurrentThread();
            for (var i = 0; i < n; i++) ManagedRam();
            var managedMs = sw.Elapsed.TotalMilliseconds; var managedAlloc = GC.GetAllocatedBytesForCurrentThread() - alloc0;
            sw.Restart(); alloc0 = GC.GetAllocatedBytesForCurrentThread();
            for (var i = 0; i < n; i++) NativeHost.Read();
            var nativeMs = sw.Elapsed.TotalMilliseconds; var nativeAlloc = GC.GetAllocatedBytesForCurrentThread() - alloc0;
            Console.WriteLine($"info: RAM read x{n}: managed {managedMs / n * 1000:F1} us, {managedAlloc / n} B/call; native snapshot (RAM + CPU ticks + temperature) {nativeMs / n * 1000:F1} us, {nativeAlloc / n} B/call");
        }
        return (failures, checks);
    }

    // The pre-2.4.8 implementation, kept here only as the benchmark baseline.
    static long ManagedRam()
    {
        var lines = File.ReadAllLines("/proc/meminfo");
        long Get(string key)
        {
            var line = lines.FirstOrDefault(l => l.StartsWith(key));
            if (line == null) return 0;
            return long.Parse(line.Split(':', StringSplitOptions.TrimEntries)[1].Replace("kB", "").Trim());
        }
        return Get("MemTotal") - Get("MemAvailable");
    }
}
