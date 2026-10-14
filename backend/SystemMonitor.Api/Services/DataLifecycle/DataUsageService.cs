using System.Globalization;
using System.Text.Json.Serialization;

namespace SystemMonitor.Api.Services;

/// <summary>One kind of saved data and the disk space it takes.</summary>
public sealed record DataUsagePart(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("bytes")] long Bytes,
    [property: JsonPropertyName("files")] int Files);

/// <summary>What /api/data/usage returns: how much disk space System Info's saved data uses, and where it is.</summary>
public sealed record DataUsage(
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("totalBytes")] long TotalBytes,
    [property: JsonPropertyName("totalFiles")] int TotalFiles,
    [property: JsonPropertyName("parts")] List<DataUsagePart> Parts,
    [property: JsonPropertyName("historyDays")] int HistoryDays,
    [property: JsonPropertyName("oldestDay")] string? OldestDay,
    [property: JsonPropertyName("newestDay")] string? NewestDay);

/// <summary>
/// Adds up the files System Info keeps in its data folder (the same folder on Linux and Windows; only its location differs, see
/// AppDataPath). Sizes come from the file system, not from reading the files, so it is cheap even with months of history. A file
/// that cannot be inspected is skipped rather than failing the whole readout. The history keeps growing until the person resets it,
/// so this is how they see how big it has become.
/// </summary>
public sealed class DataUsageService
{
    private readonly string _dataDir;

    public DataUsageService(string dataDir) => _dataDir = System.IO.Path.GetFullPath(dataDir);

    public DataUsage Read()
    {
        var history = Measure("snapshots");
        var battery = Measure("battery");
        var cache = Measure("cache");
        var accounted = new[] { "snapshots", "battery", "cache" };
        var other = MeasureRoot(accounted);

        var days = new List<DateTime>();
        var snapshots = System.IO.Path.Combine(_dataDir, "snapshots");
        if (Directory.Exists(snapshots))
            foreach (var file in Safe(() => Directory.EnumerateFiles(snapshots, "*.jsonl", SearchOption.AllDirectories)))
                if (DayOf(file) is { } d) days.Add(d);

        var parts = new List<DataUsagePart>
        {
            new("history", "Saved history (CPU, network and battery readings)", history.Bytes, history.Files),
            new("battery", "Battery charging history", battery.Bytes, battery.Files),
            new("cache", "Cached information", cache.Bytes, cache.Files),
        };
        if (other.Files > 0) parts.Add(new("other", "Other files", other.Bytes, other.Files));

        return new DataUsage(_dataDir, parts.Sum(p => p.Bytes), parts.Sum(p => p.Files), parts,
            days.Count, days.Count == 0 ? null : days.Min().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            days.Count == 0 ? null : days.Max().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
    }

    private (long Bytes, int Files) Measure(string folder)
    {
        var dir = System.IO.Path.Combine(_dataDir, folder);
        return Directory.Exists(dir) ? Sum(Safe(() => Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))) : (0, 0);
    }

    // Files in the data folder that are not inside one of the folders above (for example the sensor-driver install marker).
    private (long Bytes, int Files) MeasureRoot(string[] skipFolders)
    {
        if (!Directory.Exists(_dataDir)) return (0, 0);
        var files = Safe(() => Directory.EnumerateFiles(_dataDir)).ToList();
        foreach (var sub in Safe(() => Directory.EnumerateDirectories(_dataDir)))
        {
            if (skipFolders.Contains(System.IO.Path.GetFileName(sub), StringComparer.OrdinalIgnoreCase)) continue;
            files.AddRange(Safe(() => Directory.EnumerateFiles(sub, "*", SearchOption.AllDirectories)));
        }
        return Sum(files);
    }

    private static (long Bytes, int Files) Sum(IEnumerable<string> files)
    {
        long bytes = 0; var count = 0;
        foreach (var f in files)
        {
            try { bytes += new FileInfo(f).Length; count++; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* gone or locked: skip */ }
        }
        return (bytes, count);
    }

    // Enumeration can fail part-way (a folder removed or locked while we look); keep what was listed.
    private static IEnumerable<string> Safe(Func<IEnumerable<string>> list)
    {
        var found = new List<string>();
        try { foreach (var f in list()) found.Add(f); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        return found;
    }

    /// <summary>The day a history file belongs to (".../yyyy/MM/dd.jsonl"), or null for a file that does not follow the layout.</summary>
    private static DateTime? DayOf(string file)
    {
        var monthDir = System.IO.Path.GetDirectoryName(file);
        var yearDir = monthDir is null ? null : System.IO.Path.GetDirectoryName(monthDir);
        if (monthDir is null || yearDir is null) return null;
        if (!int.TryParse(System.IO.Path.GetFileNameWithoutExtension(file), out var d) || !int.TryParse(System.IO.Path.GetFileName(monthDir), out var m) || !int.TryParse(System.IO.Path.GetFileName(yearDir), out var y)) return null;
        try { return new DateTime(y, m, d, 0, 0, 0, DateTimeKind.Utc); }
        catch (ArgumentOutOfRangeException) { return null; }
    }
}
