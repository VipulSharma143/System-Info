using Microsoft.Extensions.Logging;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>
/// One source of truth for GPUs. Hardware is stable, so it is persisted and served from the previous launch
/// immediately while a fresh read runs in the background; live telemetry is sampled at most once a second
/// no matter how many callers ask.
/// </summary>
public sealed class GpuService
{
    private const string CacheName = "gpu-hardware";
    private static readonly TimeSpan LiveTtl = TimeSpan.FromSeconds(1);

    private readonly IGpuCollector _collector;
    private readonly SystemInfoCache _cache;
    private readonly ILogger<GpuService> _log;
    private readonly object _gate = new();
    private readonly SemaphoreSlim _hardwareRead = new(1, 1);
    private readonly SemaphoreSlim _liveRead = new(1, 1);

    private static readonly TimeSpan MissingTtl = TimeSpan.FromSeconds(30);

    private GpuHardwareInfo? _hardware;
    private long _hardwareAt;
    private GpuLiveInfo? _live;
    private long _liveAt;

    public GpuService(IGpuCollector collector, SystemInfoCache cache, ILogger<GpuService> log)
    {
        _collector = collector;
        _cache = cache;
        _log = log;
    }

    public async Task WarmUpAsync()
    {
        var seed = await _cache.ReadAsync<GpuHardwareInfo>(CacheName, h => h.Available && h.Adapters.Count > 0);
        if (seed is not null)
        {
            lock (_gate)
            {
                if (_hardware is null) { _hardware = seed; _hardwareAt = Environment.TickCount64; }
            }
        }
        await RefreshHardwareAsync();

        // Take the first load baseline now, so the first poll from the UI already has real numbers.
        var hardware = await GetHardwareAsync();
        await Task.Run(() => SampleSafely(hardware.Adapters));
    }

    public async ValueTask<GpuHardwareInfo> GetHardwareAsync()
    {
        lock (_gate)
        {
            if (_hardware is { } cached &&
                (cached.Available || Environment.TickCount64 - _hardwareAt < MissingTtl.TotalMilliseconds)) return cached;
        }
        return await RefreshHardwareAsync();
    }

    public async Task<GpuLiveInfo> GetLiveAsync()
    {
        lock (_gate)
        {
            if (_live is { } fresh && Environment.TickCount64 - _liveAt < LiveTtl.TotalMilliseconds) return fresh;
        }

        await _liveRead.WaitAsync();
        try
        {
            lock (_gate)
            {
                if (_live is { } fresh && Environment.TickCount64 - _liveAt < LiveTtl.TotalMilliseconds) return fresh;
            }

            var hardware = await GetHardwareAsync();
            var readings = await Task.Run(() => SampleSafely(hardware.Adapters));
            var live = new GpuLiveInfo(readings, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            lock (_gate)
            {
                _live = live;
                _liveAt = Environment.TickCount64;
            }
            return live;
        }
        finally
        {
            _liveRead.Release();
        }
    }

    private IReadOnlyList<GpuLiveReading> SampleSafely(IReadOnlyList<GpuAdapter> adapters)
    {
        if (adapters.Count == 0) return [];
        try
        {
            return _collector.ReadLive(adapters);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Live GPU readings failed.");
            return [];
        }
    }

    private async Task<GpuHardwareInfo> RefreshHardwareAsync()
    {
        await _hardwareRead.WaitAsync();
        try
        {
            var read = await Task.Run(ReadHardwareSafely);
            lock (_gate)
            {
                if (read.Available || _hardware is not { Available: true })
                {
                    _hardware = read;
                    _hardwareAt = Environment.TickCount64;
                }
            }

            if (read.Available) await _cache.WriteAsync(CacheName, read);
            lock (_gate) return _hardware!;
        }
        finally
        {
            _hardwareRead.Release();
        }
    }

    private GpuHardwareInfo ReadHardwareSafely()
    {
        try
        {
            var adapters = _collector.ReadHardware();
            return adapters.Count > 0
                ? new GpuHardwareInfo(true, adapters, null)
                : new GpuHardwareInfo(false, [], "No graphics adapter was detected.");
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "GPU hardware detection failed.");
            return new GpuHardwareInfo(false, [], "Graphics adapters could not be read on this machine.");
        }
    }
}
