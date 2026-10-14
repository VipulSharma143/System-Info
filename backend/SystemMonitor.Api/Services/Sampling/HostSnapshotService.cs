using SystemMonitor.Api.Native;

namespace SystemMonitor.Api.Services;

/// <summary>
/// The one place the backend asks the native engine for live host metrics (CPU ticks, memory, CPU temperature).
/// Callers that need "recent" data share a reading younger than the age they accept instead of each hitting the
/// kernel; a caller that needs a fresh sample (a CPU delta) passes <see cref="TimeSpan.Zero"/>. If the native
/// library is missing or a read fails, <see cref="Read"/> returns null and the caller uses its managed fallback.
/// </summary>
public sealed class HostSnapshotService
{
    private readonly Func<HostSnapshot?> _read;
    private readonly Func<long> _nowMs;
    private readonly object _gate = new();
    private HostSnapshot? _latest;
    private long _latestAt = long.MinValue;
    private long _reads;

    public HostSnapshotService() : this(NativeHost.Read, () => Environment.TickCount64) { }

    public HostSnapshotService(Func<HostSnapshot?> read, Func<long> nowMs)
    {
        _read = read;
        _nowMs = nowMs;
    }

    /// <summary>How many times the native engine was actually asked (tests and diagnostics).</summary>
    public long NativeReads => Interlocked.Read(ref _reads);

    public HostSnapshot? Read(TimeSpan maxAge)
    {
        lock (_gate)
        {
            var now = _nowMs();
            if (_latest is not null && maxAge > TimeSpan.Zero && now - _latestAt < maxAge.TotalMilliseconds) return _latest;

            Interlocked.Increment(ref _reads);
            var fresh = _read();
            if (fresh is null)
            {
                _latest = null;   // never serve an old value as if the failed read had succeeded
                return null;
            }
            _latest = fresh;
            _latestAt = now;
            return fresh;
        }
    }
}
