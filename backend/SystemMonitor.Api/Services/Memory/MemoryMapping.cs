using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Native;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Pure translation from the native contract (-1 = unknown number, "" = unknown string) and from
/// /proc/meminfo into the nullable API models. No I/O and no OS calls, so it is unit-tested on any host.
/// </summary>
public static class MemoryMapping
{
    // Filler text firmware vendors leave in SMBIOS string fields. It is a value, but not information.
    private static readonly HashSet<string> Placeholders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Not Specified", "To Be Filled By O.E.M.", "Unknown", "Default string", "N/A", "None", "Undefined", "Not Provided",
    };

    public static string? Text(string? value)
    {
        var t = value?.Trim();
        return string.IsNullOrEmpty(t) || Placeholders.Contains(t) ? null : t;
    }

    private static long? NonNegative(long v) => v >= 0 ? v : null;
    private static long? Positive(long v) => v > 0 ? v : null;
    private static int? Positive(int v) => v > 0 ? v : null;

    // 1 = capable, 0 = not capable, anything else (-1) = not reported.
    private static bool? Ecc(int v) => v switch { 1 => true, 0 => false, _ => null };

    // ------------------------------------------------------------------ runtime RAM

    /// <summary>Null when the native snapshot is not usable (caller falls back or reports unavailable).</summary>
    public static RamDetails? ToRamDetails(NativeMemoryInfo n)
    {
        if (n.TotalBytes <= 0 || n.AvailableBytes < 0 || n.AvailableBytes > n.TotalBytes) return null;

        var free = NonNegative(n.FreeBytes);
        var buffers = NonNegative(n.BuffersBytes);
        var missing = new List<string>();
        if (free is null) missing.Add("free memory");
        if (buffers is null) missing.Add("buffers");

        return Build(n.TotalBytes, n.AvailableBytes, free, NonNegative(n.CachedBytes), buffers,
            NonNegative(n.SwapTotalBytes), NonNegative(n.SwapUsedBytes),
            NonNegative(n.CommitLimitBytes), NonNegative(n.CommitUsedBytes),
            source: "native",
            note: missing.Count > 0 ? $"This operating system does not report {string.Join(" or ", missing)}." : null);
    }

    /// <summary>Basic values only (the managed fallback). Null when total/available are unusable.</summary>
    public static RamDetails? FromBasic(long totalBytes, long availableBytes, long? freeBytes = null,
        long? cachedBytes = null, long? buffersBytes = null, long? swapTotalBytes = null, long? swapUsedBytes = null)
    {
        if (totalBytes <= 0 || availableBytes < 0 || availableBytes > totalBytes) return null;
        return Build(totalBytes, availableBytes, freeBytes, cachedBytes, buffersBytes, swapTotalBytes, swapUsedBytes,
            null, null, source: "managed-fallback",
            note: "Detailed memory counters were unavailable, so basic values from the operating system are shown.");
    }

    /// <summary>Linux fallback from /proc/meminfo lines. Mirrors the native mapping (cached = Cached + SReclaimable).</summary>
    public static RamDetails? FromMeminfo(IEnumerable<string> lines)
    {
        var kb = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var line in lines)
        {
            var colon = line.IndexOf(':');
            if (colon <= 0) continue;
            var parts = line[(colon + 1)..].Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length > 0 && long.TryParse(parts[0], out var v)) kb[line[..colon]] = v;
        }

        if (!kb.TryGetValue("MemTotal", out var total) || !kb.TryGetValue("MemAvailable", out var available)) return null;

        long? Bytes(string key) => kb.TryGetValue(key, out var v) ? v * 1024 : null;
        long? cached = kb.TryGetValue("Cached", out var c) ? (c + (kb.TryGetValue("SReclaimable", out var r) ? r : 0)) * 1024 : null;
        long? swapTotal = Bytes("SwapTotal");
        long? swapUsed = kb.TryGetValue("SwapTotal", out var st) && kb.TryGetValue("SwapFree", out var sf) && sf <= st
            ? (st - sf) * 1024 : null;

        return FromBasic(total * 1024, available * 1024, Bytes("MemFree"), cached, Bytes("Buffers"), swapTotal, swapUsed);
    }

    private static RamDetails Build(long total, long available, long? free, long? cached, long? buffers,
        long? swapTotal, long? swapUsed, long? commitLimit, long? commitUsed, string source, string? note)
    {
        var used = total - available;
        return new RamDetails(total, used, available, free, cached, buffers, swapTotal, swapUsed,
            commitLimit, commitUsed, Math.Round(used * 100.0 / total, 1), source, note);
    }

    // ------------------------------------------------------------------ physical RAM

    /// <summary>
    /// Plain-language reason physical memory details are missing, with the one action that fixes it.
    /// <paramref name="status"/> is the native reason code (null = the native engine could not be asked,
    /// i.e. it is missing or too old). Shown in the UI as-is, so it must read as plain language.
    /// </summary>
    public static string UnavailableNote(int? status, bool isLinux) => status switch
    {
        null => "Physical memory details are unavailable because the native engine is out of date. Rebuild it and restart the app.",
        2 => "Physical memory details need a one-time setup on Linux: run the memory snapshot helper once with administrator rights, then reopen this tab. The README explains how.",
        3 => "The saved memory snapshot is from before the last restart. Run the memory snapshot helper again, or install its startup service so this happens automatically.",
        1 => isLinux
            ? "This system doesn't provide firmware memory tables (common in virtual machines), so physical memory details can't be shown."
            : "Windows didn't provide firmware memory tables on this system, so physical memory details can't be shown.",
        4 => "The firmware memory tables on this system couldn't be read.",
        _ => "Physical memory details aren't available on this system.",
    };

    public static MemoryModule ToModule(NativeMemoryModule m) => new(
        Text(m.Manufacturer), Text(m.PartNumber), Text(m.SerialNumber), Text(m.Locator), Text(m.BankLocator),
        Text(m.FormFactor), Text(m.MemoryType),
        Positive(m.CapacityBytes), Positive(m.SpeedMTs), Positive(m.ConfiguredSpeedMTs),
        Positive(m.DataWidth), Positive(m.TotalWidth), Positive(m.Rank), Ecc(m.Ecc));

    /// <summary>
    /// Combines the native summary and module list. Nothing is inferred beyond reading the modules back:
    /// no channel mode, no per-slot maximum (<c>max capacity / slots</c> is not a platform-reported value).
    /// </summary>
    public static MemoryHardwareInfo ToHardwareInfo(NativeMemorySummary? summary,
        IReadOnlyList<NativeMemoryModule> nativeModules, string unavailableNote)
    {
        if (summary is null && nativeModules.Count == 0)
            return new MemoryHardwareInfo(false, null, Array.Empty<MemoryModule>(), "unavailable", unavailableNote);

        var modules = nativeModules.Select(ToModule).ToList();
        return new MemoryHardwareInfo(true, ToSummary(summary, modules), modules, "smbios", null);
    }

    public static MemoryHardwareSummary ToSummary(NativeMemorySummary? n, IReadOnlyList<MemoryModule> modules)
    {
        int? moduleCount = n is { ModuleCount: >= 0 } ? n.ModuleCount : modules.Count;
        int? slotCount = n is not null ? Positive(n.SlotCount) : null;      // 0 and -1 both mean "firmware didn't say"
        int? emptySlots = slotCount is { } s && moduleCount is { } mc && s >= mc ? s - mc : null;

        // Configured speed is a platform fact only when every module agrees on it.
        long? configured = null;
        if (modules.Count > 0 && modules.All(m => m.ConfiguredSpeedMTs is not null)
            && modules.Select(m => m.ConfiguredSpeedMTs).Distinct().Count() == 1)
            configured = modules[0].ConfiguredSpeedMTs;

        var speeds = modules.Where(m => m.SpeedMTs is not null).Select(m => m.SpeedMTs!.Value).ToList();

        return new MemoryHardwareSummary(
            InstalledBytes: n is not null ? Positive(n.InstalledBytes) : null,
            ModuleCount: moduleCount,
            SlotCount: slotCount,
            EmptySlots: emptySlots,
            MaxCapacityBytes: n is not null ? Positive(n.MaxCapacityBytes) : null,
            MaxModuleCapacityBytes: n is not null ? Positive(n.MaxModuleCapacityBytes) : null,
            MemoryType: JoinDistinct(modules.Select(m => m.MemoryType)),
            FormFactor: JoinDistinct(modules.Select(m => m.FormFactor)),
            ConfiguredSpeedMTs: configured,
            MaxSpeedMTs: speeds.Count > 0 ? speeds.Max() : null,
            ChannelMode: null,
            EccSupport: CombineEcc(modules));
    }

    private static string? JoinDistinct(IEnumerable<string?> values)
    {
        var distinct = values.Where(v => !string.IsNullOrEmpty(v)).Select(v => v!).Distinct().ToList();
        return distinct.Count == 0 ? null : string.Join(" / ", distinct);
    }

    // Any module on a capable array => capable; known "not capable" everywhere => not capable; else unknown.
    private static bool? CombineEcc(IReadOnlyList<MemoryModule> modules)
    {
        if (modules.Count == 0) return null;
        if (modules.Any(m => m.EccCapable == true)) return true;
        return modules.All(m => m.EccCapable == false) ? false : null;
    }
}
