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

        return (failures, checks);
    }
}
