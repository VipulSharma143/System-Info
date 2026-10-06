using System.Reflection;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Small JSON cache for system information that is slow to collect and rarely changes. It only ever
/// speeds things up: every failure (no directory, no permission, corrupt file) is treated as a miss, and
/// the caller collects normally. A <c>.version</c> marker holds schema + app version + machine name; if it
/// does not match, every file in the directory is deleted before use, so data written by another version
/// (or another machine sharing the profile) is never read.
/// </summary>
public sealed class SystemInfoCache
{
    private const int Schema = 1;
    private const string MarkerFile = ".version";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static readonly string AppVersion =
        (typeof(SystemInfoCache).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
         ?? typeof(SystemInfoCache).Assembly.GetName().Version?.ToString() ?? "unknown").Split('+')[0];

    private readonly string _dir;
    private readonly ILogger<SystemInfoCache> _log;
    private readonly SemaphoreSlim _io = new(1, 1);
    private readonly object _readyGate = new();
    private Task<bool>? _ready;

    public SystemInfoCache(string directory, ILogger<SystemInfoCache> log)
    {
        _dir = directory;
        _log = log;
    }

    private static string Marker => $"{Schema}|{AppVersion}|{Environment.MachineName}";

    // Runs once (callers share the same task, so the version sweep can never race a concurrent write).
    // If a working directory disappears while the app is running, it is prepared again.
    private Task<bool> Ready()
    {
        lock (_readyGate)
        {
            if (_ready is { IsCompletedSuccessfully: true, Result: true } && !Directory.Exists(_dir)) _ready = null;
            return _ready ??= PrepareAsync();
        }
    }

    private async Task<bool> PrepareAsync()
    {
        try
        {
            Directory.CreateDirectory(_dir);
            var marker = Path.Combine(_dir, MarkerFile);

            string? current = null;
            try { current = (await File.ReadAllTextAsync(marker)).Trim(); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }

            if (current != Marker)
            {
                foreach (var file in Directory.EnumerateFiles(_dir)) TryDelete(file);
                await File.WriteAllTextAsync(marker, Marker);
            }
            return true;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Cache directory '{Dir}' is unusable; continuing without a cache.", _dir);
            return false;
        }
    }

    /// <summary>Null on any miss: absent, unreadable, corrupt (the file is then removed) or rejected by <paramref name="isValid"/>.</summary>
    public async Task<T?> ReadAsync<T>(string name, Func<T, bool>? isValid = null) where T : class
    {
        var path = PathOf(name);
        try
        {
            if (!await Ready()) return null;

            await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, useAsync: true);
            var value = await JsonSerializer.DeserializeAsync<T>(stream, Json);
            if (value is not null && (isValid is null || isValid(value))) return value;
        }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
        {
            return null;
        }
        catch (Exception ex) when (ex is JsonException or IOException or UnauthorizedAccessException or NotSupportedException)
        {
            _log.LogWarning(ex, "Cache file '{Name}' is unreadable; it will be rebuilt.", name);
        }

        TryDelete(path);
        return null;
    }

    /// <summary>Atomic (temp file + rename) and never throws; a failed write only means a miss next launch.</summary>
    public async Task WriteAsync<T>(string name, T value) where T : class
    {
        try
        {
            if (!await Ready()) return;

            var bytes = JsonSerializer.SerializeToUtf8Bytes(value, Json);
            var path = PathOf(name);
            // Unique per write. A name derived from the thread id could be reused by a second writer on the same
            // pool thread, whose temp file the first writer's cleanup would then delete mid-write.
            var temp = $"{path}.{Guid.NewGuid():N}.tmp";

            await _io.WaitAsync();
            try
            {
                try
                {
                    await File.WriteAllBytesAsync(temp, bytes);
                    File.Move(temp, path, overwrite: true);
                }
                finally
                {
                    TryDelete(temp);   // inside the lock: nobody else can be using this name anyway, and it never outlives the write
                }
            }
            finally
            {
                _io.Release();
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not write cache file '{Name}'.", name);
        }
    }

    private string PathOf(string name) => Path.Combine(_dir, name + ".json");

    private static void TryDelete(string path)
    {
        try { File.Delete(path); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }
}
