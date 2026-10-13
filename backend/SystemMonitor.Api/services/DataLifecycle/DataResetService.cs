using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

public sealed record DataResetRequest(
    [property: JsonPropertyName("categories")] List<string>? Categories,
    [property: JsonPropertyName("all")] bool All);

public sealed record DataResetResult(
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("cleared")] List<string> Cleared,
    [property: JsonPropertyName("failed")] List<string> Failed,
    [property: JsonPropertyName("message")] string Message);

/// <summary>
/// The "reset data" action behind the System page button, the one place saved history is deleted (it otherwise keeps growing). What each choice deletes (and nothing else is touched):
///   cpu      the saved CPU-usage history in the daily snapshot files
///   network  the saved network-speed history in the same files
///   battery  the saved battery history in those files, and the charge/discharge sessions file
///   gpu      the cached graphics-adapter details (the app stores no GPU readings over time)
///   cache    every other cached page of system information
///   all      all of the above, whole snapshot folder included
/// The PawnIO sensor-driver install marker and any file the app did not write are never deleted. The caller restarts the app
/// afterwards, so nothing in memory is left holding what was deleted.
/// </summary>
public sealed class DataResetService
{
    public static readonly string[] Categories = ["cpu", "gpu", "battery", "network", "cache"];
    private const string GpuCacheFile = "gpu-hardware.json";

    private readonly ISnapshotStore _store;
    private readonly BatteryHistoryService _battery;
    private readonly string _cacheDir;
    private readonly ILogger<DataResetService>? _log;

    public DataResetService(ISnapshotStore store, BatteryHistoryService battery, string dataDir, ILogger<DataResetService>? log = null)
    {
        _store = store;
        _battery = battery;
        _cacheDir = Path.Combine(dataDir, "cache");
        _log = log;
    }

    /// <summary>Null when the request is valid, otherwise the reason it is not.</summary>
    public static string? Validate(DataResetRequest? request)
    {
        if (request is null) return "No request body.";
        if (request.All) return null;
        if (request.Categories is not { Count: > 0 }) return "Choose at least one kind of data to delete.";
        var unknown = request.Categories.FirstOrDefault(c => !Categories.Contains(c, StringComparer.OrdinalIgnoreCase));
        return unknown is null ? null : $"Unknown data type '{unknown}'.";
    }

    public DataResetResult Reset(DataResetRequest request)
    {
        if (Validate(request) is { } problem) return new DataResetResult(false, [], [], problem);

        var chosen = request.All
            ? new HashSet<string>(Categories, StringComparer.OrdinalIgnoreCase)
            : new HashSet<string>(request.Categories!, StringComparer.OrdinalIgnoreCase);
        var cleared = new List<string>();
        var failed = new List<string>();

        void Run(string name, Action action)
        {
            try { action(); cleared.Add(name); }
            catch (Exception ex)
            {
                _log?.LogWarning(ex, "Reset of {What} failed.", name);
                failed.Add($"{name} ({ex.Message})");
            }
        }

        if (request.All)
        {
            Run("saved history", () => _store.ResetData(new HashSet<string>(), all: true));
        }
        else
        {
            var fields = new HashSet<string>();
            if (chosen.Contains("cpu")) fields.Add("cpuUsedPercent");
            if (chosen.Contains("network")) fields.Add("network");
            if (chosen.Contains("battery")) fields.Add("battery");
            if (fields.Count > 0) Run("saved history", () => _store.ResetData(fields, all: false));
        }

        if (chosen.Contains("battery")) Run("battery sessions", _battery.Reset);
        if (chosen.Contains("gpu")) Run("cached GPU details", () => DeleteCache(onlyGpu: true));
        if (chosen.Contains("cache")) Run("cached system information", () => DeleteCache(onlyGpu: false));

        var ok = failed.Count == 0;
        return new DataResetResult(ok, cleared, failed, ok
            ? "The selected data was deleted."
            : "Some data could not be deleted: " + string.Join("; ", failed));
    }

    private void DeleteCache(bool onlyGpu)
    {
        if (!Directory.Exists(_cacheDir)) return;
        foreach (var file in Directory.EnumerateFiles(_cacheDir).ToList())
        {
            var isGpu = string.Equals(Path.GetFileName(file), GpuCacheFile, StringComparison.OrdinalIgnoreCase);
            if (isGpu == onlyGpu) File.Delete(file);
        }
    }
}
