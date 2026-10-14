using System.Text.Json.Serialization;

namespace SystemMonitor.Api.Services;

/// <summary>
/// One stretch of time on one power source. <c>charge</c> = the charger was connected (charging, full or holding), <c>discharge</c>
/// = running on the battery. Times are UTC. Percentages are what the battery reported; nothing is estimated.
/// </summary>
public sealed record BatterySession(
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("startUtc")] DateTime StartUtc,
    [property: JsonPropertyName("endUtc")] DateTime? EndUtc,
    [property: JsonPropertyName("startPercent")] int? StartPercent,
    [property: JsonPropertyName("endPercent")] int? EndPercent,
    [property: JsonPropertyName("durationSec")] double DurationSec,
    [property: JsonPropertyName("gapSec")] double GapSec,
    [property: JsonPropertyName("startExact")] bool StartExact,
    [property: JsonPropertyName("endExact")] bool EndExact,
    [property: JsonPropertyName("reachedFull")] bool ReachedFull,
    [property: JsonPropertyName("open")] bool Open);

/// <summary>What a tracker holds, for saving to disk and restoring after a restart.</summary>
public sealed record BatteryTrackerState(
    [property: JsonPropertyName("sessions")] List<BatterySession> Sessions,
    [property: JsonPropertyName("current")] BatterySession? Current,
    [property: JsonPropertyName("lastUtc")] DateTime? LastUtc,
    [property: JsonPropertyName("lastPercent")] int? LastPercent);

/// <summary>
/// Turns a stream of battery readings into plug-in / unplug sessions.
///   * A change of power source is only accepted after it has lasted <see cref="MinConfirmSec"/> seconds, so a charger that
///     flickers (USB-C renegotiation, a loose plug) does not create a string of tiny sessions. The session then starts at the
///     moment the change was first seen.
///   * When readings stop for longer than <see cref="GapThreshold"/> (the app was closed, or the PC slept or was off) the time
///     is recorded as a gap. If the power source is unchanged after the gap, the session simply continues and carries the gap
///     time. If it changed, the old session ends at the last reading before the gap (<c>EndExact = false</c>) and the new one
///     starts at the first reading after it (<c>StartExact = false</c>), because when the plug moved is unknown.
///   * The first session after the app starts watching has <c>StartExact = false</c> for the same reason.
/// Pure and clock-free: the caller supplies every timestamp.
/// </summary>
public sealed class BatteryTracker
{
    /// <summary>
    /// How long a change of power source must last to count. The battery is read every 10 s, so 15 s means two readings agree: a
    /// charger connected for half a minute is recorded, a contact that flickers for a few seconds is not.
    /// </summary>
    public const int MinConfirmSec = 15;
    public static readonly TimeSpan GapThreshold = TimeSpan.FromMinutes(5);
    public const string Charge = "charge";
    public const string Discharge = "discharge";

    private readonly List<BatterySession> _closed = [];
    private BatterySession? _current;
    private DateTime? _lastUtc;
    private int? _lastPercent;
    private bool? _pendingOnAc;
    private DateTime _pendingSince;
    private int? _pendingPercent;

    /// <summary>Maps a battery status string to a power source. False when the status says nothing useful ("Unknown").</summary>
    public static bool Classify(string? status, out bool onAc, out bool full)
    {
        onAc = false; full = false;
        var s = status?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(s)) return false;
        if (s.Contains("discharg")) return true;
        if (s.Contains("charg") || s == "full" || s.Contains("fully")) { onAc = true; full = s == "full" || s.Contains("fully"); return true; }
        return false;
    }

    /// <summary>Feeds one reading. Returns true when a session started or ended (the caller then saves).</summary>
    public bool Observe(DateTime utc, bool onAc, int? percent, bool full)
    {
        var kind = onAc ? Charge : Discharge;
        var changed = false;

        if (_current is null)
        {
            _current = Start(kind, utc, percent, exact: false);
            changed = true;
        }
        else if (_lastUtc is { } last && utc - last > GapThreshold)
        {
            _pendingOnAc = null;
            if (_current.Kind == kind)
            {
                _current = _current with { GapSec = _current.GapSec + (utc - last).TotalSeconds };
            }
            else
            {
                Close(last, _lastPercent, exact: false);
                _current = Start(kind, utc, percent, exact: false);
                changed = true;
            }
        }
        else if (_current.Kind == kind)
        {
            _pendingOnAc = null;   // a short change of source that reverted: ignore it
        }
        else
        {
            if (_pendingOnAc != onAc) { _pendingOnAc = onAc; _pendingSince = utc; _pendingPercent = percent; }
            if ((utc - _pendingSince).TotalSeconds >= MinConfirmSec)
            {
                Close(_pendingSince, _pendingPercent ?? percent, exact: true);
                _current = Start(kind, _pendingSince, _pendingPercent ?? percent, exact: true);
                _pendingOnAc = null;
                changed = true;
            }
        }

        // Only a reading from the current power source describes the current session.
        if (_current.Kind == kind)
        {
            _current = _current with
            {
                EndPercent = percent ?? _current.EndPercent,
                ReachedFull = _current.ReachedFull || (kind == Charge && (full || percent >= 100)),
            };
        }
        _lastUtc = utc;
        _lastPercent = percent ?? _lastPercent;
        return changed;
    }

    private static BatterySession Start(string kind, DateTime startUtc, int? percent, bool exact) =>
        new(kind, startUtc, null, percent, percent, 0, 0, exact, true, false, true);

    private void Close(DateTime endUtc, int? endPercent, bool exact)
    {
        var s = _current!;
        _closed.Add(s with
        {
            EndUtc = endUtc,
            EndPercent = endPercent ?? s.EndPercent,
            DurationSec = Math.Max(0, (endUtc - s.StartUtc).TotalSeconds),
            EndExact = exact,
            Open = false,
        });
        _current = null;
    }

    /// <summary>Drops closed sessions that ended before <paramref name="cutoffUtc"/>. Returns how many were removed.</summary>
    public int Prune(DateTime cutoffUtc) => _closed.RemoveAll(s => s.EndUtc is { } e && e < cutoffUtc);

    /// <summary>Every closed session plus the open one (newest last). The open session's duration runs to the latest reading.</summary>
    public List<BatterySession> Sessions()
    {
        var all = new List<BatterySession>(_closed);
        if (_current is { } c && _lastUtc is { } last)
            all.Add(c with { DurationSec = Math.Max(0, (last - c.StartUtc).TotalSeconds) });
        return all;
    }

    public BatteryTrackerState Save() => new([.. _closed], _current, _lastUtc, _lastPercent);

    public void Restore(BatteryTrackerState state)
    {
        _closed.Clear();
        _closed.AddRange(state.Sessions);
        _current = state.Current;
        _lastUtc = state.LastUtc;
        _lastPercent = state.LastPercent;
        _pendingOnAc = null;
    }

    public void Clear()
    {
        _closed.Clear();
        _current = null;
        _lastUtc = null;
        _lastPercent = null;
        _pendingOnAc = null;
    }
}
