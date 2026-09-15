namespace SystemMonitor.Api.Interface;

// One row of historical data. Json is a single pre-serialized snapshot line
// (the same shape the Python analytics service already parses) — kept as a
// raw string rather than a typed model since the snapshot schema is owned by
// SnapshotLogger and consumed opaquely by storage.
public record SystemSnapshot(DateTime TimestampUtc, string Json);

// Storage boundary for historical snapshots. The background service depends
// on this, not on any specific storage technology (previously MongoClient,
// now LocalJsonSnapshotStore) — a future SQLite implementation could replace
// LocalJsonSnapshotStore without touching anything above this interface.
public interface ISnapshotStore
{
    Task AppendAsync(SystemSnapshot snapshot);

    Task<IReadOnlyList<SystemSnapshot>> QueryAsync(
        DateTime from,
        DateTime to,
        CancellationToken cancellationToken = default);
}
