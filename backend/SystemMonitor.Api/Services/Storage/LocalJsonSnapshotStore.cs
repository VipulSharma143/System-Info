
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

// Local append-only JSON Lines storage:
// data/snapshots/{yyyy}/{MM}/{dd}.jsonl
public class LocalJsonSnapshotStore : ISnapshotStore, IRawSnapshotFiles
{
    private const int MaxPendingChars = 1_000_000;

    private readonly string _rootDir;
    private readonly object _lock = new();
    private readonly Dictionary<string, StringBuilder> _pending = new();
    private readonly HashSet<string> _knownDirs = new();

    // One file per day: the path is built once per day, not once per appended line (guarded by _lock).
    private DateTime _appendDay;
    private string? _appendFile;

    public LocalJsonSnapshotStore(string dataDir)
    {
        _rootDir = Path.Combine(dataDir, "snapshots");
        Directory.CreateDirectory(_rootDir);
    }

    private string FileFor(DateTime day) =>
        Path.Combine(
            _rootDir,
            day.Year.ToString("D4"),
            day.Month.ToString("D2"),
            $"{day.Day:D2}.jsonl");

    public Task AppendAsync(SystemSnapshot snapshot)
    {
        lock (_lock)
        {
            var day = snapshot.TimestampUtc.Date;
            if (_appendFile is null || day != _appendDay)
            {
                _appendFile = FileFor(day);
                _appendDay = day;
            }
            var file = _appendFile;

            if (!_pending.TryGetValue(file, out var buffer))
            {
                buffer = new StringBuilder();
                _pending[file] = buffer;
                EnsureDirectory(file);
            }

            if (buffer.Length > MaxPendingChars)
            {
                Console.Error.WriteLine(
                    $"[LocalJsonSnapshotStore] pending buffer limit reached for {file}; clearing buffer.");
                buffer.Clear();
            }

            buffer.Append(snapshot.Json).Append(Environment.NewLine);
        }

        return Task.CompletedTask;
    }

    private void EnsureDirectory(string file)
    {
        var dir = Path.GetDirectoryName(file)!;

        if (_knownDirs.Add(dir))
        {
            Directory.CreateDirectory(dir);
        }
    }

    public void Flush()
    {
        lock (_lock)
        {
            foreach (var (file, buffer) in _pending)
            {
                if (buffer.Length == 0)
                    continue;

                try
                {
                    EnsureDirectory(file);
                    File.AppendAllText(file, buffer.ToString());
                    buffer.Clear();
                }
                catch (Exception ex) when (
                    ex is IOException or UnauthorizedAccessException)
                {
                    Console.Error.WriteLine(
                        $"[LocalJsonSnapshotStore] flush to {file} failed: {ex.Message}");
                }
            }
        }
    }

    public int Prune(DateTime utcNow)
    {
        lock (_lock)
        {
            Flush();

            var cutoff = DataRetention.FirstKeptDay(utcNow);

            var removed = 0;

            if (!Directory.Exists(_rootDir))
                return 0;

            foreach (var file in Directory
                .EnumerateFiles(_rootDir, "*.jsonl", SearchOption.AllDirectories)
                .ToList())
            {
                if (DataRetention.DayOf(file) is not { } fileDate ||
                    fileDate >= cutoff)
                    continue;

                if (_pending.TryGetValue(file, out var buffer) &&
                    buffer.Length > 0)
                {
                    continue;
                }

                try
                {
                    File.Delete(file);
                    _pending.Remove(file);
                    removed++;
                }
                catch (Exception ex) when (
                    ex is IOException or UnauthorizedAccessException)
                {
                    Console.Error.WriteLine(
                        $"[LocalJsonSnapshotStore] prune of {file} failed: {ex.Message}");
                }
            }

            RemoveEmptyFolders(_rootDir);
            _knownDirs.Clear();

            return removed;
        }
    }

    public int ResetData(IReadOnlySet<string> fields, bool all)
    {
        lock (_lock)
        {
            if (all)
            {
                var files = Directory.Exists(_rootDir)
                    ? Directory.EnumerateFiles(
                        _rootDir, "*.jsonl", SearchOption.AllDirectories).Count()
                    : 0;

                _pending.Clear();

                if (Directory.Exists(_rootDir))
                    Directory.Delete(_rootDir, recursive: true);

                Directory.CreateDirectory(_rootDir);
                _knownDirs.Clear();

                return files;
            }

            Flush();

            var changedLines = 0;

            if (!Directory.Exists(_rootDir))
                return 0;

            foreach (var file in Directory
                .EnumerateFiles(_rootDir, "*.jsonl", SearchOption.AllDirectories)
                .ToList())
            {
                var kept = new List<string>();
                var changedHere = 0;

                foreach (var line in File.ReadLines(file))
                {
                    if (string.IsNullOrWhiteSpace(line))
                        continue;

                    try
                    {
                        if (JsonNode.Parse(line) is JsonObject obj)
                        {
                            var removedAny = false;

                            foreach (var field in fields)
                                removedAny |= obj.Remove(field);

                            if (removedAny)
                            {
                                changedHere++;

                                if (obj.Count > 1)
                                    kept.Add(obj.ToJsonString());

                                continue;
                            }
                        }
                    }
                    catch (JsonException)
                    {
                        // Preserve malformed lines during selective reset.
                    }

                    kept.Add(line);
                }

                if (changedHere == 0)
                    continue;

                changedLines += changedHere;

                if (kept.Count == 0)
                {
                    File.Delete(file);
                    continue;
                }

                var tempFile = file + ".tmp";
                File.WriteAllLines(tempFile, kept);
                File.Move(tempFile, file, overwrite: true);
            }

            RemoveEmptyFolders(_rootDir);
            _knownDirs.Clear();

            return changedLines;
        }
    }

    private static void RemoveEmptyFolders(string root)
    {
        if (!Directory.Exists(root))
            return;

        foreach (var yearDir in Directory.EnumerateDirectories(root).ToList())
        {
            foreach (var monthDir in Directory.EnumerateDirectories(yearDir).ToList())
            {
                if (!Directory.EnumerateFileSystemEntries(monthDir).Any())
                    TryDeleteFolder(monthDir);
            }

            if (!Directory.EnumerateFileSystemEntries(yearDir).Any())
                TryDeleteFolder(yearDir);
        }
    }

    private static void TryDeleteFolder(string dir)
    {
        try
        {
            Directory.Delete(dir);
        }
        catch (Exception ex) when (
            ex is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine(
                $"[LocalJsonSnapshotStore] could not remove empty folder {dir}: {ex.Message}");
        }
    }

    /// <summary>
    /// The "timestamp" of one saved line. The whole line is still checked to be valid JSON (a half-written line is rejected, as
    /// before), but it is read as a token stream instead of being built into a document first: this runs for every line of every
    /// day that is queried. Throws the same exceptions a bad line always caused: JsonException (not valid JSON),
    /// InvalidOperationException (not an object, or the timestamp is not a string), KeyNotFoundException (no timestamp) and
    /// FormatException (not a date).
    /// </summary>
    internal static DateTime ReadTimestamp(string line)
    {
        var max = Encoding.UTF8.GetMaxByteCount(line.Length);
        byte[]? rented = null;
        Span<byte> buffer = max <= 512 ? stackalloc byte[512] : (rented = System.Buffers.ArrayPool<byte>.Shared.Rent(max));
        try
        {
            var length = Encoding.UTF8.GetBytes(line, buffer);
            var reader = new Utf8JsonReader(buffer[..length]);
            if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject)
                throw new InvalidOperationException("A snapshot line must be a JSON object.");

            DateTime? timestamp = null;
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.PropertyName && reader.CurrentDepth == 1)
                {
                    var isTimestamp = reader.ValueTextEquals("timestamp"u8);
                    reader.Read();
                    if (isTimestamp) timestamp ??= reader.GetDateTime();
                    else reader.Skip();
                }
            }
            return timestamp ?? throw new KeyNotFoundException("timestamp");
        }
        finally
        {
            if (rented is not null) System.Buffers.ArrayPool<byte>.Shared.Return(rented);
        }
    }

    public Task<IReadOnlyList<SystemSnapshot>> QueryAsync(
        DateTime from,
        DateTime to,
        CancellationToken cancellationToken = default)
    {
        Flush();

        var results = new List<SystemSnapshot>();

        if (to < from)
            return Task.FromResult<IReadOnlyList<SystemSnapshot>>(results);

        foreach (var file in FilesInRange(from, to, cancellationToken))
        {
            foreach (var line in File.ReadLines(file))
            {
                cancellationToken.ThrowIfCancellationRequested();

                if (string.IsNullOrWhiteSpace(line))
                    continue;

                DateTime timestamp;

                try
                {
                    timestamp = ReadTimestamp(line);
                }
                catch (Exception ex) when (
                    ex is JsonException or InvalidOperationException or
                    KeyNotFoundException or FormatException)
                {
                    Console.Error.WriteLine(
                        $"[LocalJsonSnapshotStore] skipping malformed line in {file}: {ex.Message}");
                    continue;
                }

                if (timestamp >= from && timestamp <= to)
                    results.Add(new SystemSnapshot(timestamp, line));
            }
        }

        return Task.FromResult<IReadOnlyList<SystemSnapshot>>(results);
    }

    /// <summary>The day files that can hold lines of [from, to], oldest day first (nothing when the range is empty or no day file exists).</summary>
    private IEnumerable<string> FilesInRange(DateTime from, DateTime to, CancellationToken cancellationToken)
    {
        if (to < from)
            yield break;

        var earliest = EarliestDataDate();

        var start = earliest is null
            ? to.Date
            : from.Date < earliest.Value
                ? earliest.Value
                : from.Date;

        foreach (var date in EachDate(start, to.Date))
        {
            cancellationToken.ThrowIfCancellationRequested();

            var file = FileFor(date);

            if (File.Exists(file))
                yield return file;
        }
    }

    public IEnumerable<byte[]> ReadFilesInRange(DateTime from, DateTime to, CancellationToken cancellationToken = default)
    {
        Flush();

        foreach (var file in FilesInRange(from, to, cancellationToken))
            yield return File.ReadAllBytes(file);
    }

    private DateTime? EarliestDataDate()
    {
        try
        {
            foreach (var yearDir in Directory
                .EnumerateDirectories(_rootDir)
                .OrderBy(d => d, StringComparer.Ordinal))
            {
                if (!int.TryParse(Path.GetFileName(yearDir), out var year))
                    continue;

                foreach (var monthDir in Directory
                    .EnumerateDirectories(yearDir)
                    .OrderBy(d => d, StringComparer.Ordinal))
                {
                    if (!int.TryParse(Path.GetFileName(monthDir), out var month))
                        continue;

                    foreach (var file in Directory
                        .EnumerateFiles(monthDir, "*.jsonl")
                        .OrderBy(f => f, StringComparer.Ordinal))
                    {
                        if (!int.TryParse(
                            Path.GetFileNameWithoutExtension(file), out var day))
                        {
                            continue;
                        }

                        try
                        {
                            return new DateTime(
                                year, month, day, 0, 0, 0, DateTimeKind.Utc);
                        }
                        catch (ArgumentOutOfRangeException)
                        {
                            // Ignore invalid date-based filenames.
                        }
                    }
                }
            }
        }
        catch (DirectoryNotFoundException)
        {
            // No snapshot directory yet.
        }

        return null;
    }

    private static IEnumerable<DateTime> EachDate(DateTime from, DateTime to)
    {
        for (var date = from; date <= to; date = date.AddDays(1))
            yield return date;
    }
}
