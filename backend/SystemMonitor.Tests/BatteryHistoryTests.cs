using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Services;

// Battery sessions: the state machine (plug-in, unplug, flicker, gaps, full) and the file that keeps the last 7 days.
// Fixtures only; times are fixed so nothing depends on the machine running the test.
static class BatteryHistoryTests
{
    static readonly DateTime T0 = new(2026, 10, 11, 8, 0, 0, DateTimeKind.Utc);
    static BatteryInfo B(string? status, int? pct, bool available = true) =>
        new(available, status, pct, null, null, null, null, null, null, null, null, null, null, null);

    public static (int Failures, int Checks) Run()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }

        // ---- status text -> power source
        bool Cls(string? s, out bool ac, out bool full) => BatteryTracker.Classify(s, out ac, out full);
        Check(Cls("Discharging", out var ac, out var full) && !ac, "Discharging is battery power");
        Check(Cls("Charging", out ac, out full) && ac && !full, "Charging is charger power, not full");
        Check(Cls("Fully Charged", out ac, out full) && ac && full, "Fully Charged is charger power and full");
        Check(Cls("Full", out ac, out full) && ac && full, "Linux 'Full' is charger power and full");
        Check(Cls("Not Charging", out ac, out full) && ac && !full, "'Not Charging' (holding on the charger) is charger power");
        Check(!Cls("Unknown", out _, out _) && !Cls(null, out _, out _) && !Cls("  ", out _, out _), "Unknown / empty status says nothing, so it is ignored");

        // ---- first reading: a session that began before the app was watching
        var t = new BatteryTracker();
        t.Observe(T0, false, 80, false);
        var s0 = t.Sessions();
        Check(s0.Count == 1 && s0[0].Open && s0[0].Kind == "discharge" && !s0[0].StartExact && s0[0].StartPercent == 80, "first reading opens an inexact discharge session");

        // ---- unplugged for 10 minutes, then plugged in and charging: one discharge closed, one charge open
        t = new BatteryTracker();
        for (var i = 0; i <= 60; i++) t.Observe(T0.AddSeconds(i * 10), false, 80 - i / 3, false);            // 10 min, 80 -> 60
        var plugAt = T0.AddSeconds(610);
        for (var i = 0; i < 8; i++) t.Observe(plugAt.AddSeconds(i * 10), true, 60, false);                    // charger connected
        var ss = t.Sessions();
        Check(ss.Count == 2, "a confirmed plug-in closes the discharge session and opens a charge session");
        Check(ss[0].Kind == "discharge" && !ss[0].Open && ss[0].StartPercent == 80 && ss[0].EndPercent == 60 && ss[0].EndUtc == plugAt && ss[0].DurationSec == 610, "discharge: from 80% to 60% in 610 s, ended exactly when the charger was first seen");
        Check(ss[0].EndExact && !ss[0].StartExact, "its end is exact, its start is not (the app began mid-session)");
        Check(ss[1].Kind == "charge" && ss[1].Open && ss[1].StartUtc == plugAt && ss[1].StartExact && ss[1].StartPercent == 60, "charge session starts at the moment the plug was first seen");

        // ---- charge goes up, then unplug
        var c = plugAt.AddSeconds(70);
        for (var i = 0; i <= 120; i++) t.Observe(c.AddSeconds(i * 10), true, Math.Min(100, 60 + i / 3), i > 110);
        var unplugAt = c.AddSeconds(1210);
        for (var i = 0; i < 8; i++) t.Observe(unplugAt.AddSeconds(i * 10), false, 100, false);
        ss = t.Sessions();
        Check(ss.Count == 3 && ss[1].Kind == "charge" && !ss[1].Open && ss[1].EndPercent == 100 && ss[1].StartPercent == 60 && ss[1].ReachedFull, "charge session: 60% -> 100%, reached full");
        Check(ss[2].Kind == "discharge" && ss[2].Open && ss[2].StartPercent == 100, "unplugging opens a new discharge session at 100%");

        // ---- a charger that flickers for under the confirmation time does not split the session
        t = new BatteryTracker();
        for (var i = 0; i < 20; i++) t.Observe(T0.AddSeconds(i * 10), false, 70, false);
        for (var i = 0; i < 3; i++) t.Observe(T0.AddSeconds(200 + i * 10), true, 70, false);                 // 20 s on the charger
        for (var i = 0; i < 20; i++) t.Observe(T0.AddSeconds(230 + i * 10), false, 70, false);
        Check(t.Sessions().Count == 1 && t.Sessions()[0].Kind == "discharge", "a 20 s charger flicker is ignored");

        // ---- sampling stops (app closed or PC asleep) and the power source is the same afterwards: one session, gap recorded
        t = new BatteryTracker();
        t.Observe(T0, false, 90, false);
        t.Observe(T0.AddSeconds(10), false, 90, false);
        t.Observe(T0.AddHours(3), false, 40, false);
        ss = t.Sessions();
        Check(ss.Count == 1 && ss[0].EndPercent == 40 && ss[0].StartPercent == 90 && ss[0].GapSec > 10_000 && ss[0].DurationSec > 10_000, "same source after a gap: one session, the gap is counted and flagged");

        // ---- sampling stops and the source changed while the app was not watching: nothing is invented about when
        t = new BatteryTracker();
        t.Observe(T0, false, 90, false);
        t.Observe(T0.AddSeconds(10), false, 88, false);
        t.Observe(T0.AddHours(3), true, 30, false);
        ss = t.Sessions();
        Check(ss.Count == 2 && ss[0].Kind == "discharge" && !ss[0].EndExact && ss[0].EndUtc == T0.AddSeconds(10) && ss[0].EndPercent == 88, "source changed in a gap: the old session ends at its last reading, flagged inexact");
        Check(ss[1].Kind == "charge" && !ss[1].StartExact && ss[1].StartUtc == T0.AddHours(3) && ss[1].StartPercent == 30, "the new session starts at the first reading after the gap, flagged inexact");

        // ---- missing percentages do not erase known ones
        t = new BatteryTracker();
        t.Observe(T0, false, 55, false);
        t.Observe(T0.AddSeconds(10), false, null, false);
        Check(t.Sessions()[0].EndPercent == 55, "an unreadable percentage keeps the last known one");

        // ---- the 7-day limit on closed sessions
        t = new BatteryTracker();
        t.Restore(new BatteryTrackerState([
            new BatterySession("discharge", T0.AddDays(-9), T0.AddDays(-8), 90, 20, 3600, 0, true, true, false, false),
            new BatterySession("charge", T0.AddDays(-3), T0.AddDays(-2), 20, 100, 3600, 0, true, true, true, false)], null, null, null));
        Check(t.Prune(DataRetention.FirstKeptDay(T0)) == 1 && t.Sessions().Count == 1 && t.Sessions()[0].Kind == "charge", "a session that ended 8 days ago is dropped, one from 2 days ago is kept");

        // ---- save / restore keeps an open session across a restart
        t = new BatteryTracker();
        t.Observe(T0, false, 77, false);
        var saved = t.Save();
        var t2 = new BatteryTracker(); t2.Restore(saved);
        t2.Observe(T0.AddSeconds(30), false, 76, false);
        Check(t2.Sessions().Count == 1 && t2.Sessions()[0].StartUtc == T0 && t2.Sessions()[0].EndPercent == 76, "a restored tracker continues the same session");

        // ================= the service and its file =================
        var dir = Path.Combine(Path.GetTempPath(), "sysinfo-battery-" + Guid.NewGuid().ToString("N"));
        try
        {
            var now = T0;
            var svc = new BatteryHistoryService(dir, null, () => now);
            svc.Observe(now, B("Discharging", 80));
            svc.Observe(now.AddSeconds(5), null);
            svc.Observe(now.AddSeconds(5), B("Unknown", 70));
            svc.Observe(now.AddSeconds(5), B("Charging", 70, available: false));
            var h = svc.Read();
            Check(h.HasBattery && h.Sessions.Count == 1 && h.RetentionDays == 7, "service: only a real battery with a known status counts");

            now = T0.AddMinutes(30);
            for (var i = 0; i < 8; i++) svc.Observe(now.AddSeconds(i * 10), B("Charging", 55));
            var file = Path.Combine(dir, "battery", "sessions.json");
            Check(File.Exists(file), "a finished session is written to data/battery/sessions.json");
            Check(File.ReadAllText(file).Contains("\"kind\": \"discharge\""), "the file is readable JSON with the session in it");

            var restarted = new BatteryHistoryService(dir, null, () => now.AddMinutes(1));
            Check(restarted.Read().Sessions.Count == 2 && restarted.Read().HasBattery, "after a restart the sessions are loaded back");

            var later = new BatteryHistoryService(dir, null, () => T0.AddDays(8));
            Check(later.Read().Sessions.All(s => s.Open), "eight days later the closed sessions are gone, only the one still in progress remains");

            File.WriteAllText(file, "{ this is not json");
            var damaged = new BatteryHistoryService(dir, null, () => now);
            Check(damaged.Read().Sessions.Count == 0 && !damaged.Read().HasBattery, "a damaged file is ignored, never crashes");

            svc.Reset();
            Check(!File.Exists(file) && svc.Read().Sessions.Count == 0 && !svc.Read().HasBattery, "reset deletes the file and forgets every session");

            var desktop = new BatteryHistoryService(Path.Combine(dir, "desktop"), null, () => now);
            desktop.Observe(now, B(null, null, available: false));
            Check(!desktop.Read().HasBattery && desktop.Read().Sessions.Count == 0 && !File.Exists(Path.Combine(dir, "desktop", "battery", "sessions.json")), "a desktop without a battery records nothing and writes no file");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }

        return (failures, checks);
    }
}
