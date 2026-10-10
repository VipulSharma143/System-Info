using System.Text.Json;
using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Services;

// Minimal assertion runner: prints each failure, exits 1 if any.
int failures = 0, checks = 0;
void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }
void Near(double? actual, double expected, double tol, string what) =>
    Check(actual is { } a && Math.Abs(a - expected) <= tol, $"{what} (expected {expected}, got {actual?.ToString() ?? "null"})");

var t0 = new DateTime(2026, 9, 14, 10, 0, 0, DateTimeKind.Utc);
DateTime At(int sec) => t0.AddSeconds(sec);

// ---------- pure maths ----------
{
    var ts = Enumerable.Range(0, 10).Select(i => At(i)).ToList();
    Near(AnalyticsService.LinearSlopePerSecond(ts, ts.Select((_, i) => (double?)(10 + 2 * i)).ToList()), 2.0, 1e-9, "slope of y=10+2x");
    Check(AnalyticsService.LinearSlopePerSecond(ts, ts.Select(_ => (double?)null).ToList()) is null, "all-null series has no slope");
    Check(AnalyticsService.LinearSlopePerSecond(new[] { At(0) }, new double?[] { 5 }) is null, "single point has no slope");
    Check(AnalyticsService.LinearSlopePerSecond(new[] { At(0), At(0) }, new double?[] { 1, 2 }) is null, "identical timestamps -> no slope (no divide by zero)");
    // nulls are skipped, not treated as zero
    Near(AnalyticsService.LinearSlopePerSecond(ts.Take(4).ToList(), new double?[] { 0, null, 2, 3 }), 1.0, 1e-9, "slope skips null samples");

    Check(AnalyticsService.Describe(0.1).Direction == "climbing" && AnalyticsService.Describe(0.1).PerMinute == 6.0, "0.1/s = climbing 6/min");
    Check(AnalyticsService.Describe(-0.1).Direction == "dropping", "negative = dropping");
    Check(AnalyticsService.Describe(0.001).Direction == "flat", "tiny = flat");
    Check(AnalyticsService.Describe(null).Direction == "unknown", "null = unknown");

    double?[] v = { 10, 90, 90, 90, 90, 90, 10, 90, 90, 90, 90, 90, 90 };
    var runs = AnalyticsService.FindSustained(v, 85, 5);
    Check(runs.Count == 2 && runs[0] == (1, 5) && runs[1] == (7, 12), "two sustained runs incl. one that ends at the last sample");
    Check(AnalyticsService.FindSustained(new double?[] { 90, 90, 90, 90 }, 85, 5).Count == 0, "run shorter than min is ignored");
    Check(AnalyticsService.FindSustained(new double?[] { 90, null, 90, 90, 90, 90, 90 }, 85, 5).Count == 1, "null breaks a run");
}

// ---------- end to end against real files written the way SnapshotLogger writes them ----------
var dir = Path.Combine(Path.GetTempPath(), "sysinfo-analytics-" + Guid.NewGuid().ToString("N"));
try
{
    var store = new LocalJsonSnapshotStore(dir);
    var now = t0.AddMinutes(10);
    var svc = new AnalyticsService(store, () => now);
    var json = new JsonSerializerOptions { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never };

    // empty history == a fresh install: must be the short-circuit shape, not an error
    var empty = await svc.GetTrendAsync(null);
    Check(empty.Count == 0 && empty.Message == "no snapshots found in requested window", "empty history short-circuits");
    var emptyJson = JsonSerializer.Serialize(empty);
    Check(!emptyJson.Contains("cpu_trend") && emptyJson.Contains("\"count\":0"), $"empty JSON omits cpu_trend: {emptyJson}");

    // 60 samples, 1/s. CPU climbs 0->59 (slope 60/min). eth0 rx flat 100, tx 50. lo absent for first 30 samples.
    // 7-digit fractional seconds + Z exactly as DateTime.ToString("o") emits (the 7-digit form older parsers choked on).
    for (int i = 0; i < 60; i++)
    {
        var lo = i >= 30 ? ",{\"iface\":\"lo\",\"rxKBps\":1.5,\"txKBps\":1.5}" : "";
        var line = $"{{\"timestamp\":\"{At(i):yyyy-MM-ddTHH:mm:ss.fffffff}Z\",\"cpuUsedPercent\":{i},\"network\":[{{\"iface\":\"eth0\",\"rxKBps\":100,\"txKBps\":50}}{lo}]}}";
        await store.AppendAsync(new SystemSnapshot(At(i), line));
    }
    // a torn line from a hard kill, plus a record with no timestamp: both must be skipped, not fatal
    var file = Path.Combine(dir, "snapshots", "2026", "09", "14.jsonl");
    File.AppendAllText(file, "{\"timestamp\":\"2026-09-14T10:00:5" + Environment.NewLine + "{\"cpuUsedPercent\":5}" + Environment.NewLine);

    var stats = await svc.GetStatsAsync(null);
    Check(stats.Count == 60, $"60 valid samples (bad lines skipped), got {stats.Count}");
    Near(stats.CpuPercent?.Mean, 29.5, 1e-9, "cpu mean");
    Near(stats.CpuPercent?.Max, 59, 1e-9, "cpu max");
    Check(stats.CpuPercent?.N == 60, "cpu n");
    Near(stats.Network?["eth0"].RxKbps?.Mean, 100, 1e-9, "eth0 rx mean");
    Check(stats.Network?["lo"].RxKbps?.N == 30, "lo only present in 30 samples");
    Check(stats.From is not null && stats.From.EndsWith("+00:00") && stats.From.StartsWith("2026-09-14T10:00:00"), $"iso from: {stats.From}");

    var trend = await svc.GetTrendAsync(null);
    Check(trend.CpuTrend?.Direction == "climbing", "cpu climbing");
    Near(trend.CpuTrend?.PerMinute, 60.0, 0.01, "cpu slope per minute");
    Check(trend.NetworkTrendRx?["eth0"].Direction == "flat", "eth0 flat");
    var tj = JsonSerializer.Serialize(trend);
    Check(tj.Contains("\"cpu_trend\"") && tj.Contains("\"per_minute\"") && tj.Contains("\"network_trend_rx\""), $"snake_case keys the UI reads: {tj}");

    // time window: only the last 0.5 minutes before `now` -> nothing (data is 9+ minutes old)
    Check((await svc.GetStatsAsync(0.5)).Count == 0, "window excludes old data");
    Check((await svc.GetStatsAsync(11)).Count == 60, "window includes recent data");

    // bottlenecks: samples 10..: cpu >= 85? only i=59 -> tiny. Build a dedicated day with a real episode.
    var svc2Dir = Path.Combine(Path.GetTempPath(), "sysinfo-analytics-b-" + Guid.NewGuid().ToString("N"));
    var store2 = new LocalJsonSnapshotStore(svc2Dir);
    var b0 = new DateTime(2026, 9, 15, 8, 0, 0, DateTimeKind.Utc);
    // 0..9 startup transient (skipped, even though CPU is 100), 10..19 idle, 20..29 CPU 95 + net 600 (combined),
    // 30..34 idle, 35..44 CPU 90 no net (cpu_bound), 47 isolated spike 99 (46 idle keeps it out of the run), 48..49 idle
    for (int i = 0; i < 50; i++)
    {
        double cpu = i < 10 ? 100 : i is >= 20 and <= 29 ? 95 : i is >= 35 and <= 44 ? 90 : i == 47 ? 99 : 10;
        double rx = i is >= 20 and <= 29 ? 600 : 1;
        var line = $"{{\"timestamp\":\"{b0.AddSeconds(i):yyyy-MM-ddTHH:mm:ss.fffffff}Z\",\"cpuUsedPercent\":{cpu},\"network\":[{{\"iface\":\"eth0\",\"rxKBps\":{rx},\"txKBps\":0}}]}}";
        await store2.AppendAsync(new SystemSnapshot(b0.AddSeconds(i), line));
    }
    var svc2 = new AnalyticsService(store2, () => b0.AddMinutes(5));
    var bn = await svc2.GetBottlenecksAsync(null);
    Check(bn.Count == 40, $"skip_first=10 leaves 40, got {bn.Count}");
    Check(bn.SustainedCpuEpisodes?.Count == 2, $"two sustained cpu episodes, got {bn.SustainedCpuEpisodes?.Count}");
    Check(bn.SustainedCpuEpisodes?[0].Classification == "combined_load", "first episode overlaps network -> combined_load");
    Check(bn.SustainedCpuEpisodes?[1].Classification == "cpu_bound", "second episode -> cpu_bound");
    Near(bn.SustainedCpuEpisodes?[0].Peak, 95, 1e-9, "episode peak");
    Near(bn.SustainedCpuEpisodes?[0].DurationSec, 9, 1e-9, "episode duration (10 samples = 9 s span)");
    Check(bn.SustainedNetworkEpisodes?.Count == 1, "one sustained network episode");
    Check(bn.IsolatedCpuSpikes?.Count == 1 && bn.IsolatedCpuSpikes[0].Value == 99, "isolated spike reported");
    Check(bn.Summary?.SustainedCpuEpisodeCount == 2 && bn.Summary.IsolatedCpuSpikeCount == 1, "summary counts");
    var bj = JsonSerializer.Serialize(bn);
    Check(bj.Contains("\"sustained_cpu_episodes\"") && bj.Contains("\"duration_sec\"") && !bj.Contains("\"classification\":null"), $"bottleneck JSON shape: {bj[..Math.Min(200, bj.Length)]}");
    var few = await svc2.GetBottlenecksAsync(null, new BottleneckOptions(SkipFirst: 500));
    Check(few.Message is not null && few.Message.StartsWith("not enough data"), "not enough data message");
    Directory.Delete(svc2Dir, true);

    // an "all time" query must be fast: it used to be able to walk ~740k calendar days
    var sw = System.Diagnostics.Stopwatch.StartNew();
    _ = await new LocalJsonSnapshotStore(dir).QueryAsync(DateTime.MinValue, now);
    Check(sw.ElapsedMilliseconds < 500, $"all-time store query took {sw.ElapsedMilliseconds} ms");

    // writes are buffered: nothing reaches disk until Flush(), but a query always sees them
    var bufDir = Path.Combine(Path.GetTempPath(), "sysinfo-buffer-" + Guid.NewGuid().ToString("N"));
    var buffered = new LocalJsonSnapshotStore(bufDir);
    var stamp = DateTime.UtcNow;
    await buffered.AppendAsync(new SystemSnapshot(stamp, $"{{\"timestamp\":\"{stamp:o}\",\"a\":1}}"));
    await buffered.AppendAsync(new SystemSnapshot(stamp.AddSeconds(1), $"{{\"timestamp\":\"{stamp.AddSeconds(1):o}\",\"a\":2}}"));
    var dayFile = Directory.GetFiles(bufDir, "*.jsonl", SearchOption.AllDirectories);
    Check(dayFile.Length == 0, "appended snapshots stay in memory until flushed");
    var seen = await buffered.QueryAsync(stamp.AddMinutes(-1), stamp.AddMinutes(1));
    Check(seen.Count == 2, $"query flushes pending writes first (saw {seen.Count})");
    dayFile = Directory.GetFiles(bufDir, "*.jsonl", SearchOption.AllDirectories);
    Check(dayFile.Length == 1 && File.ReadAllLines(dayFile[0]).Length == 2, "flush writes all pending lines in one file");
    buffered.Flush();
    Check(File.ReadAllLines(dayFile[0]).Length == 2, "flushing with nothing pending writes nothing");
    Directory.Delete(bufDir, true);

    // cancellation is honoured
    using var cts = new CancellationTokenSource(); cts.Cancel();
    bool cancelled = false;
    try { await svc.GetStatsAsync(null, cts.Token); } catch (OperationCanceledException) { cancelled = true; }
    Check(cancelled, "cancelled token aborts analytics");

    // throughput sanity on a realistic day: 86,400 rows
    var big = new LocalJsonSnapshotStore(Path.Combine(dir, "big"));
    var bigStart = new DateTime(2026, 9, 16, 0, 0, 0, DateTimeKind.Utc);
    var sb = new System.Text.StringBuilder();
    for (int i = 0; i < 86_400; i++)
        sb.Append($"{{\"timestamp\":\"{bigStart.AddSeconds(i):yyyy-MM-ddTHH:mm:ss.fffffff}Z\",\"cpuUsedPercent\":{i % 100},\"network\":[{{\"iface\":\"eth0\",\"rxKBps\":{i % 700},\"txKBps\":3}}]}}\n");
    Directory.CreateDirectory(Path.Combine(dir, "big", "snapshots", "2026", "09"));
    File.WriteAllText(Path.Combine(dir, "big", "snapshots", "2026", "09", "16.jsonl"), sb.ToString());
    var bigSvc = new AnalyticsService(big, () => bigStart.AddDays(1));
    sw.Restart();
    var bigTrend = await bigSvc.GetTrendAsync(null);
    sw.Stop();
    Check(bigTrend.Count == 86_400, $"86,400 rows read, got {bigTrend.Count}");
    Console.WriteLine($"info: full-day trend over 86,400 rows took {sw.ElapsedMilliseconds} ms");
}
finally { try { Directory.Delete(dir, true); } catch { } }

{
    var (nf, nc) = NativeTests.Run();
    failures += nf; checks += nc;
}

{
    var (nf, nc) = MemoryTests.Run();
    failures += nf; checks += nc;
}

{
    var (nf, nc) = await CacheTests.RunAsync();
    failures += nf; checks += nc;
}
{
    var (nf, nc) = await GpuTests.RunAsync();
    failures += nf; checks += nc;
}
{
    var (nf, nc) = await OverlayTests.RunAsync();
    failures += nf; checks += nc;
}
{
    var (nf, nc) = await CpuDetailTests.RunAsync();
    failures += nf; checks += nc;
}
{
    var (nf, nc) = HostSnapshotTests.Run();
    failures += nf; checks += nc;
}

Console.WriteLine(failures == 0 ? $"all {checks} checks passed" : $"{failures} of {checks} checks FAILED");
return failures == 0 ? 0 : 1;
