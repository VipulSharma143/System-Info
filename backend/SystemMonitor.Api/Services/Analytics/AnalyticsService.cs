using System.Text.Json;
using System.Text.Json.Serialization;
using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Native;

namespace SystemMonitor.Api.Services;

// Trend, bottleneck and summary analysis over the local snapshot history.
// Responses are snake_case JSON, with a "no snapshots" short-circuit the frontend handles.
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
        // One dense array per series (NaN = no reading), so run and spike detection can scan them with the native engine.
        var cpu = new double[samples.Count];
        var net = new double[samples.Count];
        for (int i = 0; i < samples.Count; i++)
        {
            cpu[i] = samples[i].Cpu ?? double.NaN;
            var total = 0.0;
            foreach (var n in samples[i].Net) total += (n.Rx ?? 0) + (n.Tx ?? 0);
            net[i] = total;
        }

        var cpuRuns = SustainedRuns(cpu, o.CpuSustainedThreshold, o.CpuSustainedMinSamples);
        var netRuns = SustainedRuns(net, o.NetSustainedThresholdKbps, o.NetSustainedMinSamples);
        var inSustained = new byte[cpu.Length];
        foreach (var r in cpuRuns) Array.Fill(inSustained, (byte)1, r.Start, r.End - r.Start + 1);

        Episode MakeEpisode(double[] values, (int Start, int End) r, string? cls)
        {
            // Every value inside a run is at or above its threshold, so none is missing: the peak is simply the largest.
            return new Episode(
                Iso(ts[r.Start]), Iso(ts[r.End]),
                Math.Round((ts[r.End] - ts[r.Start]).TotalSeconds, 1),
                Math.Round(Peak(values.AsSpan(r.Start, r.End - r.Start + 1)), 1),
                r.End - r.Start + 1, cls);
        }
        var cpuEpisodes = cpuRuns.Select(r => MakeEpisode(cpu, r, Classify(r, net, o.NetSustainedThresholdKbps))).ToList();
        var netEpisodes = netRuns.Select(r => MakeEpisode(net, r, null)).ToList();
        var spikes = new List<Spike>();
        foreach (var i in SpikeIndexes(cpu, o.CpuSpikeThreshold, inSustained))
            spikes.Add(new Spike(Iso(ts[i]), Math.Round(cpu[i], 1)));

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
        var n = Math.Min(values.Count, timestamps.Count);

        // Long series go to the native engine: the valid points are gathered into pooled arrays and the engine does the sums.
        if (SeriesEngine.Accepts(n))
        {
            var xs = System.Buffers.ArrayPool<double>.Shared.Rent(n);
            var ys = System.Buffers.ArrayPool<double>.Shared.Rent(n);
            try
            {
                int k = 0;
                DateTime? origin = null;
                for (int i = 0; i < n; i++)
                {
                    if (values[i] is not { } v || double.IsNaN(v) || double.IsInfinity(v)) continue;
                    origin ??= timestamps[i];
                    xs[k] = (timestamps[i] - origin.Value).TotalSeconds;
                    ys[k] = v;
                    k++;
                }
                if (k < 2) return null;
                if (SeriesEngine.TrySlope(xs.AsSpan(0, k), ys.AsSpan(0, k), out var native)) return native;
            }
            finally
            {
                System.Buffers.ArrayPool<double>.Shared.Return(xs);
                System.Buffers.ArrayPool<double>.Shared.Return(ys);
            }
        }
        SeriesEngine.CountManaged();

        // Two passes over the valid points (mean first, then the sums of products) with no temporary lists; the arithmetic and its
        // order are the same as when the points were collected into lists, so the result is identical.
        DateTime? t0 = null;
        int count = 0;
        double sumX = 0, sumY = 0;
        for (int i = 0; i < n; i++)
        {
            if (values[i] is not { } v || double.IsNaN(v) || double.IsInfinity(v)) continue;
            t0 ??= timestamps[i];
            sumX += (timestamps[i] - t0.Value).TotalSeconds;
            sumY += v;
            count++;
        }
        if (count < 2) return null;
        double mx = sumX / count, my = sumY / count, num = 0, den = 0;
        for (int i = 0; i < n; i++)
        {
            if (values[i] is not { } v || double.IsNaN(v) || double.IsInfinity(v)) continue;
            var x = (timestamps[i] - t0!.Value).TotalSeconds;
            num += (x - mx) * (v - my);
            den += (x - mx) * (x - mx);
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

    /// <summary>Runs of &gt;= minSamples consecutive values &gt;= threshold, as inclusive index ranges. A missing value ends a run.</summary>
    public static List<(int Start, int End)> FindSustained(IReadOnlyList<double?> values, double threshold, int minSamples)
    {
        var dense = new double[values.Count];
        for (int i = 0; i < dense.Length; i++) dense[i] = values[i] ?? double.NaN;
        return SustainedRuns(dense, threshold, minSamples);
    }

    // Native engine for long series, the plain version for short ones or when the engine is not there. Same answers.
    private static List<(int Start, int End)> SustainedRuns(double[] values, double threshold, int minSamples)
    {
        if (SeriesEngine.TryFindRuns(values, threshold, minSamples, out var runs)) return runs;
        SeriesEngine.CountManaged();
        return SeriesEngine.Reference.FindRuns(values, threshold, minSamples);
    }

    private static List<int> SpikeIndexes(double[] values, double threshold, byte[] skip)
    {
        if (SeriesEngine.TryCollectGe(values, threshold, skip, out var indexes)) return indexes;
        SeriesEngine.CountManaged();
        return SeriesEngine.Reference.CollectGe(values, threshold, skip);
    }

    private static double Peak(ReadOnlySpan<double> values)
    {
        if (SeriesEngine.TryStats(values, out var s)) return s.Max;
        SeriesEngine.CountManaged();
        var max = values[0];
        foreach (var v in values) if (v > max) max = v;
        return max;
    }

    private static string Classify((int Start, int End) run, double[] net, double netThreshold)
    {
        var chunk = net.AsSpan(run.Start, run.End - run.Start + 1);
        int above;
        if (!SeriesEngine.TryCountGe(chunk, netThreshold, out above))
        {
            SeriesEngine.CountManaged();
            above = SeriesEngine.Reference.CountGe(chunk, netThreshold);
        }
        var fraction = above / (double)chunk.Length;
        return fraction >= 0.5 ? "combined_load" : "cpu_bound";
    }

    private static StatSummary? Summarize(IEnumerable<double?> values)
    {
        var v = values.Where(x => x.HasValue && !double.IsNaN(x.Value)).Select(x => x!.Value).ToList();
        if (v.Count == 0) return null;
        if (SeriesEngine.TryStats(System.Runtime.InteropServices.CollectionsMarshal.AsSpan(v), out var s))
            return new StatSummary(Math.Round(s.Sum / v.Count, 2), Math.Round(s.Min, 2), Math.Round(s.Max, 2), v.Count);
        SeriesEngine.CountManaged();
        return new StatSummary(Math.Round(v.Average(), 2), Math.Round(v.Min(), 2), Math.Round(v.Max(), 2), v.Count);
    }

    // ISO-8601 with a "+00:00" suffix (the shape the UI has always received) so existing
    // consumers (Date parsing, nearest-timestamp lookup) see identical strings.
    private static string Iso(DateTime utc) => utc.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.ffffffzzz", System.Globalization.CultureInfo.InvariantCulture);

    // ------------------------------------------------------------------
    // Loading
    // ------------------------------------------------------------------

    private async Task<List<Sample>> LoadAsync(double? minutes, CancellationToken ct)
    {
        var now = _utcNow();
        DateTime? since = minutes is > 0 ? now.AddMinutes(-minutes.Value) : null;
        var from = since ?? DateTime.MinValue;

        // The native reader takes the raw day files and returns the samples directly. It hands the whole range back (null)
        // whenever anything is not handled exactly, and then the managed reader below does what it always did.
        if (_store is IRawSnapshotFiles raw && SeriesEngine.IsAvailable && !SeriesEngine.ForceManaged)
        {
            var fast = await Task.Run(() => TryLoadNative(raw, from, now, ct), ct);
            if (fast is not null) return fast;
        }

        var rows = await _store.QueryAsync(from, now, ct);

        // Parsing thousands of lines is CPU work; keep it off the request thread.
        return await Task.Run(() =>
        {
            var list = new List<Sample>(rows.Count);
            var names = new NameTable();
            foreach (var row in rows)
            {
                ct.ThrowIfCancellationRequested();
                var sample = ParseRow(row, names);
                if (sample is not null) list.Add(sample);
            }
            list.Sort((a, b) => a.Ts.CompareTo(b.Ts));
            return list;
        }, ct);
    }

    /// <summary>The parsed history as plain tuples, for tests that compare the native and managed readers.</summary>
    internal async Task<List<(DateTime Ts, double? Cpu, List<(string Iface, double? Rx, double? Tx)> Net)>> LoadForTestAsync(double? minutes, CancellationToken ct = default)
        => (await LoadAsync(minutes, ct)).Select(s => (s.Ts, s.Cpu, s.Net)).ToList();

    // The whole history range through the native reader. Returns null (use the managed reader) when the engine declines any
    // file, or when the timestamps are not strictly increasing: the managed path sorts with its own rules, so only an
    // already ordered history, which is what the recorder writes, is taken here.
    private static List<Sample>? TryLoadNative(IRawSnapshotFiles raw, DateTime from, DateTime to, CancellationToken ct)
    {
        var list = new List<Sample>();
        var shared = new Dictionary<string, string>(StringComparer.Ordinal);
        long malformed = 0, previous = long.MinValue;

        foreach (var file in raw.ReadFilesInRange(from, to, ct))
        {
            ct.ThrowIfCancellationRequested();
            if (!SeriesEngine.TryParseSnapshots(file, from.Ticks, to.Ticks, out var p)) return null;
            malformed += p.Malformed;

            var names = new string[p.Names.Length];
            for (int i = 0; i < names.Length; i++)
                names[i] = shared.TryGetValue(p.Names[i], out var s) ? s : shared[p.Names[i]] = p.Names[i];

            for (int r = 0; r < p.Rows; r++)
            {
                if (p.Ticks[r] <= previous) return null;
                previous = p.Ticks[r];
                var sample = new Sample { Ts = new DateTime(p.Ticks[r], DateTimeKind.Utc), Cpu = double.IsNaN(p.Cpu[r]) ? null : p.Cpu[r] };
                for (int k = p.NetStart[r]; k < p.NetStart[r + 1]; k++)
                    sample.Net.Add((names[p.NetIface[k]], double.IsNaN(p.Rx[k]) ? null : p.Rx[k], double.IsNaN(p.Tx[k]) ? null : p.Tx[k]));
                list.Add(sample);
            }
        }

        if (malformed > 0)
            Console.Error.WriteLine($"[LocalJsonSnapshotStore] skipped {malformed} malformed line(s) while reading the history");
        return list;
    }

    // Interface names repeat in every row; one string per distinct name is shared instead of one per row.
    private sealed class NameTable
    {
        private readonly List<(byte[] Utf8, string Text)> _names = new();

        public string Read(ref Utf8JsonReader reader)
        {
            foreach (var (utf8, text) in _names)
                if (reader.ValueTextEquals(utf8)) return text;
            var name = reader.GetString()!;
            _names.Add((System.Text.Encoding.UTF8.GetBytes(name), name));
            return name;
        }
    }

    private static Sample? ParseRow(SystemSnapshot row, NameTable names)
    {
        var json = row.Json;
        var max = System.Text.Encoding.UTF8.GetMaxByteCount(json.Length);
        byte[]? rented = null;
        Span<byte> buffer = max <= 1024 ? stackalloc byte[1024] : (rented = System.Buffers.ArrayPool<byte>.Shared.Rent(max));
        try
        {
            var length = System.Text.Encoding.UTF8.GetBytes(json, buffer);
            var reader = new Utf8JsonReader(buffer[..length]);
            if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject) return null;

            var s = new Sample { Ts = DateTime.SpecifyKind(row.TimestampUtc, DateTimeKind.Utc) };
            while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
            {
                if (reader.ValueTextEquals("cpuUsedPercent"u8))
                {
                    reader.Read();
                    if (reader.TokenType == JsonTokenType.Number && reader.TryGetDouble(out var cpu) && double.IsFinite(cpu)) s.Cpu = cpu;
                    else reader.Skip();
                }
                else if (reader.ValueTextEquals("network"u8))
                {
                    reader.Read();
                    if (reader.TokenType == JsonTokenType.StartArray) ReadNetwork(ref reader, s, names);
                    else reader.Skip();
                }
                else
                {
                    reader.Read();
                    reader.Skip();
                }
            }
            return s;
        }
        // JsonException: not valid JSON. InvalidOperationException: text that cannot be decoded (an interface name with a lone
        // surrogate in an escape). Either way the line is unreadable and is left out, not allowed to fail the whole request.
        catch (Exception ex) when (ex is JsonException or InvalidOperationException) { return null; }
        finally
        {
            if (rented is not null) System.Buffers.ArrayPool<byte>.Shared.Return(rented);
        }
    }

    // Reader is on the StartArray of "network"; returns with it on the matching EndArray.
    private static void ReadNetwork(ref Utf8JsonReader reader, Sample s, NameTable names)
    {
        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
        {
            if (reader.TokenType != JsonTokenType.StartObject) { reader.Skip(); continue; }
            string iface = "unknown";
            double? rx = null, tx = null;
            while (reader.Read() && reader.TokenType == JsonTokenType.PropertyName)
            {
                if (reader.ValueTextEquals("iface"u8))
                {
                    reader.Read();
                    if (reader.TokenType == JsonTokenType.String) iface = names.Read(ref reader);
                    else { iface = "unknown"; reader.Skip(); }
                }
                else if (reader.ValueTextEquals("rxKBps"u8)) { reader.Read(); rx = NumberOrNull(ref reader); }
                else if (reader.ValueTextEquals("txKBps"u8)) { reader.Read(); tx = NumberOrNull(ref reader); }
                else { reader.Read(); reader.Skip(); }
            }
            s.Net.Add((iface, rx, tx));
        }
    }

    private static double? NumberOrNull(ref Utf8JsonReader reader)
    {
        // A number the double type cannot hold counts as missing, like a value that is not a number.
        if (reader.TokenType == JsonTokenType.Number) return reader.TryGetDouble(out var d) && double.IsFinite(d) ? d : null;
        reader.Skip();
        return null;
    }
}
