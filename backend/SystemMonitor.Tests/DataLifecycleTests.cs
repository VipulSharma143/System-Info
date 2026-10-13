using System.Text.Json;
using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Services;

// The 7-day limit on saved history and the "reset data" action. Uses a throwaway folder per scenario.
static class DataLifecycleTests
{
    static readonly DateTime Now = new(2026, 10, 11, 12, 0, 0, DateTimeKind.Utc);

    static string Line(DateTime utc, double cpu = 12.5, bool net = true, bool battery = true)
    {
        var parts = new List<string> { $"\"timestamp\":\"{utc:o}\"", $"\"cpuUsedPercent\":{cpu}" };
        if (net) parts.Add("\"network\":[{\"iface\":\"eth0\",\"rxKBps\":1.5,\"txKBps\":0.5}]");
        if (battery) parts.Add("\"battery\":{\"status\":\"Discharging\",\"capacityPercent\":80,\"healthPercent\":90,\"powerWatts\":7}");
        return "{" + string.Join(",", parts) + "}";
    }

    static string DayFile(string dataDir, DateTime d) =>
        Path.Combine(dataDir, "snapshots", d.Year.ToString("D4"), d.Month.ToString("D2"), d.Day.ToString("D2") + ".jsonl");

    static void Put(string dataDir, DateTime day, params string[] lines)
    {
        var f = DayFile(dataDir, day);
        Directory.CreateDirectory(Path.GetDirectoryName(f)!);
        File.WriteAllLines(f, lines);
    }

    public static (int Failures, int Checks) Run()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }
        string Tmp() => Path.Combine(Path.GetTempPath(), "sysinfo-data-" + Guid.NewGuid().ToString("N"));

        // ---- the regular history is never deleted automatically: it keeps growing until the person resets it
        var dir = Tmp();
        try
        {
            var ancient = new DateTime(2026, 1, 5);
            Put(dir, ancient, Line(ancient.AddHours(1)));
            Put(dir, ancient.AddDays(30), Line(ancient.AddDays(30).AddHours(1)));
            var store = new LocalJsonSnapshotStore(dir);
            store.AppendAsync(new SystemSnapshot(Now, Line(Now))).GetAwaiter().GetResult(); store.Flush();
            Check(File.Exists(DayFile(dir, ancient)) && File.Exists(DayFile(dir, ancient.AddDays(30))) && File.Exists(DayFile(dir, Now)), "months-old history files are still there after new readings are written");
            Check(typeof(ISnapshotStore).GetMethods().All(m => !m.Name.Contains("Prune", StringComparison.OrdinalIgnoreCase)), "the store has no automatic deletion at all");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }

        // ---- selective reset: remove one kind of data from every saved line, keep the others
        dir = Tmp();
        try
        {
            var d1 = new DateTime(2026, 10, 10); var d2 = Now.Date;
            Put(dir, d1, Line(d1.AddHours(1)), Line(d1.AddHours(2), net: false), "not json at all");
            Put(dir, d2, Line(d2.AddHours(1)));
            var store = new LocalJsonSnapshotStore(dir);
            var changed = store.ResetData(new HashSet<string> { "cpuUsedPercent" }, all: false);
            var text = File.ReadAllText(DayFile(dir, d1));
            Check(changed == 3 && !text.Contains("cpuUsedPercent") && text.Contains("\"network\"") && text.Contains("\"battery\""), "CPU reset removes cpuUsedPercent everywhere and keeps network and battery");
            Check(text.Contains("not json at all"), "a line the app cannot parse is kept exactly as it was");

            store.ResetData(new HashSet<string> { "battery" }, all: false);
            Check(!File.ReadAllText(DayFile(dir, d1)).Contains("battery") && File.ReadAllText(DayFile(dir, d1)).Contains("\"network\""), "battery reset removes only the battery data");

            store.ResetData(new HashSet<string> { "network" }, all: false);
            Check(!File.Exists(DayFile(dir, d2)), "when every kind of data is gone a line (only a timestamp) is dropped and an empty day file is deleted");
            Check(File.Exists(DayFile(dir, d1)) && File.ReadAllText(DayFile(dir, d1)).Contains("not json at all"), "a day file that still holds a line is kept");

            // the analytics reader copes with lines that lack a field
            var rows = store.QueryAsync(d1, Now).GetAwaiter().GetResult();
            Check(rows.Count <= 1, "the store can still be queried after fields were removed");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }

        // ---- full reset empties the store AND the memory buffer
        dir = Tmp();
        try
        {
            Put(dir, Now.Date.AddDays(-1), Line(Now.AddDays(-1)));
            var store = new LocalJsonSnapshotStore(dir);
            store.AppendAsync(new SystemSnapshot(Now, Line(Now))).GetAwaiter().GetResult();      // not flushed yet
            store.ResetData(new HashSet<string>(), all: true);
            store.Flush();
            Check(!Directory.EnumerateFiles(Path.Combine(dir, "snapshots"), "*.jsonl", SearchOption.AllDirectories).Any(), "reset all: no day file survives, and the unflushed buffer is not written afterwards");
            store.AppendAsync(new SystemSnapshot(Now, Line(Now))).GetAwaiter().GetResult(); store.Flush();
            Check(File.Exists(DayFile(dir, Now)), "after a reset new readings are recorded normally");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }

        // ---- the reset service: validation
        Check(DataResetService.Validate(null) is not null, "no body is rejected");
        Check(DataResetService.Validate(new DataResetRequest(null, false)) is not null && DataResetService.Validate(new DataResetRequest([], false)) is not null, "nothing chosen is rejected");
        Check(DataResetService.Validate(new DataResetRequest(["cpu", "bogus"], false)) is { } why && why.Contains("bogus"), "an unknown data type is rejected by name");
        Check(DataResetService.Validate(new DataResetRequest(["CPU", "Battery"], false)) is null && DataResetService.Validate(new DataResetRequest(null, true)) is null, "valid choices (any letter case) and 'all' are accepted");

        // ---- the reset service: what each choice deletes and what it never touches
        dir = Tmp();
        try
        {
            Put(dir, Now.Date, Line(Now));
            var cache = Path.Combine(dir, "cache"); Directory.CreateDirectory(cache);
            foreach (var n in new[] { "gpu-hardware.json", "dashboard.json", "system-info.json", ".version" }) File.WriteAllText(Path.Combine(cache, n), "{}");
            File.WriteAllText(Path.Combine(dir, "sensor-driver-install.txt"), "installed");
            var store = new LocalJsonSnapshotStore(dir);
            var battery = new BatteryHistoryService(dir, null, () => Now);
            battery.Observe(Now, new BatteryInfo(true, "Discharging", 80, null, null, null, null, null, null, null, null, null, null, null));
            battery.Observe(Now.AddMinutes(10), new BatteryInfo(true, "Charging", 60, null, null, null, null, null, null, null, null, null, null, null));
            battery.Observe(Now.AddMinutes(11), new BatteryInfo(true, "Charging", 60, null, null, null, null, null, null, null, null, null, null, null));
            var svc = new DataResetService(store, battery, dir);

            var r = svc.Reset(new DataResetRequest(["gpu"], false));
            Check(r.Ok && !File.Exists(Path.Combine(cache, "gpu-hardware.json")) && File.Exists(Path.Combine(cache, "dashboard.json")) && File.ReadAllText(DayFile(dir, Now)).Contains("cpuUsedPercent"), "GPU reset deletes only the cached GPU details");

            r = svc.Reset(new DataResetRequest(["cache"], false));
            Check(r.Ok && !File.Exists(Path.Combine(cache, "dashboard.json")) && !File.Exists(Path.Combine(cache, "system-info.json")), "cache reset deletes the other cached pages");

            r = svc.Reset(new DataResetRequest(["battery"], false));
            Check(r.Ok && battery.Read().Sessions.Count == 0 && !File.ReadAllText(DayFile(dir, Now)).Contains("battery") && File.ReadAllText(DayFile(dir, Now)).Contains("cpuUsedPercent"), "battery reset clears the sessions and the saved battery readings, not the CPU history");

            r = svc.Reset(new DataResetRequest(null, true));
            Check(r.Ok && !Directory.EnumerateFiles(Path.Combine(dir, "snapshots"), "*", SearchOption.AllDirectories).Any() && !Directory.EnumerateFiles(cache).Any(), "reset all clears history and every cache file");
            Check(File.Exists(Path.Combine(dir, "sensor-driver-install.txt")), "the sensor-driver install marker is never deleted");

            r = svc.Reset(new DataResetRequest(["nonsense"], false));
            Check(!r.Ok && r.Cleared.Count == 0, "an invalid request deletes nothing");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }

        // ---- how much space the saved data uses
        dir = Tmp();
        try
        {
            void Bytes(string rel, int n) { var f = Path.Combine(dir, rel); Directory.CreateDirectory(Path.GetDirectoryName(f)!); File.WriteAllBytes(f, new byte[n]); }
            Bytes("snapshots/2026/10/10.jsonl", 1000); Bytes("snapshots/2026/10/11.jsonl", 2500); Bytes("snapshots/2026/09/30.jsonl", 500);
            Bytes("snapshots/2026/10/stray.jsonl", 40);          // does not follow the day layout: counted in bytes, not as a day
            Bytes("battery/sessions.json", 300);
            Bytes("cache/gpu-hardware.json", 100); Bytes("cache/dashboard.json", 200);
            Bytes("sensor-driver-install.txt", 7);
            var usage = new DataUsageService(dir).Read();
            Check(usage.Parts.Single(p => p.Id == "history").Bytes == 4040 && usage.Parts.Single(p => p.Id == "history").Files == 4, "history bytes and files are counted");
            Check(usage.Parts.Single(p => p.Id == "battery").Bytes == 300 && usage.Parts.Single(p => p.Id == "cache").Bytes == 300 && usage.Parts.Single(p => p.Id == "cache").Files == 2, "battery history and cache are counted separately");
            Check(usage.Parts.Single(p => p.Id == "other").Bytes == 7, "a file outside the known folders is shown as other, never lost from the total");
            Check(usage.TotalBytes == 4647 && usage.TotalFiles == 8 && usage.TotalBytes == usage.Parts.Sum(p => p.Bytes), "the total is exactly the sum of the parts");
            Check(usage.HistoryDays == 3 && usage.OldestDay == "2026-09-30" && usage.NewestDay == "2026-10-11", "days covered, oldest and newest come from the day files");
            Check(usage.Path == Path.GetFullPath(dir), "the folder the data lives in is reported");
            Check(new DataUsageService(dir).Read().TotalBytes == usage.TotalBytes, "reading twice gives the same answer (nothing is modified)");

            var svc = new DataResetService(new LocalJsonSnapshotStore(dir), new BatteryHistoryService(dir, null, () => Now), dir);
            svc.Reset(new DataResetRequest(null, true));
            var after = new DataUsageService(dir).Read();
            Check(after.Parts.Single(p => p.Id == "history").Bytes == 0 && after.HistoryDays == 0 && after.OldestDay is null && after.Parts.Single(p => p.Id == "other").Bytes == 7, "after reset everything is gone except the sensor-driver marker");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }

        var missing = new DataUsageService(Path.Combine(Path.GetTempPath(), "sysinfo-no-such-" + Guid.NewGuid().ToString("N"))).Read();
        Check(missing.TotalBytes == 0 && missing.TotalFiles == 0 && missing.HistoryDays == 0 && missing.Parts.Count == 3, "a data folder that does not exist yet reports zero, not an error");

        return (failures, checks);
    }
}
