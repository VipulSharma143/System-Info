namespace SystemMonitor.Api.Services;

/// <summary>
/// How long stored history lives. Everything the app keeps on disk (the daily snapshot files and the battery sessions) is limited
/// to the current UTC day plus the six before it; older day files are deleted. Pure file logic, shared by the store and its tests.
/// </summary>
public static class DataRetention
{
    public const int Days = 7;

    /// <summary>The oldest day that is kept: today and the previous <see cref="Days"/> - 1 days (UTC).</summary>
    public static DateTime FirstKeptDay(DateTime nowUtc) => nowUtc.Date.AddDays(-(Days - 1));

    /// <summary>The day a snapshot file belongs to (".../yyyy/MM/dd.jsonl"), or null for a file that does not follow the layout.</summary>
    public static DateTime? DayOf(string file)
    {
        var name = Path.GetFileNameWithoutExtension(file);
        var monthDir = Path.GetDirectoryName(file);
        var yearDir = monthDir is null ? null : Path.GetDirectoryName(monthDir);
        if (monthDir is null || yearDir is null) return null;
        if (!int.TryParse(name, out var d) || !int.TryParse(Path.GetFileName(monthDir), out var m) || !int.TryParse(Path.GetFileName(yearDir), out var y)) return null;
        try { return new DateTime(y, m, d, 0, 0, 0, DateTimeKind.Utc); }
        catch (ArgumentOutOfRangeException) { return null; }
    }

    /// <summary>Deletes snapshot files older than the window, then any month or year folders that are left empty. Returns the number of files deleted.</summary>
    public static int PruneSnapshotFiles(string root, DateTime nowUtc)
    {
        if (!Directory.Exists(root)) return 0;
        var first = FirstKeptDay(nowUtc);
        var removed = 0;
        foreach (var file in Directory.EnumerateFiles(root, "*.jsonl", SearchOption.AllDirectories).ToList())
        {
            if (DayOf(file) is not { } day || day >= first) continue;
            try { File.Delete(file); removed++; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* in use or read-only: try again next run */ }
        }
        if (removed > 0) RemoveEmptyFolders(root, first);
        return removed;
    }

    /// <summary>Removes empty month and year folders. With <paramref name="before"/> set, only those entirely older than that day.</summary>
    public static void RemoveEmptyFolders(string root, DateTime? before = null)
    {
        if (!Directory.Exists(root)) return;
        foreach (var yearDir in Directory.EnumerateDirectories(root).ToList())
        {
            _ = int.TryParse(Path.GetFileName(yearDir), out var y);
            foreach (var monthDir in Directory.EnumerateDirectories(yearDir).ToList())
            {
                _ = int.TryParse(Path.GetFileName(monthDir), out var m);
                var old = before is not { } b || y < b.Year || (y == b.Year && m < b.Month);
                if (old && !Directory.EnumerateFileSystemEntries(monthDir).Any()) TryDelete(monthDir);
            }
            if ((before is not { } by || y < by.Year) && !Directory.EnumerateFileSystemEntries(yearDir).Any()) TryDelete(yearDir);
        }
    }

    private static void TryDelete(string dir)
    {
        try { Directory.Delete(dir); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }
}
