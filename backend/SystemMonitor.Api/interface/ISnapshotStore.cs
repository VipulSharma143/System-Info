namespace SystemMonitor.Api.Interface;

/// <summary>One historical row; <c>Json</c> is a single pre-serialised snapshot line parsed by AnalyticsService.</summary>
public record SystemSnapshot(DateTime TimestampUtc, string Json);

/// <summary>Storage boundary for historical snapshots.</summary>
public interface ISnapshotStore
{
    /// <summary>Queues a snapshot. Implementations may buffer; <see cref="Flush"/> makes it durable.</summary>
    Task AppendAsync(SystemSnapshot snapshot);

    Task<IReadOnlyList<SystemSnapshot>> QueryAsync(
        DateTime from,
        DateTime to,
        CancellationToken cancellationToken = default);

    /// <summary>Writes anything still buffered. A no-op for unbuffered stores.</summary>
    void Flush() { }
}
