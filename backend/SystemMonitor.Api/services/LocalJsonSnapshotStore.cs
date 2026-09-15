using System.Text.Json;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

// Local append-only JSON Lines storage: data/snapshots/{yyyy}/{MM}/{dd}.jsonl
// Replaces MongoDB Atlas. No database, no network dependency, no account.
//
// Design notes (see engineering-spec §13-§26):
//  - One file per day keeps any single file small and keeps queries cheap —
//    only the days actually requested are opened, never the whole history.
//  - Append is a single lock + File.AppendAllText call. Snapshots are taken
//    roughly once a second by the background service, so contention is
//    negligible; a full async queue would be over-engineering for this load.
//  - A malformed/partial line (e.g. from a hard kill mid-write) is skipped
//    with a logged warning during QueryAsync, never thrown — one bad line
//    must not take down analytics for an entire day's history.
public class LocalJsonSnapshotStore : ISnapshotStore
{
    private readonly string _rootDir;
    private static readonly object WriteLock = new();

    public LocalJsonSnapshotStore(string dataDir)
    {
        _rootDir = Path.Combine(dataDir, "snapshots");
        Directory.CreateDirectory(_rootDir);
    }

    public Task AppendAsync(SystemSnapshot snapshot)
    {
        var day = snapshot.TimestampUtc;
        var dir = Path.Combine(_rootDir, day.Year.ToString("D4"), day.Month.ToString("D2"));
        Directory.CreateDirectory(dir);
        var file = Path.Combine(dir, $"{day.Day:D2}.jsonl");

        lock (WriteLock)
        {
            File.AppendAllText(file, snapshot.Json + Environment.NewLine);
        }

        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<SystemSnapshot>> QueryAsync(
        DateTime from, DateTime to, CancellationToken cancellationToken = default)
    {
        var results = new List<SystemSnapshot>();

        foreach (var date in EachDate(from.Date, to.Date))
        {
            cancellationToken.ThrowIfCancellationRequested();

            var file = Path.Combine(
                _rootDir, date.Year.ToString("D4"), date.Month.ToString("D2"), $"{date.Day:D2}.jsonl");
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

    private static IEnumerable<DateTime> EachDate(DateTime from, DateTime to)
    {
        for (var d = from; d <= to; d = d.AddDays(1))
        {
            yield return d;
        }
    }
}
