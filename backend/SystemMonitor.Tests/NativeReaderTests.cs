using System.Globalization;
using System.Text;
using SystemMonitor.Api.Native;
using SystemMonitor.Api.Services;

// The native saved-history reader against the managed one it replaces: the same files must give the same samples, bit for
// bit, and anything the native reader does not handle exactly must fall back to the managed result.
static class NativeReaderTests
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public static (int Failures, int Checks) Run()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }

        if (NativeTests.LoadedLibrary is null || !SeriesEngine.IsAvailable)
        {
            Console.WriteLine("SKIPPED native reader tests: native library not found.");
            return (failures, checks);
        }

        var rng = new Random(20261016);
        var day1 = new DateTime(2026, 10, 12, 0, 0, 0, DateTimeKind.Utc);
        var now = new DateTime(2026, 10, 13, 18, 0, 0, DateTimeKind.Utc);

        string Num()
        {
            return rng.Next(0, 8) switch
            {
                0 => rng.Next(0, 101).ToString(Inv),
                1 => (rng.NextDouble() * 100).ToString("R", Inv),
                2 => (rng.NextDouble() * 1e6).ToString("E10", Inv),
                3 => (-rng.NextDouble() * 50).ToString("R", Inv),
                4 => "0",
                5 => (rng.NextDouble() * 1e-5).ToString("R", Inv),
                6 => rng.Next(0, 1000).ToString(Inv) + "." + rng.Next(0, 100000).ToString("D5", Inv),
                _ => "1234567890123456789012345.678901234567890123",
            };
        }
        string Name() => rng.Next(0, 9) switch
        {
            0 => "eth0", 1 => "wlan0", 2 => "lo", 3 => "docker0", 4 => "wlan \\\"0\\\" \\u00e9", 5 => "\u00e9th\u4e2d\u6587", 6 => "veth1234abcd", 7 => "\\ud83d\\ude00", _ => "br-0f3a",
        };
        string NetEntry()
        {
            var sb = new StringBuilder("{");
            var parts = new List<string>();
            if (rng.Next(0, 12) != 0) parts.Add($"\"iface\":\"{Name()}\"");
            if (rng.Next(0, 10) != 0) parts.Add($"\"rxKBps\":{Num()}");
            if (rng.Next(0, 10) != 0) parts.Add($"\"txKBps\":{Num()}");
            if (rng.Next(0, 15) == 0) parts.Add("\"extra\":{\"deep\":[1,2,{\"x\":null}]}");
            if (rng.Next(0, 25) == 0) parts[rng.Next(parts.Count == 0 ? 1 : parts.Count) % Math.Max(parts.Count, 1)] = "\"rxKBps\":\"text\"";
            return sb.Append(string.Join(rng.Next(0, 8) == 0 ? " , " : ",", parts)).Append('}').ToString();
        }
        string Line(DateTime ts, bool shortTime)
        {
            var stamp = shortTime ? ts.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", Inv) : ts.ToString("o", Inv);
            var members = new List<string> { $"\"timestamp\":\"{stamp}\"" };
            if (rng.Next(0, 12) != 0) members.Add($"\"cpuUsedPercent\":{Num()}");
            if (rng.Next(0, 15) == 0) members.Add("\"cpuUsedPercent\":\"n/a\"");
            if (rng.Next(0, 20) == 0) members.Add($"\"cpuUsedPercent\":{Num()}");
            var n = rng.Next(0, 4);
            var entries = Enumerable.Range(0, n).Select(_ => NetEntry());
            if (rng.Next(0, 14) != 0) members.Add($"\"network\":[{string.Join(",", entries)}]");
            if (rng.Next(0, 6) == 0) members.Add("\"battery\":{\"status\":\"Charging\",\"capacityPercent\":80,\"healthPercent\":-1,\"powerWatts\":12.5}");
            if (rng.Next(0, 30) == 0) members.Add("\"network\":[{\"iface\":\"dup\",\"rxKBps\":1}]");
            if (rng.Next(0, 30) == 0) members.Add("\"timestamp\":\"1999-01-01T00:00:00Z\"");
            if (rng.Next(0, 30) == 0) members.Insert(0, members.Last());
            var body = "{" + string.Join(rng.Next(0, 10) == 0 ? " ,\t" : ",", members) + "}";
            return rng.Next(0, 15) == 0 ? "  " + body + "  " : body;
        }
        string Malformed() => rng.Next(0, 9) switch
        {
            0 => "{\"timestamp\":\"2026-10-12T05:00:00Z\",\"cpuUsedP",
            1 => "{\"timestamp\":\"2026-10-12T05:00:00Z\",\"cpuUsedPercent\":1} trailing",
            2 => "not json at all",
            3 => "{\"cpuUsedPercent\":5}",
            4 => "{\"timestamp\":12345,\"cpuUsedPercent\":5}",
            5 => "{\"timestamp\":\"2026-10-12T05:00:00Z\",\"x\":[1,2,}",
            6 => "[1,2,3]",
            7 => "{\"timestamp\":\"2026-10-12T05:00:00Z\",\"cpuUsedPercent\":01}",
            _ => "",
        };

        // Writes day files for `from..` with the given line source, returns the store root.
        string BuildHistory(Func<DateTime, string> lineFor, int days, int rowsPerDay, string eol = "\n", Func<List<string>, List<string>>? mutate = null, bool crOnly = false)
        {
            var dir = Path.Combine(Path.GetTempPath(), "sysinfo-nreader-" + Guid.NewGuid().ToString("N"));
            for (var d = 0; d < days; d++)
            {
                var date = day1.AddDays(d);
                var lines = new List<string>();
                var ts = date.AddSeconds(rng.Next(0, 60));
                for (var i = 0; i < rowsPerDay; i++)
                {
                    ts = ts.AddSeconds(1).AddTicks(rng.Next(0, 9_999_999));
                    if (rng.Next(0, 25) == 0) lines.Add(Malformed());
                    lines.Add(lineFor(ts));
                }
                if (mutate is not null) lines = mutate(lines);
                var folder = Path.Combine(dir, "snapshots", date.ToString("yyyy"), date.ToString("MM"));
                Directory.CreateDirectory(folder);
                File.WriteAllText(Path.Combine(folder, date.ToString("dd") + ".jsonl"), string.Join(crOnly ? "\r" : eol, lines) + (crOnly ? "\r" : eol), new UTF8Encoding(false));
            }
            return dir;
        }

        // Compares the two readers over the same directory: the same samples, bit for bit, and (optionally) that the native one ran.
        void Compare(string dir, string label, bool? expectNative, double? minutes = null, bool allowEmpty = false)
        {
            try
            {
                var store = new LocalJsonSnapshotStore(dir);
                var svc = new AnalyticsService(store, () => now);
                SeriesEngine.ForceManaged = true;
                var managed = svc.LoadForTestAsync(minutes).GetAwaiter().GetResult();
                SeriesEngine.ForceManaged = false;
                var nativeBefore = SeriesEngine.Calls.Native;
                var native = svc.LoadForTestAsync(minutes).GetAwaiter().GetResult();
                var usedNative = SeriesEngine.Calls.Native > nativeBefore;

                var same = managed.Count == native.Count;
                for (var i = 0; same && i < managed.Count; i++)
                {
                    var a = managed[i]; var b = native[i];
                    same = a.Ts.Ticks == b.Ts.Ticks && Bits(a.Cpu) == Bits(b.Cpu) && a.Net.Count == b.Net.Count;
                    for (var k = 0; same && k < a.Net.Count; k++)
                        same = a.Net[k].Iface == b.Net[k].Iface && Bits(a.Net[k].Rx) == Bits(b.Net[k].Rx) && Bits(a.Net[k].Tx) == Bits(b.Net[k].Tx);
                    if (!same) Console.WriteLine($"  first difference at row {i}: {a.Ts:o} vs {b.Ts:o}");
                }
                Check(same, $"{label}: native and managed readers give identical samples ({managed.Count} vs {native.Count} rows)");
                Check(managed.Count > 0 || allowEmpty, $"{label}: the scenario produced rows");
                if (expectNative is { } want)
                    Check(usedNative == want, $"{label}: native reader {(want ? "was" : "was not")} used (used={usedNative})");
            }
            finally { SeriesEngine.ForceManaged = false; try { Directory.Delete(dir, true); } catch { } }
        }
        static long Bits(double? v) => v is null ? long.MinValue : BitConverter.DoubleToInt64Bits(v.Value);

        // ---- ordinary and awkward but supported files: the native reader must be used and agree exactly
        for (var round = 0; round < 6; round++)
            Compare(BuildHistory(ts => Line(ts, shortTime: rng.Next(0, 4) == 0), days: 2, rowsPerDay: 1500 + round * 700), $"mixed lines, round {round}", expectNative: true);
        Compare(BuildHistory(ts => Line(ts, false), 2, 800, eol: "\r\n"), "CRLF line endings", true);
        Compare(BuildHistory(ts => Line(ts, false), 1, 800, crOnly: true), "CR-only line endings", true);
        Compare(BuildHistory(ts => Line(ts, false), 3, 400, mutate: ls => { ls.Insert(3, ""); ls.Insert(10, "   "); ls.Add(""); return ls; }), "blank lines", true);
        Compare(BuildHistory(ts => Line(ts, false), 2, 900), "range filter inside the second day", true, minutes: 1073);
        Compare(BuildHistory(ts => Line(ts, false), 2, 900), "range filter inside the first day", true, minutes: 2515);

        // ---- a byte-order mark at the start of a file is skipped by both
        {
            var dir = BuildHistory(ts => Line(ts, false), 1, 600);
            var file = Directory.EnumerateFiles(dir, "*.jsonl", SearchOption.AllDirectories).Single();
            File.WriteAllBytes(file, new byte[] { 0xEF, 0xBB, 0xBF }.Concat(File.ReadAllBytes(file)).ToArray());
            Compare(dir, "UTF-8 byte-order mark", true);
        }

        // ---- things the native reader declines: the managed result must be returned unchanged
        Compare(BuildHistory(ts => Line(ts, false).Replace("Z\"", "+00:00\""), 2, 600), "timestamps with a UTC offset", false);
        Compare(BuildHistory(ts => Line(ts, false).Replace("T", "t").Replace("Z\"", "z\""), 1, 600), "lower-case timestamps", false, allowEmpty: true);
        Compare(BuildHistory(ts => Line(ts, false), 1, 600, mutate: ls => { ls.Reverse(); return ls; }), "timestamps in reverse order", null);
        Compare(BuildHistory(ts => Line(ts, false), 1, 600, mutate: ls => { ls.Insert(100, ls[100]); ls.Insert(300, ls[300]); return ls; }), "duplicate timestamps", null);
        Compare(BuildHistory(ts => Line(ts, false), 1, 600, mutate: ls => { ls.Insert(50, "{\"timestamp\":\"2026-10-12T05:00:00Z\",\"network\":[{\"iface\":\"bad\\ud800\"}]}"); return ls; }), "a name with a lone surrogate", false);
        Compare(BuildHistory(ts => Line(ts, false), 1, 600, mutate: ls => { ls.Insert(50, "{\"timestamp\":\"2026-10-12T05:00:00Z\",\"cpuUsedPercent\":1e999}"); return ls; }), "a number outside the double range", false);
        {
            var dir = BuildHistory(ts => Line(ts, false), 1, 600);
            var file = Directory.EnumerateFiles(dir, "*.jsonl", SearchOption.AllDirectories).Single();
            File.WriteAllText(file, File.ReadAllText(file), Encoding.Unicode);   // UTF-16 with a byte-order mark
            Compare(dir, "a UTF-16 file", false);
        }
        {
            var dir = BuildHistory(ts => Line(ts, false), 1, 600);
            var file = Directory.EnumerateFiles(dir, "*.jsonl", SearchOption.AllDirectories).Single();
            var bytes = File.ReadAllBytes(file).ToList();
            var bad = Encoding.ASCII.GetBytes("{\"timestamp\":\"2026-10-12T05:00:00Z\",\"x\":\"bad").Append((byte)0xFF).Concat(Encoding.ASCII.GetBytes("byte\"}\n")).ToList();   // a raw 0xFF is not valid UTF-8
            bytes.InsertRange(bytes.IndexOf((byte)'\n') + 1, bad);
            File.WriteAllBytes(file, bytes.ToArray());
            Compare(dir, "invalid UTF-8 inside a line", false);
        }

        // ---- no files at all, and empty files
        {
            var dir = Path.Combine(Path.GetTempPath(), "sysinfo-nreader-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            var svc = new AnalyticsService(new LocalJsonSnapshotStore(dir), () => now);
            Check(svc.LoadForTestAsync(null).GetAwaiter().GetResult().Count == 0, "no files: no samples");
            try { Directory.Delete(dir, true); } catch { }
        }

        // ---- a day file that is not an analytics file (other fields only) still reads
        Compare(BuildHistory(ts => $"{{\"timestamp\":\"{ts:o}\",\"battery\":{{\"status\":\"Discharging\",\"capacityPercent\":50}}}}", 1, 700), "lines with no cpu or network", true);

        return (failures, checks);
    }
}
