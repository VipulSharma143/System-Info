using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Native;
using SystemMonitor.Api.Services;

// The series engine (Assembly kernels behind the C++ dispatcher) through its managed façade, and the analytics maths that
// uses it: the engine and the plain C# versions must agree, and the analytics results must not depend on which one ran.
static class SeriesEngineTests
{
    public static (int Failures, int Checks) Run()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }

        if (NativeTests.LoadedLibrary is null || !SeriesEngine.IsAvailable)
        {
            Console.WriteLine("SKIPPED series engine tests: native library not found.");
            return (failures, checks);
        }

        var rng = new Random(20261015);
        bool Near(double got, double want, double rel = 1e-9) => Math.Abs(got - want) <= rel * (1 + Math.Abs(want));

        // ---- engine vs plain C#, many lengths, misaligned slices, with and without missing values
        foreach (var n in new[] { 256, 257, 259, 300, 1000, 4099, 86400 })
        foreach (var offset in new[] { 0, 1, 3 })
        {
            var a = new double[n + 8];
            var c = new double[n + 8];
            for (var i = 0; i < a.Length; i++)
            {
                a[i] = rng.Next(-10000, 10001) / 100.0;
                c[i] = rng.Next(0, 6) == 0 ? double.NaN : rng.Next(0, 101);
            }
            var span = a.AsSpan(offset, n);
            var gaps = c.AsSpan(offset, n);

            Check(SeriesEngine.TryStats(span, out var st) && Near(st.Sum, SeriesEngine.Reference.Stats(span).Sum)
                  && st.Min == SeriesEngine.Reference.Stats(span).Min && st.Max == SeriesEngine.Reference.Stats(span).Max, $"stats n={n} off={offset}");

            foreach (var thr in new[] { 0.0, 50.0, 90.0, 101.0 })
            {
                Check(SeriesEngine.TryCountGe(gaps, thr, out var cnt) && cnt == SeriesEngine.Reference.CountGe(gaps, thr), $"count n={n} thr={thr}");
                foreach (var minLen in new[] { 1, 3, 30 })
                    Check(SeriesEngine.TryFindRuns(gaps, thr, minLen, out var runs) && runs.SequenceEqual(SeriesEngine.Reference.FindRuns(gaps, thr, minLen)), $"runs n={n} thr={thr} min={minLen}");
                var skip = new byte[n];
                for (var i = 0; i < n; i++) skip[i] = (byte)(rng.Next(0, 4) == 0 ? 1 : 0);
                Check(SeriesEngine.TryCollectGe(gaps, thr, skip, out var idx) && idx.SequenceEqual(SeriesEngine.Reference.CollectGe(gaps, thr, skip)), $"collect n={n} thr={thr}");
                Check(SeriesEngine.TryCollectGe(gaps, thr, ReadOnlySpan<byte>.Empty, out var all) && all.SequenceEqual(SeriesEngine.Reference.CollectGe(gaps, thr, ReadOnlySpan<byte>.Empty)), $"collect without skip n={n} thr={thr}");
            }
        }

        // ---- series shorter than the threshold are left to plain C#
        Check(!SeriesEngine.TryStats(new double[10], out _), "a short series is not sent to the engine");
        Check(!SeriesEngine.TryFindRuns(new double[SeriesEngine.MinNativeLength - 1], 1, 1, out _), "a series just under the threshold is not sent either");

        // ---- more runs than the first buffer holds
        {
            var many = new double[10000];
            for (var i = 0; i < many.Length; i++) many[i] = i % 4 == 0 ? 100 : 0;      // 2500 one-sample runs
            Check(SeriesEngine.TryFindRuns(many, 50, 1, out var runs) && runs.Count == 2500 && runs[0] == (0, 0) && runs[2499] == (9996, 9996), "thousands of runs are all returned");
            Check(SeriesEngine.TryCollectGe(many, 50, ReadOnlySpan<byte>.Empty, out var idx) && idx.Count == 2500 && idx[2499] == 9996, "thousands of indexes are all returned");
        }

        // ---- slope: engine vs the managed two-pass maths, and accuracy with large offsets
        {
            var t0 = new DateTime(2026, 10, 13, 0, 0, 0, DateTimeKind.Utc);
            var n = 86400;
            var times = Enumerable.Range(0, n).Select(i => t0.AddSeconds(i)).ToList();
            var values = new List<double?>(n);
            for (var i = 0; i < n; i++) values.Add(i % 17 == 0 ? null : 1e9 + 0.25 * i + rng.Next(-50, 51));
            SeriesEngine.ForceManaged = true;
            var managed = AnalyticsService.LinearSlopePerSecond(times, values);
            SeriesEngine.ForceManaged = false;
            var engine = AnalyticsService.LinearSlopePerSecond(times, values);
            Check(managed is { } m && engine is { } e && Near(e, m, 1e-8) && Math.Abs(e - 0.25) < 0.01, $"slope: engine {engine} vs managed {managed}");
            var flat = Enumerable.Repeat((double?)42.0, n).ToList();
            Check(AnalyticsService.LinearSlopePerSecond(times, flat) is { } z && Math.Abs(z) < 1e-12, "a flat series has no slope");
            var nulls = Enumerable.Repeat((double?)null, n).ToList();
            Check(AnalyticsService.LinearSlopePerSecond(times, nulls) is null, "a series of missing values has no slope");
        }

        // ---- sustained runs: the analytics function gives the same runs with and without the engine
        {
            var values = new List<double?>();
            for (var i = 0; i < 20000; i++) values.Add(i % 500 < 120 ? 95.0 : (i % 777 == 0 ? null : 20.0));
            SeriesEngine.ForceManaged = true;
            var managed = AnalyticsService.FindSustained(values, 90, 30);
            SeriesEngine.ForceManaged = false;
            var engine = AnalyticsService.FindSustained(values, 90, 30);
            Check(managed.Count > 10 && managed.SequenceEqual(engine), "sustained runs: engine and plain C# agree");
        }

        // ---- the whole analytics service over a long history: engine on vs off gives the same JSON
        var dir = Path.Combine(Path.GetTempPath(), "sysinfo-series-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new LocalJsonSnapshotStore(dir);
            var start = new DateTime(2026, 10, 13, 0, 0, 0, DateTimeKind.Utc);
            for (var i = 0; i < 6000; i++)
            {
                var ts = start.AddSeconds(i);
                var cpu = i % 900 < 200 ? 94 + (i % 5) : 10 + (i % 30);
                var net = i % 1500 < 250 ? 8000.0 : 120.5;
                var cpuText = i % 211 == 0 ? "\"n/a\"" : cpu.ToString();
                store.AppendAsync(new SystemSnapshot(ts, $"{{\"timestamp\":\"{ts:o}\",\"cpuUsedPercent\":{cpuText},\"network\":[{{\"iface\":\"eth0\",\"rxKBps\":{net:F1},\"txKBps\":{i % 40}}}]}}")).GetAwaiter().GetResult();
                if (i % 1000 == 999) store.Flush();
            }
            store.Flush();
            var svc = new AnalyticsService(store, () => start.AddSeconds(6001));
            string Json() => System.Text.Json.JsonSerializer.Serialize(new object[]
            {
                svc.GetStatsAsync(null).GetAwaiter().GetResult(),
                svc.GetTrendAsync(null).GetAwaiter().GetResult(),
                svc.GetBottlenecksAsync(null).GetAwaiter().GetResult(),
            });
            var before = SeriesEngine.Calls;
            SeriesEngine.ForceManaged = true;
            var plain = Json();
            SeriesEngine.ForceManaged = false;
            var withEngine = Json();
            var after = SeriesEngine.Calls;
            Check(plain == withEngine, "analytics JSON is identical with the engine on and off");
            Check(after.Native > before.Native, "the analytics maths really ran on the engine");
            Check(plain.Contains("cpu_bound") || plain.Contains("combined_load"), "the test history produced bottleneck episodes");
        }
        finally { SeriesEngine.ForceManaged = false; try { Directory.Delete(dir, true); } catch { } }

        return (failures, checks);
    }
}
