using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

// Local append-only JSON Lines storage: data/snapshots/{yyyy}/{MM}/{dd}.jsonl
//  - One file per day, so a query only opens the days it asks for.
//  - Appends are buffered in memory and written in one operation per file by Flush(), which
//    the sampler calls every few seconds. That turns one open/write/close per sample into one
//    per flush; QueryAsync flushes first so readers never see stale data.
//  - A malformed/partial line (e.g. a hard kill mid-write) is skipped with a warning on read,
//    never thrown: one bad line must not take down a whole day of analytics.
public class LocalJsonSnapshotStore : ISnapshotStore
{
    // A write that keeps failing must not grow the buffer without bound.
    private const int MaxPendingChars = 1_000_000;

    private readonly string _rootDir;
    private readonly object _lock = new();
    private readonly Dictionary<string, StringBuilder> _pending = new();
    private readonly HashSet<string> _knownDirs = new();

    public LocalJsonSnapshotStore(string dataDir)
    {
        _rootDir = Path.Combine(dataDir, "snapshots");
        Directory.CreateDirectory(_rootDir);
    }

    private string FileFor(DateTime day) =>
        Path.Combine(_rootDir, day.Year.ToString("D4"), day.Month.ToString("D2"), $"{day.Day:D2}.jsonl");

    public Task AppendAsync(SystemSnapshot snapshot)
    {
        var file = FileFor(snapshot.TimestampUtc);
        lock (_lock)
        {
            if (!_pending.TryGetValue(file, out var buffer))
            {
                _pending[file] = buffer = new StringBuilder();
                EnsureDirectory(file);
            }
            if (buffer.Length > MaxPendingChars) buffer.Clear();
            buffer.Append(snapshot.Json).Append(Environment.NewLine);
        }
        return Task.CompletedTask;
    }

    private void EnsureDirectory(string file)
    {
        var dir = Path.GetDirectoryName(file)!;
        if (_knownDirs.Add(dir)) Directory.CreateDirectory(dir);
    }

    public void Flush()
    {
        lock (_lock)
        {
            foreach (var (file, buffer) in _pending)
            {
                if (buffer.Length == 0) continue;
                try
                {
                    EnsureDirectory(file);
                    File.AppendAllText(file, buffer.ToString());
                    buffer.Clear();
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    Console.Error.WriteLine($"[LocalJsonSnapshotStore] flush to {file} failed: {ex.Message}");
                }
            }
        }
    }

    public int ResetData(IReadOnlySet<string> fields, bool all)
    {
        lock (_lock)
        {
            if (all)
            {
                var files = Directory.Exists(_rootDir) ? Directory.EnumerateFiles(_rootDir, "*.jsonl", SearchOption.AllDirectories).Count() : 0;
                _pending.Clear();   // lines still in memory must not reappear on the next flush
                if (Directory.Exists(_rootDir)) Directory.Delete(_rootDir, recursive: true);
                Directory.CreateDirectory(_rootDir);
                _knownDirs.Clear();
                return files;
            }

            Flush();   // so recent lines are cleaned too, not appended later with the removed fields
            var changedLines = 0;
            foreach (var file in Directory.EnumerateFiles(_rootDir, "*.jsonl", SearchOption.AllDirectories).ToList())
            {
                var kept = new List<string>();
                var changedHere = 0;
                foreach (var line in File.ReadLines(file))
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    try
                    {
                        if (JsonNode.Parse(line) is JsonObject obj)
                        {
                            var removedAny = false;
                            foreach (var f in fields) removedAny |= obj.Remove(f);
                            if (removedAny)
                            {
                                changedHere++;
                                if (obj.Count > 1) kept.Add(obj.ToJsonString());   // a line left with only its timestamp holds no data
                                continue;
                            }
                        }
                    }
                    catch (JsonException) { /* keep a line we cannot read exactly as it is */ }
                    kept.Add(line);
                }
                if (changedHere == 0) continue;
                changedLines += changedHere;
                if (kept.Count == 0) { File.Delete(file); continue; }
                var tmp = file + ".tmp";
                File.WriteAllLines(tmp, kept);
                File.Move(tmp, file, overwrite: true);
            }
            RemoveEmptyFolders(_rootDir);
            _knownDirs.Clear();
            return changedLines;
        }
    }

    // After a selective reset some day files are gone; remove the month and year folders that are left empty.
    private static void RemoveEmptyFolders(string root)
    {
        if (!Directory.Exists(root)) return;
        foreach (var yearDir in Directory.EnumerateDirectories(root).ToList())
        {
            foreach (var monthDir in Directory.EnumerateDirectories(yearDir).ToList())
                if (!Directory.EnumerateFileSystemEntries(monthDir).Any()) TryDeleteFolder(monthDir);
            if (!Directory.EnumerateFileSystemEntries(yearDir).Any()) TryDeleteFolder(yearDir);
        }
    }

    private static void TryDeleteFolder(string dir)
    {
        try { Directory.Delete(dir); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* in use: leave it */ }
    }


    public Task<IReadOnlyList<SystemSnapshot>> QueryAsync(
        DateTime from, DateTime to, CancellationToken cancellationToken = default)
    {
        Flush();
        var results = new List<SystemSnapshot>();

        // An open-ended lower bound (DateTime.MinValue / "all time") must not
        // iterate ~740,000 non-existent days: clamp to the oldest day on disk.
        var earliest = EarliestDataDate();
        var start = earliest is null ? to.Date : (from.Date < earliest.Value ? earliest.Value : from.Date);

        foreach (var date in EachDate(start, to.Date))
        {
            cancellationToken.ThrowIfCancellationRequested();

            var file = FileFor(date);
            if (!File.Exists(file)) continue;

            foreach (var line in File.ReadLines(file))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;

                DateTime ts;
                try
                {
                    using var doc = JsonDocument.Parse(line);
                    ts = doc.RootElement.GetProperty("timestamp").GetDateTime();
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine(
                        $"[LocalJsonSnapshotStore] skipping malformed line in {file}: {ex.Message}");
                    continue;
                }

                if (ts >= from && ts <= to)
                {
                    results.Add(new SystemSnapshot(ts, line));
                }
            }
        }

        return Task.FromResult<IReadOnlyList<SystemSnapshot>>(results);
    }

    /// <summary>Oldest day that has a snapshot file, or null if there is no history yet.</summary>
    private DateTime? EarliestDataDate()
    {
        try
        {
            foreach (var yearDir in Directory.EnumerateDirectories(_rootDir).OrderBy(d => d, StringComparer.Ordinal))
            {
                if (!int.TryParse(Path.GetFileName(yearDir), out var y)) continue;
                foreach (var monthDir in Directory.EnumerateDirectories(yearDir).OrderBy(d => d, StringComparer.Ordinal))
                {
                    if (!int.TryParse(Path.GetFileName(monthDir), out var m)) continue;
                    foreach (var file in Directory.EnumerateFiles(monthDir, "*.jsonl").OrderBy(f => f, StringComparer.Ordinal))
                    {
                        if (int.TryParse(Path.GetFileNameWithoutExtension(file), out var d)
                            && y is >= 1 and <= 9999 && m is >= 1 and <= 12 && d is >= 1 and <= 31)
                        {
                            try { return new DateTime(y, m, d, 0, 0, 0, DateTimeKind.Utc); }
                            catch (ArgumentOutOfRangeException) { /* e.g. 31 Feb: ignore stray file */ }
                        }
                    }
                }
            }
        }
        catch (DirectoryNotFoundException) { }
        return null;
    }

    private static IEnumerable<DateTime> EachDate(DateTime from, DateTime to)
    {
        for (var d = from; d <= to; d = d.AddDays(1))
        {
            yield return d;
        }
    }
}
