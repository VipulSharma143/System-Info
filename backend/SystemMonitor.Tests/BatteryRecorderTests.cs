using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Services;

// The whole path a battery reading takes in the running app: the real background sampler loop -> the provider's GetBattery ->
// SnapshotLogger -> the snapshot store and the battery history file. Timings are shortened and the history uses a fake clock, so
// this takes about a second. It exists because the sampler once never read the battery at all (a sentinel that overflowed), which
// no test of the tracker alone could notice.
static class BatteryRecorderTests
{
    sealed class FakeProvider(Func<int, BatteryInfo> battery) : ISystemInfoProvider
    {
        public int Reads;
        public Task<RamInfo> GetRamAsync() => throw new NotImplementedException();
        public Task<CpuInfo> GetCpuAsync() => Task.FromResult(new CpuInfo(12.0));
        public Task<List<ProcessInfo>> GetProcessesAsync() => Task.FromResult(new List<ProcessInfo>());
        public List<DiskInfo> GetDisks() => [];
        public Task<List<NetworkInfo>> GetNetworkAsync() => Task.FromResult(new List<NetworkInfo>());
        public List<GpuInfo> GetGpus() => [];
        public SystemIdentity GetSystemIdentity() => throw new NotImplementedException();
        public RamDetails GetRamDetails() => throw new NotImplementedException();
        public BatteryInfo GetBattery() { Reads++; return battery(Reads); }
    }

    static BatteryInfo B(string status, int pct) => new(true, status, pct, null, null, null, null, null, null, null, null, null, null, null);

    public static (int Failures, int Checks) Run()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }

        // ---- "is a battery read due?" (the line that was wrong)
        Check(SystemMonitorBackgroundService.BatteryReadDue(0, null, 10_000) && SystemMonitorBackgroundService.BatteryReadDue(5_000, null, 10_000), "the first battery read is due immediately, whatever the uptime");
        Check(!SystemMonitorBackgroundService.BatteryReadDue(12_000, 5_000, 10_000) && SystemMonitorBackgroundService.BatteryReadDue(15_000, 5_000, 10_000) && SystemMonitorBackgroundService.BatteryReadDue(99_000, 5_000, 10_000), "after that it is due every refresh interval");

        // ---- the real loop, a laptop that is unplugged, plugged in for a while, then unplugged again
        var dir = Path.Combine(Path.GetTempPath(), "sysinfo-recorder-" + Guid.NewGuid().ToString("N"));
        try
        {
            var calls = 0;
            var clock = () => new DateTime(2026, 10, 13, 8, 0, 0, DateTimeKind.Utc).AddSeconds(2.5 * calls++);   // every sample is 2.5 s later
            var store = new LocalJsonSnapshotStore(dir);
            var history = new BatteryHistoryService(dir, null, clock);
            SnapshotLogger.Initialize(store, history);
            var provider = new FakeProvider(n => n <= 4 ? B("Discharging", 80) : n <= 10 ? B("Charging", 80 + n - 4) : B("Discharging", 86));
            var loop = new SystemMonitorBackgroundService(provider, NullLogger<SystemMonitorBackgroundService>.Instance,
                sampleInterval: TimeSpan.FromMilliseconds(8), loggingWarmUpMs: 30, batteryRefreshMs: 32);

            loop.StartAsync(CancellationToken.None).GetAwaiter().GetResult();
            var deadline = DateTime.UtcNow.AddSeconds(15);
            while (DateTime.UtcNow < deadline && !(history.Read().Sessions is { Count: >= 3 } s3 && s3[1].Kind == "charge" && !s3[1].Open)) Thread.Sleep(20);
            loop.StopAsync(CancellationToken.None).GetAwaiter().GetResult();
            store.Flush();

            var h = history.Read();
            Check(provider.Reads > 0, "the sampler reads the battery");
            Check(h.HasBattery && h.Watching is { Understood: true } && h.Watching.Status is "Discharging" or "Charging", "the recorder reports the latest reading it received");
            Check(h.Sessions.Count >= 3 && h.Sessions[0].Kind == "discharge" && !h.Sessions[0].Open && h.Sessions[1].Kind == "charge" && !h.Sessions[1].Open && h.Sessions[^1].Kind == "discharge", "unplugged -> plugged in -> unplugged gives discharge, charge, discharge");
            Check(h.Sessions.Count >= 2 && h.Sessions[1].StartPercent >= 80 && h.Sessions[1].EndPercent > h.Sessions[1].StartPercent && h.Sessions[1].DurationSec >= 15, "the charge session shows the level rising and how long it took");
            Check(File.Exists(Path.Combine(dir, "battery", "sessions.json")), "the battery history file is written");
            var line = File.ReadAllLines(Directory.EnumerateFiles(Path.Combine(dir, "snapshots"), "*.jsonl", SearchOption.AllDirectories).First()).First();
            Check(line.Contains("\"battery\"") && line.Contains("capacityPercent"), "the regular history lines now carry the battery reading too");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }

        // ---- a battery read that throws must not stop the CPU / network history, and nothing is recorded or invented
        dir = Path.Combine(Path.GetTempPath(), "sysinfo-recorder-err-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new LocalJsonSnapshotStore(dir);
            var history = new BatteryHistoryService(dir);
            SnapshotLogger.Initialize(store, history);
            var provider = new FakeProvider(_ => throw new InvalidOperationException("battery driver error"));
            var loop = new SystemMonitorBackgroundService(provider, NullLogger<SystemMonitorBackgroundService>.Instance, TimeSpan.FromMilliseconds(8), 30, 32);
            loop.StartAsync(CancellationToken.None).GetAwaiter().GetResult();
            Thread.Sleep(600);
            loop.StopAsync(CancellationToken.None).GetAwaiter().GetResult();
            store.Flush();
            var files = Directory.Exists(Path.Combine(dir, "snapshots")) ? Directory.EnumerateFiles(Path.Combine(dir, "snapshots"), "*.jsonl", SearchOption.AllDirectories).ToList() : [];
            Check(provider.Reads > 0 && files.Count > 0 && File.ReadAllLines(files[0]).Length > 3, "CPU and network history keeps being recorded while the battery read fails");
            Check(history.Read().Sessions.Count == 0 && !history.Read().HasBattery && history.Read().Watching is null, "a failing battery read records no session and the recorder says it has seen no reading");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }

        // ---- what the recorder says about a status it cannot use
        var msgs = new List<string>();
        var svc = new BatteryHistoryService(Path.Combine(Path.GetTempPath(), "sysinfo-recorder-w-" + Guid.NewGuid().ToString("N")), null, () => new DateTime(2026, 10, 13, 8, 0, 0, DateTimeKind.Utc), msgs.Add);
        svc.Observe(B("Unknown", 50));
        var w = svc.Read();
        Check(w.Watching is { Understood: false, Status: "Unknown", Percent: 50 } && w.Sessions.Count == 0 && !w.HasBattery, "an 'Unknown' status is reported as not understood and records nothing");
        svc.Observe(B("Discharging", 49));
        Check(svc.Read().Watching is { Understood: true } && svc.Read().Sessions.Count == 1, "as soon as the status is usable it starts recording");
        Check(msgs.Any(m => m.Contains("first battery reading")) && msgs.Any(m => m.Contains("running on battery")), "the recorder logs its first reading and each change of power source");
        svc.Reset();
        Check(svc.Read().Watching is null, "reset also forgets the latest reading");

        // ---- one shared battery read: callers that accept an older reading do not touch the hardware
        {
            var counting = new FakeProvider(n => B("Discharging", 90 - n));
            var cache = new BatteryReadCache(counting);
            var first = cache.Get(60_000);
            var second = cache.Get(60_000);
            Check(counting.Reads == 1 && ReferenceEquals(first, second), "two callers inside the allowed age share one hardware read");
            Check(cache.Get(0).CapacityPercent == 88 && counting.Reads == 2, "a caller that wants a fresh reading gets one, and it becomes the shared copy");
            Check(cache.Get(60_000).CapacityPercent == 88 && counting.Reads == 2, "the fresh reading is what later callers share");
            var failing = new FakeProvider(n => n == 1 ? B("Charging", 50) : throw new InvalidOperationException("driver gone"));
            var failCache = new BatteryReadCache(failing);
            failCache.Get(60_000);
            var threw = false;
            try { failCache.Get(0); } catch (InvalidOperationException) { threw = true; }
            Check(threw && failCache.Get(60_000).CapacityPercent == 50, "a failed read throws to its caller and does not replace the last good reading");
        }

        // ---- the saved line: same fields, same order, same text as the JSON tree it replaced; the battery only when asked
        var lineDir = Path.Combine(Path.GetTempPath(), "sysinfo-line-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new LocalJsonSnapshotStore(lineDir);
            var history = new BatteryHistoryService(lineDir);
            SnapshotLogger.Initialize(store, history);
            var net = new List<NetworkInfo> { new("eth0", 1.5, 2.25), new("wlan \"0\" \u00e9", 0, 1234.5) };
            var bat = new BatteryInfo(true, "Charging", 80, null, null, null, null, null, 93.5, null, 12.25, null, null, null);
            SnapshotLogger.Append(new CpuInfo(12.5), net, bat);
            SnapshotLogger.Append(new CpuInfo(7), net, bat, writeBatteryField: false);
            SnapshotLogger.Append(null, null, null);
            store.Flush();
            var file = Directory.EnumerateFiles(Path.Combine(lineDir, "snapshots"), "*.jsonl", SearchOption.AllDirectories).Single();
            var lines = File.ReadAllLines(file);
            Check(lines.Length == 3, "every Append writes exactly one line");

            var stamp = JsonDocument.Parse(lines[0]).RootElement.GetProperty("timestamp").GetString()!;
            var expected = new JsonObject
            {
                ["timestamp"] = stamp,
                ["cpuUsedPercent"] = 12.5,
                ["network"] = new JsonArray(
                    new JsonObject { ["iface"] = "eth0", ["rxKBps"] = 1.5, ["txKBps"] = 2.25 },
                    new JsonObject { ["iface"] = "wlan \"0\" \u00e9", ["rxKBps"] = 0.0, ["txKBps"] = 1234.5 }),
                ["battery"] = new JsonObject { ["status"] = "Charging", ["capacityPercent"] = 80, ["healthPercent"] = 93.5, ["powerWatts"] = 12.25 },
            };
            Check(lines[0] == expected.ToJsonString(), "a line with a battery is byte-for-byte what the previous format produced");
            Check(!lines[1].Contains("\"battery\"") && lines[1].Contains("\"cpuUsedPercent\":7"), "a line that is not asked to carry the battery omits it");
            Check(lines[2].Contains("\"cpuUsedPercent\":0") && lines[2].Contains("\"network\":[]") && !lines[2].Contains("\"battery\""), "no CPU reading and no network give 0 and an empty list");
            var unavailable = new BatteryInfo(false, null, null, null, null, null, null, null, null, null, null, null, null, "No battery detected on this system");
            SnapshotLogger.Append(new CpuInfo(1), [], unavailable);
            store.Flush();
            Check(!File.ReadAllLines(file).Last().Contains("battery"), "a desktop without a battery never gets a battery field");
            Check(history.Read().Watching is { Percent: 80 }, "the history is still fed by a line that does not carry the battery field");
        }
        finally { try { Directory.Delete(lineDir, true); } catch { } }

        // ---- a battery reader that stops working: its last value must not be fed to the history as if it were new
        var staleDir = Path.Combine(Path.GetTempPath(), "sysinfo-stale-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new LocalJsonSnapshotStore(staleDir);
            var history = new BatteryHistoryService(staleDir);
            SnapshotLogger.Initialize(store, history);
            var provider = new FakeProvider(n => n == 1 ? B("Discharging", 70) : throw new InvalidOperationException("battery driver stopped answering"));
            var loop = new SystemMonitorBackgroundService(provider, NullLogger<SystemMonitorBackgroundService>.Instance, TimeSpan.FromMilliseconds(8), 30, 32);
            loop.StartAsync(CancellationToken.None).GetAwaiter().GetResult();
            Thread.Sleep(800);
            loop.StopAsync(CancellationToken.None).GetAwaiter().GetResult();
            var watching = history.Read().Watching;
            Check(provider.Reads > 2, "a failing battery is retried at every refresh");
            Check(watching is not null && (DateTime.UtcNow - watching.ReadingUtc).TotalMilliseconds > 300, "after the reader stops, the last reading stops being passed on as current");
        }
        finally { try { Directory.Delete(staleDir, true); } catch { } }

        return (failures, checks);
    }
}
