namespace SystemMonitor.Api.Interface;

/// <summary>
/// A store that can hand out the raw text of its day files, so the native reader can parse them directly. The files returned
/// are exactly the ones <see cref="ISnapshotStore.QueryAsync"/> would read for the same range (anything still buffered is
/// written first); the lines in them are not filtered or parsed here.
/// </summary>
public interface IRawSnapshotFiles
{
    /// <summary>One byte array per existing day file that can hold lines of [from, to], oldest day first. Read one at a time as the sequence is consumed.</summary>
    IEnumerable<byte[]> ReadFilesInRange(DateTime from, DateTime to, CancellationToken cancellationToken = default);
}
