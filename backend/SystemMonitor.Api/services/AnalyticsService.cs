using System.Text.Json;
using System.Text.Json.Serialization;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

// In-process replacement for the former Python/FastAPI analytics service.
// Same maths, same thresholds, same JSON shape (snake_case, and the same
// "no snapshots" short-circuit the frontend already handles) — so
// /api/analytics/* is a drop-in and nothing outside this file changed for the UI.
//
// Data comes from ISnapshotStore, which already reads only the daily .jsonl
// files covering the requested range and skips malformed lines.

public sealed record StatSummary(
    [property: JsonPropertyName("mean")] double Mean,
    [property: JsonPropertyName("min")] double Min,
    [property: JsonPropertyName("max")] double Max,
    [property: JsonPropertyName("n")] int N);

public sealed record NetworkStat(
    [property: JsonPropertyName("rx_kbps")] StatSummary? RxKbps,
    [property: JsonPropertyName("tx_kbps")] StatSummary? TxKbps);

public sealed record StatsResult(
    [property: JsonPropertyName("count")] int Count,
    [property: JsonPropertyName("from"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? From,
    [property: JsonPropertyName("to"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? To,
    [property: JsonPropertyName("message"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Message,
    [property: JsonPropertyName("cpu_percent"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] StatSummary? CpuPercent,
    [property: JsonPropertyName("network"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Dictionary<string, NetworkStat>? Network);

public sealed record DirectionalTrend(
    [property: JsonPropertyName("direction")] string Direction,
    [property: JsonPropertyName("per_minute")] double? PerMinute);

public sealed record TrendResult(
    [property: JsonPropertyName("count")] int Count,
    [property: JsonPropertyName("from"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? From,
    [property: JsonPropertyName("to"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? To,
    [property: JsonPropertyName("message"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Message,
    [property: JsonPropertyName("cpu_trend"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DirectionalTrend? CpuTrend,
    [property: JsonPropertyName("network_trend_rx"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Dictionary<string, DirectionalTrend>? NetworkTrendRx);

public sealed record Episode(
    [property: JsonPropertyName("start")] string Start,
    [property: JsonPropertyName("end")] string End,
    [property: JsonPropertyName("duration_sec")] double DurationSec,
    [property: JsonPropertyName("peak")] double? Peak,
    [property: JsonPropertyName("samples")] int Samples,
    [property: JsonPropertyName("classification"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Classification);

public sealed record Spike(
    [property: JsonPropertyName("timestamp")] string Timestamp,
    [property: JsonPropertyName("value")] double Value);

public sealed record BottleneckSummary(
    [property: JsonPropertyName("sustained_cpu_episode_count")] int SustainedCpuEpisodeCount,
    [property: JsonPropertyName("sustained_network_episode_count")] int SustainedNetworkEpisodeCount,
    [property: JsonPropertyName("isolated_cpu_spike_count")] int IsolatedCpuSpikeCount);

public sealed record BottlenecksResult(
    [property: JsonPropertyName("count")] int Count,
    [property: JsonPropertyName("from"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? From,
    [property: JsonPropertyName("to"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? To,
    [property: JsonPropertyName("message"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Message,
    [property: JsonPropertyName("sustained_cpu_episodes"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] List<Episode>? SustainedCpuEpisodes,
    [property: JsonPropertyName("sustained_network_episodes"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] List<Episode>? SustainedNetworkEpisodes,
    [property: JsonPropertyName("isolated_cpu_spikes"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] List<Spike>? IsolatedCpuSpikes,
    [property: JsonPropertyName("summary"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] BottleneckSummary? Summary);

public sealed record BottleneckOptions(
    double CpuSustainedThreshold = 85.0,
    int CpuSustainedMinSamples = 5,
    double CpuSpikeThreshold = 95.0,
    double NetSustainedThresholdKbps = 500.0,
    int NetSustainedMinSamples = 5,
    int SkipFirst = 10);

public sealed class AnalyticsService
{
    private readonly ISnapshotStore _store;
    private readonly Func<DateTime> _utcNow;

    public AnalyticsService(ISnapshotStore store) : this(store, () => DateTime.UtcNow) { }

    // Clock is injectable so tests are deterministic.
    public AnalyticsService(ISnapshotStore store, Func<DateTime> utcNow)
    {
        _store = store;
        _utcNow = utcNow;
    }

    // ---- one parsed sample: only the fields the maths needs ----
    private sealed class Sample
    {
        public DateTime Ts;
        public double? Cpu;
        public List<(string Iface, double? Rx, double? Tx)> Net = new();
    }

    public async Task<StatsResult> GetStatsAsync(double? minutes, CancellationToken ct = default)
    {
        var samples = await LoadAsync(minutes, ct);
        if (samples.Count == 0) return new StatsResult(0, null, null, EmptyMessage, null, null);

        var cpu = samples.Where(s => s.Cpu.HasValue).Select(s => s.Cpu!.Value);
        var rx = new Dictionary<string, List<double?>>();
        var tx = new Dictionary<string, List<double?>>();
        foreach (var s in samples)
            foreach (var (iface, r, t) in s.Net)
            {
                if (!rx.TryGetValue(iface, out var rl)) { rx[iface] = rl = new(); tx[iface] = new(); }
                rl.Add(r);
                tx[iface].Add(t);
            }

        return new StatsResult(
            samples.Count, Iso(samples[0].Ts), Iso(samples[^1].Ts), null,
            Summarize(cpu.Select(v => (double?)v)),
            rx.ToDictionary(kv => kv.Key, kv => new NetworkStat(Summarize(kv.Value), Summarize(tx[kv.Key]))));
    }

    public async Task<TrendResult> GetTrendAsync(double? minutes, int window = 20, CancellationToken ct = default)
    {
        // `window` (rolling-mean size) is accepted for API compatibility; the
        // response has never included the rolling series, only the slope.
        _ = window;
        var samples = await LoadAsync(minutes, ct);
        if (samples.Count == 0) return new TrendResult(0, null, null, EmptyMessage, null, null);

        var ts = samples.Select(s => s.Ts).ToList();
        var cpuTrend = Describe(LinearSlopePerSecond(ts, samples.Select(s => s.Cpu).ToList()));

        var network = new SortedDictionary<string, DirectionalTrend>(StringComparer.Ordinal);
        foreach (var iface in samples.SelectMany(s => s.Net.Select(n => n.Iface)).Distinct().OrderBy(i => i, StringComparer.Ordinal))
        {
            var rx = samples.Select(s => { foreach (var n in s.Net) if (n.Iface == iface) return n.Rx; return (double?)null; }).ToList();
            network[iface] = Describe(LinearSlopePerSecond(ts, rx));
        }

        return new TrendResult(samples.Count, Iso(ts[0]), Iso(ts[^1]), null, cpuTrend, new Dictionary<string, DirectionalTrend>(network));
    }

    public async Task<BottlenecksResult> GetBottlenecksAsync(double? minutes, BottleneckOptions? options = null, CancellationToken ct = default)
    {
        var o = options ?? new BottleneckOptions();
        var all = await LoadAsync(minutes, ct);
        if (all.Count <= o.SkipFirst)
            return new BottlenecksResult(all.Count, null, null, $"not enough data after skipping first {o.SkipFirst} samples", null, null, null, null);

        var samples = all.Skip(o.SkipFirst).ToList();
        var ts = samples.Select(s => s.Ts).ToList();
        var cpu = samples.Select(s => s.Cpu).ToList();
        var net = samples.Select(s => (double?)s.Net.Sum(n => (n.Rx ?? 0) + (n.Tx ?? 0))).ToList();

        var cpuRuns = FindSustained(cpu, o.CpuSustainedThreshold, o.CpuSustainedMinSamples);
        var netRuns = FindSustained(net, o.NetSustainedThresholdKbps, o.NetSustainedMinSamples);
        var inSustained = new HashSet<int>(cpuRuns.SelectMany(r => Enumerable.Range(r.Start, r.End - r.Start + 1)));

        Episode MakeEpisode(List<double?> values, (int Start, int End) r, string? cls)
        {
            var chunk = values.Skip(r.Start).Take(r.End - r.Start + 1).Where(v => v.HasValue).Select(v => v!.Value).ToList();
            return new Episode(
                Iso(ts[r.Start]), Iso(ts[r.End]),
                Math.Round((ts[r.End] - ts[r.Start]).TotalSeconds, 1),
                chunk.Count > 0 ? Math.Round(chunk.Max(), 1) : null,
                r.End - r.Start + 1, cls);
        }
        var cpuEpisodes = cpuRuns.Select(r => MakeEpisode(cpu, r, Classify(r, net, o.NetSustainedThresholdKbps))).ToList();
        var netEpisodes = netRuns.Select(r => MakeEpisode(net, r, null)).ToList();
        var spikes = new List<Spike>();
        for (int i = 0; i < cpu.Count; i++)
            if (cpu[i] is { } v && v >= o.CpuSpikeThreshold && !inSustained.Contains(i))
                spikes.Add(new Spike(Iso(ts[i]), Math.Round(v, 1)));

        return new BottlenecksResult(
            samples.Count, Iso(ts[0]), Iso(ts[^1]), null,
            cpuEpisodes, netEpisodes, spikes,
            new BottleneckSummary(cpuEpisodes.Count, netEpisodes.Count, spikes.Count));
    }

    // ------------------------------------------------------------------
    // Maths (pure and static: directly unit-tested)
    // ------------------------------------------------------------------

    private const string EmptyMessage = "no snapshots found in requested window";

    /// <summary>Least-squares slope of value vs. elapsed seconds; null if fewer than 2 valid points or zero time spread.</summary>
    public static double? LinearSlopePerSecond(IReadOnlyList<DateTime> timestamps, IReadOnlyList<double?> values)
    {
        var xs = new List<double>();
        var ys = new List<double>();
        DateTime? t0 = null;
        for (int i = 0; i < values.Count && i < timestamps.Count; i++)
        {
            if (values[i] is not { } v || double.IsNaN(v) || double.IsInfinity(v)) continue;
            t0 ??= timestamps[i];
            xs.Add((timestamps[i] - t0.Value).TotalSeconds);
            ys.Add(v);
        }
        if (xs.Count < 2) return null;
        double mx = xs.Average(), my = ys.Average(), num = 0, den = 0;
        for (int i = 0; i < xs.Count; i++)
        {
            num += (xs[i] - mx) * (ys[i] - my);
            den += (xs[i] - mx) * (xs[i] - mx);
        }
        return den == 0 ? null : num / den;
    }

    public static DirectionalTrend Describe(double? slopePerSecond)
    {
        if (slopePerSecond is not { } s) return new DirectionalTrend("unknown", null);
        var perMin = s * 60;
        var dir = perMin > 0.5 ? "climbing" : perMin < -0.5 ? "dropping" : "flat";
        return new DirectionalTrend(dir, Math.Round(perMin, 2));
    }

    /// <summary>Runs of &gt;= minSamples consecutive values &gt;= threshold, as inclusive index ranges.</summary>
    public static List<(int Start, int End)> FindSustained(IReadOnlyList<double?> values, double threshold, int minSamples)
    {
        var runs = new List<(int, int)>();
        int? start = null;
        for (int i = 0; i < values.Count; i++)
        {
            bool above = values[i] is { } v && v >= threshold;
            if (above && start is null) start = i;
            else if (!above && start is not null)
            {
                if (i - start.Value >= minSamples) runs.Add((start.Value, i - 1));
                start = null;
            }
        }
        if (start is not null && values.Count - start.Value >= minSamples) runs.Add((start.Value, values.Count - 1));
        return runs;
    }

    private static string Classify((int Start, int End) run, IReadOnlyList<double?> net, double netThreshold)
    {
        var chunk = net.Skip(run.Start).Take(run.End - run.Start + 1).Where(v => v.HasValue).Select(v => v!.Value).ToList();
        var fraction = chunk.Count == 0 ? 0 : chunk.Count(v => v >= netThreshold) / (double)chunk.Count;
        return fraction >= 0.5 ? "combined_load" : "cpu_bound";
    }

    private static StatSummary? Summarize(IEnumerable<double?> values)
    {
        var v = values.Where(x => x.HasValue && !double.IsNaN(x.Value)).Select(x => x!.Value).ToList();
        return v.Count == 0 ? null : new StatSummary(Math.Round(v.Average(), 2), Math.Round(v.Min(), 2), Math.Round(v.Max(), 2), v.Count);
    }

    // Same text shape as Python's isoformat() ("+00:00" suffix) so existing
    // consumers (Date parsing, nearest-timestamp lookup) see identical strings.
    private static string Iso(DateTime utc) => utc.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.ffffffzzz", System.Globalization.CultureInfo.InvariantCulture);

    // ------------------------------------------------------------------
    // Loading
    // ------------------------------------------------------------------

    private async Task<List<Sample>> LoadAsync(double? minutes, CancellationToken ct)
    {
        var now = _utcNow();
        DateTime? since = minutes is > 0 ? now.AddMinutes(-minutes.Value) : null;
        var rows = await _store.QueryAsync(since ?? DateTime.MinValue, now, ct);

        // Parsing thousands of lines is CPU work; keep it off the request thread.
        return await Task.Run(() =>
        {
            var list = new List<Sample>(rows.Count);
            foreach (var row in rows)
            {
                ct.ThrowIfCancellationRequested();
                var sample = ParseRow(row);
                if (sample is not null) list.Add(sample);
            }
            list.Sort((a, b) => a.Ts.CompareTo(b.Ts));
            return list;
        }, ct);
    }

    private static Sample? ParseRow(SystemSnapshot row)
    {
        try
        {
            using var doc = JsonDocument.Parse(row.Json);
            var root = doc.RootElement;
            var s = new Sample { Ts = DateTime.SpecifyKind(row.TimestampUtc, DateTimeKind.Utc) };
            if (root.TryGetProperty("cpuUsedPercent", out var cpu) && cpu.ValueKind == JsonValueKind.Number) s.Cpu = cpu.GetDouble();
            if (root.TryGetProperty("network", out var net) && net.ValueKind == JsonValueKind.Array)
                foreach (var e in net.EnumerateArray())
                {
                    if (e.ValueKind != JsonValueKind.Object) continue;
                    var iface = e.TryGetProperty("iface", out var i) && i.ValueKind == JsonValueKind.String ? i.GetString()! : "unknown";
                    s.Net.Add((iface, Num(e, "rxKBps"), Num(e, "txKBps")));
                }
            return s;
        }
        catch (JsonException) { return null; }
    }

    private static double? Num(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;
}
