using System.Text;
using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Native;

namespace SystemMonitor.Api.Services;

/// <summary>What is cached for the System page. <c>Boot</c> ties it to one boot, because last-boot time is part of it.</summary>
public sealed record StaticSystemInfo(string? CpuModel, SystemIdentity Identity, string Boot);

/// <summary>
/// Serves /api/system/info. The previous launch's data (if the cache has it for this version and boot) is
/// available immediately; one background collection then replaces it and rewrites the cache. On a cache
/// miss the first request simply waits for that same collection.
/// </summary>
public sealed class SystemInfoService
{
    private const string CacheName = "system-info";
    private const string GpuCacheName = "gpu-adapters";

    private readonly ISystemInfoProvider _provider;
    private readonly SystemInfoCache _cache;
    private readonly ILogger<SystemInfoService> _log;
    private readonly Lazy<Task> _warmUp;
    private readonly TaskCompletionSource _firstValue = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private volatile StaticSystemInfo? _current;

    public SystemInfoService(ISystemInfoProvider provider, SystemInfoCache cache, ILogger<SystemInfoService> log)
    {
        _provider = provider;
        _cache = cache;
        _log = log;
        _warmUp = new Lazy<Task>(() => Task.Run(LoadAndRefreshAsync));
    }

    public Task WarmUpAsync() => _warmUp.Value;

    public async Task<StaticSystemInfo> GetAsync()
    {
        _ = WarmUpAsync();
        await _firstValue.Task;
        return _current ?? Collect();   // warm-up failed: collect directly so the error surfaces as before
    }

    private async Task LoadAndRefreshAsync()
    {
        try
        {
            var boot = BootToken();
            var cached = await _cache.ReadAsync<StaticSystemInfo>(CacheName, c => c.Boot == boot && c.Identity is not null);
            if (cached is not null)
            {
                _current = cached;
                _firstValue.TrySetResult();
            }

            var fresh = Collect();
            _current = fresh;
            _firstValue.TrySetResult();
            await _cache.WriteAsync(CacheName, fresh);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "System information could not be collected.");
        }
        finally
        {
            _firstValue.TrySetResult();   // never leave a request waiting
        }

        await WarmGpuAdaptersAsync();
    }

    private StaticSystemInfo Collect()
    {
        string? cpuModel = null;
        try
        {
            var buffer = new StringBuilder(256);
            NativeInterop.GetCpuInfo(buffer, buffer.Capacity);
            cpuModel = buffer.ToString();
        }
        catch
        {
            // Native engine unavailable — report honestly rather than guessing.
        }

        return new StaticSystemInfo(
            string.IsNullOrWhiteSpace(cpuModel) ? null : cpuModel,
            _provider.GetSystemIdentity(),
            BootToken());
    }

    /// <summary>Uptime always reflects "now"; everything else is as collected.</summary>
    public static SystemIdentity WithLiveUptime(SystemIdentity identity) =>
        identity.LastBootTime is { } boot
            ? identity with { UptimeSeconds = Math.Max(0, (DateTime.Now - boot).TotalSeconds) }
            : identity;

    // Windows GPU adapters (WMI + DXGI) are the slowest static read there. Seed the provider from the last
    // launch so the first GPU poll is instant, then re-read and persist. Linux has no adapter list to cache.
    private async Task WarmGpuAdaptersAsync()
    {
        if (!OperatingSystem.IsWindows() || _provider is not WindowsSystemInfoProvider windows) return;
        try
        {
            var cached = await _cache.ReadAsync<List<GpuInfo>>(GpuCacheName, list => list.Count > 0);
            if (cached is not null) windows.SeedGpuAdapters(cached);

            var fresh = await Task.Run(windows.RefreshGpuAdapters);
            if (fresh is { Count: > 0 }) await _cache.WriteAsync(GpuCacheName, fresh);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "GPU adapter warm-up failed (non-fatal).");
        }
    }

    // Identifies the current boot without admin rights: the kernel's boot id on Linux, the boot time derived
    // from the tick counter (rounded to 5 minutes) elsewhere. A mismatch only costs a normal collection.
    private static string BootToken()
    {
        if (OperatingSystem.IsLinux())
        {
            try { return File.ReadAllText("/proc/sys/kernel/random/boot_id").Trim(); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }
        var bootSeconds = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - Environment.TickCount64 / 1000;
        return $"t{bootSeconds / 300}";
    }
}
