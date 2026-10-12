using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Deletes saved history older than <see cref="DataRetention.Days"/> days: once shortly after start-up (not on the start-up path),
/// then every six hours while the app runs. The battery sessions apply the same limit themselves.
/// </summary>
public sealed class DataRetentionService : BackgroundService
{
    private static readonly TimeSpan FirstDelay = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan Every = TimeSpan.FromHours(6);

    private readonly ISnapshotStore _store;
    private readonly ILogger<DataRetentionService> _log;

    public DataRetentionService(ISnapshotStore store, ILogger<DataRetentionService> log)
    {
        _store = store;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(FirstDelay, stoppingToken);
            using var timer = new PeriodicTimer(Every);
            do
            {
                try
                {
                    var removed = _store.Prune(DateTime.UtcNow);
                    if (removed > 0) _log.LogInformation("Deleted {Count} saved day file(s) older than {Days} days.", removed, DataRetention.Days);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _log.LogWarning(ex, "Deleting old history failed; will try again later.");
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException)
        {
            // shutting down
        }
    }
}
