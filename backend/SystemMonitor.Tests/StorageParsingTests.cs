using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Services;

// The saved-line readers: the store reads each line's timestamp as a token stream and the analytics maths reads CPU and network the
// same way. They must accept exactly what the DOM-based readers accepted, and give the same numbers.
static class StorageParsingTests
{
    public static (int Failures, int Checks) Run()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }
        bool Throws<T>(Action a) where T : Exception { try { a(); return false; } catch (T) { return true; } catch { return false; } }

        // ---- the timestamp of one line
        var stamp = new DateTime(2026, 10, 13, 8, 30, 15, DateTimeKind.Utc);
        Check(LocalJsonSnapshotStore.ReadTimestamp("{\"timestamp\":\"2026-10-13T08:30:15.0000000Z\",\"cpuUsedPercent\":5}") == stamp, "a timestamp is read from the start of a line");
        Check(LocalJsonSnapshotStore.ReadTimestamp("{\"cpuUsedPercent\":5,\"network\":[{\"iface\":\"eth0\",\"timestamp\":\"1999-01-01T00:00:00Z\"}],\"timestamp\":\"2026-10-13T08:30:15Z\"}") == stamp, "only the top-level timestamp counts, wherever it sits in the line");
        Check(LocalJsonSnapshotStore.ReadTimestamp("{\"timestamp\":\"2026-10-13T08:30:15Z\",\"battery\":{\"status\":\"Charging\",\"x\":[1,2,{\"a\":null}]}}") == stamp, "nested objects and arrays are skipped");
        Check(Throws<System.Text.Json.JsonException>(() => LocalJsonSnapshotStore.ReadTimestamp("{\"timestamp\":\"2026-10-13T08:30:15Z\",\"cpuUsedP")), "a half-written line is rejected");
        Check(Throws<System.Text.Json.JsonException>(() => LocalJsonSnapshotStore.ReadTimestamp("{\"timestamp\":\"2026-10-13T08:30:15Z\"} garbage")), "text after the JSON is rejected");
        Check(Throws<System.Text.Json.JsonException>(() => LocalJsonSnapshotStore.ReadTimestamp("not json at all")), "plain text is rejected");
        Check(Throws<KeyNotFoundException>(() => LocalJsonSnapshotStore.ReadTimestamp("{\"cpuUsedPercent\":5}")), "a line without a timestamp is rejected");
        Check(Throws<InvalidOperationException>(() => LocalJsonSnapshotStore.ReadTimestamp("[1,2,3]")), "a line that is not an object is rejected");
        Check(Throws<InvalidOperationException>(() => LocalJsonSnapshotStore.ReadTimestamp("{\"timestamp\":12345}")), "a timestamp that is not a string is rejected");
        Check(Throws<FormatException>(() => LocalJsonSnapshotStore.ReadTimestamp("{\"timestamp\":\"yesterday-ish\"}")), "a timestamp that is not a date is rejected");
        var longLine = "{\"timestamp\":\"2026-10-13T08:30:15Z\",\"pad\":\"" + new string('x', 5000) + "\"}";
        Check(LocalJsonSnapshotStore.ReadTimestamp(longLine) == stamp, "a line longer than the small buffer is read too");
        Check(LocalJsonSnapshotStore.ReadTimestamp("{\"timestamp\":\"2026-10-13T08:30:15Z\",\"name\":\"caf\u00e9 \u4e2d\u6587\"}") == stamp, "non-ASCII text in a line is fine");

        // ---- the analytics reader over odd rows
        var dir = Path.Combine(Path.GetTempPath(), "sysinfo-parse-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new LocalJsonSnapshotStore(dir);
            var t0 = new DateTime(2026, 10, 13, 8, 0, 0, DateTimeKind.Utc);
            void Add(int sec, string json) => store.AppendAsync(new SystemSnapshot(t0.AddSeconds(sec), json)).GetAwaiter().GetResult();
            string Ts(int sec) => t0.AddSeconds(sec).ToString("o");
            Add(0, $"{{\"timestamp\":\"{Ts(0)}\",\"cpuUsedPercent\":10,\"network\":[{{\"iface\":\"eth0\",\"rxKBps\":100,\"txKBps\":10}}]}}");
            Add(1, $"{{\"timestamp\":\"{Ts(1)}\",\"cpuUsedPercent\":\"n/a\",\"network\":[{{\"iface\":7,\"rxKBps\":\"x\",\"txKBps\":20}},5,{{\"iface\":\"eth0\",\"rxKBps\":300}}],\"battery\":{{\"status\":\"Charging\"}}}}");
            Add(2, $"{{\"battery\":{{\"a\":[1,{{\"b\":2}}]}},\"network\":[],\"cpuUsedPercent\":30,\"timestamp\":\"{Ts(2)}\"}}");
            Add(3, $"{{\"timestamp\":\"{Ts(3)}\",\"network\":\"unexpected\"}}");
            store.Flush();
            var svc = new AnalyticsService(store, () => t0.AddMinutes(1));
            var stats = svc.GetStatsAsync(null).GetAwaiter().GetResult();
            Check(stats.Count == 4, "every readable row is counted");
            Check(stats.CpuPercent is { N: 2 } && stats.CpuPercent.Mean == 20 && stats.CpuPercent.Min == 10 && stats.CpuPercent.Max == 30, "CPU is taken from numbers only (a text value is skipped)");
            var net = stats.Network!;
            Check(net.ContainsKey("eth0") && net.ContainsKey("unknown") && net["eth0"].RxKbps is { N: 2, Mean: 200 }, "interfaces are matched by name; a non-text name is 'unknown'; non-numbers are skipped");
            Check(net["eth0"].TxKbps is { N: 1, Mean: 10 }, "a missing transmit rate is not counted as zero");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }

        // ---- the slope: the same numbers the list-based version gave
        var times = Enumerable.Range(0, 5).Select(i => new DateTime(2026, 1, 1, 0, 0, i, DateTimeKind.Utc)).ToList();
        var slope = AnalyticsService.LinearSlopePerSecond(times, new double?[] { 1, 3, null, 7, double.NaN });
        Check(slope is { } sl && Math.Abs(sl - 2.0) < 1e-12, "slope skips missing and NaN points and measures time from the first valid one");
        Check(AnalyticsService.LinearSlopePerSecond(times, new double?[] { 1, null, null, null, null }) is null, "fewer than two valid points has no slope");
        Check(AnalyticsService.LinearSlopePerSecond(new[] { times[0], times[0] }, new double?[] { 1, 2 }) is null, "no time spread has no slope");

        return (failures, checks);
    }
}
