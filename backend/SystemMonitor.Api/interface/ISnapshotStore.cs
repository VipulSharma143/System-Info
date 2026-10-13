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

    /// <summary>
    /// The "reset data" action. Removes the named top-level fields (cpuUsedPercent, network, battery) from every stored line, or
    /// everything when <paramref name="all"/> is true, and discards anything still buffered so it cannot be written back.
    /// Returns the number of lines changed or files deleted.
    /// </summary>
    int ResetData(IReadOnlySet<string> fields, bool all) => 0;
}
