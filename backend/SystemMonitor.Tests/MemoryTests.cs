using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Native;
using SystemMonitor.Api.Services;

// Pure mapping/parsing tests: no native library and no real hardware needed, so they run on any host.
static class MemoryTests
{
    const long GiB = 1L << 30;

    static NativeMemoryModule Module(string mfr = "", string part = "", string serial = "", string loc = "", string bank = "",
        string form = "", string type = "", long cap = -1, long speed = -1, long cfg = -1,
        int dw = -1, int tw = -1, int rank = -1, int ecc = -1) =>
        new(mfr, part, serial, loc, bank, form, type, cap, speed, cfg, dw, tw, rank, ecc);

    public static (int Failures, int Checks) Run()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }

        // ---------------- runtime RAM: native mapping ----------------
        var linux = MemoryMapping.ToRamDetails(new NativeMemoryInfo(16 * GiB, 6 * GiB, 1 * GiB, 4 * GiB, GiB / 2,
            8 * GiB, 2 * GiB, -1, -1));
        Check(linux is not null, "valid native snapshot maps");
        if (linux is not null)
        {
            Check(linux.UsedBytes == 10 * GiB, "used = total - available");
            Check(Math.Abs(linux.UsedPercent - 62.5) < 1e-9, $"used percent from total/available, got {linux.UsedPercent}");
            Check(linux.Source == "native" && linux.Note is null, "native source, no note when free/buffers are known");
            Check(linux.CommitLimitBytes is null && linux.CommitUsedBytes is null, "unknown commit stays null (not 0)");
            Check(linux.FreeBytes == GiB && linux.BuffersBytes == GiB / 2 && linux.CachedBytes == 4 * GiB, "known extras carried over");
        }

        var windows = MemoryMapping.ToRamDetails(new NativeMemoryInfo(16 * GiB, 8 * GiB, -1, 3 * GiB, -1,
            4 * GiB, GiB, 20 * GiB, 9 * GiB));
        Check(windows is { FreeBytes: null, BuffersBytes: null }, "Windows-style unknown free/buffers become null");
        Check(windows is { CommitLimitBytes: 20 * GiB, CommitUsedBytes: 9 * GiB }, "commit carried over when reported");
        Check(windows?.Note is { } n && n.Contains("free memory") && n.Contains("buffers"), "note explains what is not reported");

        Check(MemoryMapping.ToRamDetails(new NativeMemoryInfo(0, 0, -1, -1, -1, -1, -1, -1, -1)) is null, "total 0 is unusable");
        Check(MemoryMapping.ToRamDetails(new NativeMemoryInfo(-1, -1, -1, -1, -1, -1, -1, -1, -1)) is null, "all-unknown is unusable");
        Check(MemoryMapping.ToRamDetails(new NativeMemoryInfo(GiB, 2 * GiB, -1, -1, -1, -1, -1, -1, -1)) is null, "available > total is unusable");
        Check(MemoryMapping.ToRamDetails(new NativeMemoryInfo(GiB, -1, -1, -1, -1, -1, -1, -1, -1)) is null, "unknown available is unusable");

        var noSwap = MemoryMapping.ToRamDetails(new NativeMemoryInfo(GiB, GiB / 2, 0, 0, 0, 0, 0, -1, -1));
        Check(noSwap is { SwapTotalBytes: 0, SwapUsedBytes: 0, FreeBytes: 0 }, "a genuinely reported 0 is kept as 0, not null");

        // ---------------- runtime RAM: /proc/meminfo fallback ----------------
        var meminfo = new[]
        {
            "MemTotal:       16384000 kB", "MemFree:         1000000 kB", "MemAvailable:    6000000 kB",
            "Buffers:          500000 kB", "Cached:          3000000 kB", "SReclaimable:     200000 kB",
            "SwapTotal:       8000000 kB", "SwapFree:         6000000 kB",
        };
        var fb = MemoryMapping.FromMeminfo(meminfo);
        Check(fb is { Source: "managed-fallback" } && fb.Note is not null, "fallback is labelled and explained");
        Check(fb?.TotalBytes == 16384000L * 1024 && fb.AvailableBytes == 6000000L * 1024, "fallback total/available in bytes");
        Check(fb?.CachedBytes == 3200000L * 1024, "cached = Cached + SReclaimable (matches the native mapping)");
        Check(fb?.SwapUsedBytes == 2000000L * 1024 && fb.BuffersBytes == 500000L * 1024, "swap used = total - free, buffers kept");
        Check(fb?.CommitLimitBytes is null, "fallback never invents commit");
        Check(MemoryMapping.FromMeminfo(new[] { "MemTotal: 100 kB" }) is null, "missing MemAvailable => unusable, not guessed");
        Check(MemoryMapping.FromMeminfo(Array.Empty<string>()) is null, "empty meminfo => unusable");
        Check(MemoryMapping.FromMeminfo(new[] { "MemTotal: 100 kB", "MemAvailable: 50 kB", "garbage", "SwapTotal: x kB" }) is { SwapTotalBytes: null },
            "garbage lines are skipped, unparsable swap stays null");

        // ---------------- module mapping ----------------
        var unknown = MemoryMapping.ToModule(Module());
        Check(unknown == new MemoryModule(null, null, null, null, null, null, null, null, null, null, null, null, null, null),
            "all-unknown native module maps to all-null (no 0 GB / 0 MT/s / empty strings)");

        var placeholders = MemoryMapping.ToModule(Module(mfr: "Not Specified", part: "To Be Filled By O.E.M.", serial: "  ",
            loc: "Unknown", bank: "N/A", form: "Default string"));
        Check(placeholders.Manufacturer is null && placeholders.PartNumber is null && placeholders.SerialNumber is null
              && placeholders.Locator is null && placeholders.BankLocator is null && placeholders.FormFactor is null,
            "firmware filler strings are treated as not reported");

        var real = MemoryMapping.ToModule(Module("Acme Memory", " PN-123 ", "0000C526", "DIMM0", "BANK 0", "SODIMM", "DDR3",
            2 * GiB, 1600, 1333, 64, 72, 2, 1));
        Check(real is { Manufacturer: "Acme Memory", PartNumber: "PN-123", SerialNumber: "0000C526", Locator: "DIMM0",
                BankLocator: "BANK 0", FormFactor: "SODIMM", MemoryType: "DDR3", CapacityBytes: 2 * GiB, SpeedMTs: 1600,
                ConfiguredSpeedMTs: 1333, DataWidthBits: 64, TotalWidthBits: 72, Rank: 2, EccCapable: true },
            "fully reported module maps field for field (strings trimmed, speeds in MT/s)");
        Check(MemoryMapping.ToModule(Module(ecc: 0)).EccCapable == false, "ecc 0 => not capable");
        Check(MemoryMapping.ToModule(Module(ecc: -1)).EccCapable is null, "ecc -1 => not reported");
        Check(MemoryMapping.ToModule(Module(rank: 0, dw: 0, speed: 0)) is { Rank: null, DataWidthBits: null, SpeedMTs: null },
            "SMBIOS 0 for rank/width/speed means unknown");

        // ---------------- hardware info / summary ----------------
        var none = MemoryMapping.ToHardwareInfo(null, Array.Empty<NativeMemoryModule>(), "no access");
        Check(none is { Available: false, Summary: null, Source: "unavailable", Note: "no access" } && none.Modules.Count == 0,
            "nothing readable => available=false with the note, empty module list");

        var two = new[]
        {
            Module("Acme", "A", "S1", "DIMM0", "BANK 0", "SODIMM", "DDR3", 2 * GiB, 1600, 1600, 64, 64, 1, 0),
            Module("Other", "B", "S2", "DIMM1", "BANK 2", "SODIMM", "DDR3", 4 * GiB, 1600, 1600, 64, 64, 2, 0),
        };
        var info = MemoryMapping.ToHardwareInfo(new NativeMemorySummary(6 * GiB, 2, 4, 16 * GiB, -1), two, "x");
        Check(info is { Available: true, Source: "smbios", Note: null } && info.Modules.Count == 2, "two populated modules => two entries, no fake empty ones");
        var s = info.Summary!;
        Check(s.InstalledBytes == 6 * GiB && s.ModuleCount == 2 && s.SlotCount == 4 && s.EmptySlots == 2, "slots: 2 occupied of 4 => 2 empty");
        Check(s.MaxCapacityBytes == 16 * GiB, "max capacity from the platform");
        Check(s.MaxModuleCapacityBytes is null, "per-slot maximum stays unknown (never max capacity / slots)");
        Check(s.ChannelMode is null, "two DIMMs do not prove a channel mode");
        Check(s.MemoryType == "DDR3" && s.FormFactor == "SODIMM" && s.ConfiguredSpeedMTs == 1600 && s.MaxSpeedMTs == 1600, "uniform modules => single values");
        Check(s.EccSupport == false, "all modules report no ECC => not supported");

        var unknownSlots = MemoryMapping.ToSummary(new NativeMemorySummary(6 * GiB, 2, 0, -1, -1), info.Modules);
        Check(unknownSlots.SlotCount is null && unknownSlots.EmptySlots is null, "slot count 0 = unknown, so empty slots unknown");
        Check(unknownSlots.MaxCapacityBytes is null, "unknown max capacity -1 => null");
        Check(MemoryMapping.ToSummary(new NativeMemorySummary(6 * GiB, 2, -1, -1, -1), info.Modules).SlotCount is null, "slot count -1 => null");
        Check(MemoryMapping.ToSummary(new NativeMemorySummary(6 * GiB, 2, 65535, -1, -1), info.Modules).SlotCount == 65535,
            "mapping does not second-guess a count the native layer already vetted");
        Check(MemoryMapping.ToSummary(new NativeMemorySummary(6 * GiB, 4, 2, -1, -1), info.Modules).EmptySlots is null,
            "more modules than slots is inconsistent => empty slots unknown, not negative");

        var mixed = new[]
        {
            Module(type: "DDR3", form: "SODIMM", cap: GiB, speed: 1333, cfg: 1333, ecc: 1),
            Module(type: "DDR4", form: "DIMM", cap: GiB, speed: 2400, cfg: 2133, ecc: -1),
        }.Select(MemoryMapping.ToModule).ToList();
        var ms = MemoryMapping.ToSummary(null, mixed);
        Check(ms.MemoryType == "DDR3 / DDR4" && ms.FormFactor == "SODIMM / DIMM", "differing modules are listed, not collapsed to one");
        Check(ms.ConfiguredSpeedMTs is null, "configured speed unknown when modules disagree");
        Check(ms.MaxSpeedMTs == 2400, "max reported speed = highest module rating");
        Check(ms.EccSupport == true, "any capable module => ECC supported");
        Check(ms.ModuleCount == 2 && ms.InstalledBytes is null, "no native summary: count from modules, installed not derived");

        Check(MemoryMapping.ToSummary(null, new[] { Module(ecc: 0), Module(ecc: -1) }.Select(MemoryMapping.ToModule).ToList()).EccSupport is null,
            "partly unknown ECC => unknown, not 'not supported'");
        Check(MemoryMapping.ToSummary(null, Array.Empty<MemoryModule>()).EccSupport is null, "no modules => ECC unknown");

        // ---------------- why physical memory is unavailable ----------------
        string[] notes =
        {
            MemoryMapping.UnavailableNote(null, true), MemoryMapping.UnavailableNote(1, true), MemoryMapping.UnavailableNote(1, false),
            MemoryMapping.UnavailableNote(2, true), MemoryMapping.UnavailableNote(3, true), MemoryMapping.UnavailableNote(4, true),
            MemoryMapping.UnavailableNote(99, true),
        };
        Check(notes.Distinct().Count() == notes.Length, "every reason gets its own message");
        Check(MemoryMapping.UnavailableNote(2, true).Contains("administrator") && MemoryMapping.UnavailableNote(2, true).Contains("one-time"),
            "permission reason tells the user the one action that fixes it");
        Check(MemoryMapping.UnavailableNote(3, true).Contains("restart"), "stale snapshot reason says why and what to do");
        Check(MemoryMapping.UnavailableNote(null, true).Contains("native engine"), "missing native engine is named");
        Check(MemoryMapping.UnavailableNote(1, true).Contains("virtual machines") && !MemoryMapping.UnavailableNote(1, false).Contains("virtual"),
            "no-table reason is platform appropriate");
        // The UI hides anything that looks like developer text (URLs, ports, "stack", /api/): none of these may trip that filter.
        foreach (var text in notes)
            Check(!text.Contains("http") && !text.Contains("localhost") && !text.Contains("/api/") && !text.ToLowerInvariant().Contains("stack")
                  && !System.Text.RegularExpressions.Regex.IsMatch(text, @":\d{2,5}\b"), "note reads as plain language: " + text[..30]);

        // ---------------- EDAC counters ----------------
        var root = Path.Combine(Path.GetTempPath(), "sysinfo-edac-" + Guid.NewGuid().ToString("N"));
        try
        {
            Check(MemoryHealthReader.ReadEdac(root) == (null, null), "no EDAC directory => unknown, not 0 errors");

            Directory.CreateDirectory(Path.Combine(root, "mc0"));
            Check(MemoryHealthReader.ReadEdac(root) == (null, null), "controller without counter files => unknown");

            File.WriteAllText(Path.Combine(root, "mc0", "ce_count"), "3\n");
            File.WriteAllText(Path.Combine(root, "mc0", "ue_count"), "0\n");
            Directory.CreateDirectory(Path.Combine(root, "mc1"));
            File.WriteAllText(Path.Combine(root, "mc1", "ce_count"), "2\n");
            File.WriteAllText(Path.Combine(root, "mc1", "ue_count"), "1\n");
            Directory.CreateDirectory(Path.Combine(root, "power"));
            File.WriteAllText(Path.Combine(root, "power", "ce_count"), "99\n");
            Check(MemoryHealthReader.ReadEdac(root) == (5, 1), "counters summed across controllers; non-mc directories ignored");

            File.WriteAllText(Path.Combine(root, "mc1", "ce_count"), "not a number");
            Check(MemoryHealthReader.ReadEdac(root) == (3, 1), "an unparsable counter is skipped, not treated as 0");
        }
        finally { try { Directory.Delete(root, true); } catch { } }

        return (failures, checks);
    }
}
