using Microsoft.Extensions.Logging;

namespace SystemMonitor.Api.Services;

/// <summary>One CPU sampler for the whole app: concurrent callers share a sample taken at most once a second.</summary>
public sealed class CpuService
{
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(1);

    private readonly ICpuCollector _collector;
    private readonly ILogger<CpuService> _log;
    private readonly object _gate = new();
    private readonly SemaphoreSlim _read = new(1, 1);
    private CpuDetail? _latest;
    private long _latestAt;

    public CpuService(ICpuCollector collector, ILogger<CpuService> log)
    {
        _collector = collector;
        _log = log;
    }

    public async Task<CpuDetail> GetAsync()
    {
        if (TryFresh(out var fresh)) return fresh;

        await _read.WaitAsync();
        try
        {
            if (TryFresh(out fresh)) return fresh;

            var detail = await Task.Run(ReadSafely);
            lock (_gate)
            {
                _latest = detail;
                _latestAt = Environment.TickCount64;
            }
            return detail;
        }
        finally
        {
            _read.Release();
        }
    }

    private bool TryFresh(out CpuDetail detail)
    {
        lock (_gate)
        {
            detail = _latest!;
            return _latest is not null && Environment.TickCount64 - _latestAt < Ttl.TotalMilliseconds;
        }
    }

    private CpuDetail ReadSafely()
    {
        try
        {
            return _collector.Read();
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "CPU detail could not be read.");
            return new CpuDetail(null, [], null, null, null, null, null, null, null, null,
                "CPU details could not be read on this machine.", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        }
    }
}
