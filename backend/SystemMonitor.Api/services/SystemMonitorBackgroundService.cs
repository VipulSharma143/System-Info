using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

// Samples CPU and network in the background; endpoints read the cache
// instead of sampling on every request.
public class SystemMonitorBackgroundService : BackgroundService
{
private readonly ISystemInfoProvider _provider;
private readonly ILogger<SystemMonitorBackgroundService> _log;
private string? _lastError;

public CpuInfo? LatestCpu { get; private set; }
public List<NetworkInfo>? LatestNetwork { get; private set; }

private readonly object _lock = new();

public SystemMonitorBackgroundService(ISystemInfoProvider provider, ILogger<SystemMonitorBackgroundService> log)
    {
_provider = provider;
_log = log;
    }

protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
// Let .NET startup (JIT, Kestrel init) settle before sampling,
// so it isn't logged as system load.
await Task.Delay(3000, stoppingToken);

while (!stoppingToken.IsCancellationRequested)
        {
try
            {
var cpu = await _provider.GetCpuAsync();
var network = await _provider.GetNetworkAsync();

// Battery is a single-pass sync read (no delta sampling needed,
// same reasoning as GetDisks()) — not cached separately, just
// pulled fresh each loop so the local snapshot includes it.
var battery = _provider.GetBattery();

lock (_lock)
                {
LatestCpu = cpu;
LatestNetwork = network;
                }

SnapshotLogger.Append(cpu, network, battery);
            }
catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
break;
            }
catch (Exception ex)
            {
// Don't let a transient read failure kill the loop — but do not hide it
// either: log once per distinct error, and back off so a persistent
// failure cannot spin the CPU.
if (_lastError != ex.Message)
                {
_lastError = ex.Message;
_log.LogWarning(ex, "System sampling failed; will keep retrying.");
                }
try { await Task.Delay(2000, stoppingToken); } catch (OperationCanceledException) { break; }
            }
        }
    }

public CpuInfo? GetCachedCpu()
    {
lock (_lock) return LatestCpu;
    }

public List<NetworkInfo>? GetCachedNetwork()
    {
lock (_lock) return LatestNetwork;
    }
}