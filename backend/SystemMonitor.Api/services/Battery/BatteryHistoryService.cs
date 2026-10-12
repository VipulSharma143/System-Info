using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>What /api/battery/history returns.</summary>
public sealed record BatteryHistory(
    [property: JsonPropertyName("hasBattery")] bool HasBattery,
    [property: JsonPropertyName("retentionDays")] int RetentionDays,
    [property: JsonPropertyName("generatedAtUtc")] DateTime GeneratedAtUtc,
    [property: JsonPropertyName("sessions")] List<BatterySession> Sessions);

/// <summary>The file on disk: data/battery/sessions.json.</summary>
public sealed record BatteryHistoryFile(
    [property: JsonPropertyName("version")] int Version,
    [property: JsonPropertyName("savedAtUtc")] DateTime SavedAtUtc,
    [property: JsonPropertyName("hasBattery")] bool HasBattery,
    [property: JsonPropertyName("state")] BatteryTrackerState State);

/// <summary>
/// Records plug-in / unplug sessions from the battery readings the sampler already takes (see <see cref="BatteryTracker"/>) and
/// keeps them in a small local JSON file, newest 7 days only. Observe is called about once a second, so it only does work when
/// a session starts or ends, plus a save every few minutes so a restart does not lose the session in progress. A damaged file is
/// replaced, never trusted; a read or write problem is logged and never reaches the sampler.
/// </summary>
public sealed class BatteryHistoryService : IDisposable
{
    public const int RetentionDays = DataRetention.Days;
    private static readonly TimeSpan SaveEvery = TimeSpan.FromMinutes(5);
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true, DefaultIgnoreCondition = JsonIgnoreCondition.Never };

    private readonly string _path;
    private readonly ILogger<BatteryHistoryService>? _log;
    private readonly Func<DateTime> _utcNow;
    private readonly object _gate = new();
    private readonly BatteryTracker _tracker = new();
    private bool _hasBattery;
    private DateTime _lastSave;
    private bool _dirty;

    public BatteryHistoryService(string dataDir, ILogger<BatteryHistoryService>? log = null, Func<DateTime>? utcNow = null)
    {
        _path = Path.Combine(dataDir, "battery", "sessions.json");
        _log = log;
        _utcNow = utcNow ?? (() => DateTime.UtcNow);
        _lastSave = _utcNow();
        Load();
    }

    /// <summary>Called with every battery reading. A desktop (no battery) or an unreadable status is ignored.</summary>
    public void Observe(BatteryInfo? battery) => Observe(_utcNow(), battery);

    public void Observe(DateTime utc, BatteryInfo? battery)
    {
        if (battery is not { Available: true } || !BatteryTracker.Classify(battery.Status, out var onAc, out var full)) return;
        lock (_gate)
        {
            _hasBattery = true;
            var changed = _tracker.Observe(utc, onAc, battery.CapacityPercent is { } p ? Math.Clamp(p, 0, 100) : null, full);
            _dirty = true;
            if (changed || utc - _lastSave >= SaveEvery) Save(utc);
        }
    }

    public BatteryHistory Read()
    {
        lock (_gate)
        {
            var now = _utcNow();
            _tracker.Prune(now.Date.AddDays(-(RetentionDays - 1)));
            return new BatteryHistory(_hasBattery, RetentionDays, now, _tracker.Sessions());
        }
    }

    /// <summary>Forgets every session and deletes the file (the "reset data" action).</summary>
    public void Reset()
    {
        lock (_gate)
        {
            _tracker.Clear();
            _hasBattery = false;
            _dirty = false;
            try { if (File.Exists(_path)) File.Delete(_path); }
            catch (Exception ex) { _log?.LogWarning(ex, "Could not delete the battery history file."); throw; }
        }
    }

    public void Dispose()
    {
        lock (_gate) { if (_dirty) Save(_utcNow()); }
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_path)) return;
            var file = JsonSerializer.Deserialize<BatteryHistoryFile>(File.ReadAllText(_path));
            if (file?.State is null || file.Version != 1) { _log?.LogWarning("Battery history file has an unknown format; starting fresh."); return; }
            _tracker.Restore(file.State);
            _hasBattery = file.HasBattery;
            _tracker.Prune(_utcNow().Date.AddDays(-(RetentionDays - 1)));
        }
        catch (Exception ex)
        {
            _log?.LogWarning(ex, "Battery history file could not be read; starting fresh.");
            _tracker.Clear();
        }
    }

    // Caller holds _gate. Written to a temp file and moved, so a crash mid-write cannot leave half a file.
    private void Save(DateTime utc)
    {
        try
        {
            _tracker.Prune(utc.Date.AddDays(-(RetentionDays - 1)));
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            var tmp = _path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(new BatteryHistoryFile(1, utc, _hasBattery, _tracker.Save()), Json));
            File.Move(tmp, _path, overwrite: true);
            _lastSave = utc;
            _dirty = false;
        }
        catch (Exception ex)
        {
            _lastSave = utc;   // do not retry on every reading
            _log?.LogWarning(ex, "Could not save the battery history.");
        }
    }
}
