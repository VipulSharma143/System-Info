namespace SystemMonitor.Api.Services;

/// <summary>
/// Linux EDAC error counters (<c>/sys/devices/system/edac/mc/mc*/{ce,ue}_count</c>). Counters are only
/// reported when the kernel actually exposes them: a missing EDAC directory means "unknown", never 0 errors.
/// </summary>
public static class MemoryHealthReader
{
    public const string DefaultRoot = "/sys/devices/system/edac/mc";

    public static (long? Corrected, long? Uncorrected) ReadEdac(string root = DefaultRoot)
    {
        long? corrected = null, uncorrected = null;
        try
        {
            if (!Directory.Exists(root)) return (null, null);
            // Directory search patterns only understand * and ?, so "mc0, mc1, ..." is filtered by hand.
            foreach (var controller in Directory.EnumerateDirectories(root, "mc*").Where(IsController))
            {
                if (TryRead(Path.Combine(controller, "ce_count"), out var ce)) corrected = (corrected ?? 0) + ce;
                if (TryRead(Path.Combine(controller, "ue_count"), out var ue)) uncorrected = (uncorrected ?? 0) + ue;
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return (null, null);
        }
        return (corrected, uncorrected);
    }

    private static bool IsController(string path)
    {
        var name = Path.GetFileName(path);
        return name.Length > 2 && name.StartsWith("mc", StringComparison.Ordinal) && name.AsSpan(2).IndexOfAnyExceptInRange('0', '9') < 0;
    }

    private static bool TryRead(string path, out long value)
    {
        value = 0;
        try
        {
            return long.TryParse(File.ReadAllText(path).Trim(), out value) && value >= 0;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }
}
