// SnapshotLogger.cs
// Same public interface as before (Append(cpu, network, battery)) — only the
// destination changed, from MongoDB Atlas to local JSONL files via
// ISnapshotStore (see LocalJsonSnapshotStore). MongoDB Atlas, MONGO_URI, and
// any external database are no longer required by this application.
//
// Graceful degradation preserved: a failed write is logged to stderr and
// does not crash the background sampling loop.

using System.Text.Json.Nodes;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

public static class SnapshotLogger
{
    // Set once at startup (see Program.cs) after the local data directory is
    // resolved and created. Kept as a static field so the existing static
    // Append(...) call sites in SystemMonitorBackgroundService don't need to
    // change to instance/DI-based calls.
    private static ISnapshotStore? _store;

    public static void Initialize(ISnapshotStore store)
    {
        _store = store;
    }

    // battery is optional so any existing caller passing just (cpu, network)
    // still compiles — but the background service always supplies it.
    public static void Append(CpuInfo? cpu, List<NetworkInfo>? network, BatteryInfo? battery = null)
    {
        if (_store is null)
        {
            Console.Error.WriteLine("[SnapshotLogger] store not initialized — snapshot logging disabled.");
            return;
        }

        try
        {
            var timestamp = DateTime.UtcNow;

            var networkArray = new JsonArray();
            foreach (var n in network ?? new List<NetworkInfo>())
            {
                networkArray.Add(new JsonObject
                {
                    ["iface"] = n.Iface,
                    ["rxKBps"] = n.RxKBps,
                    ["txKBps"] = n.TxKBps
                });
            }

            var obj = new JsonObject
            {
                // ISO-8601 UTC with a trailing "Z" — matches what the Python
                // analytics side already parses via fromisoformat().
                ["timestamp"] = timestamp.ToString("o"),
                ["cpuUsedPercent"] = cpu?.UsedPercent ?? 0,
                ["network"] = networkArray
            };

            // Only written when a battery is actually present — desktops
            // simply omit the field rather than storing fabricated/null
            // placeholder values.
            if (battery is { Available: true })
            {
                obj["battery"] = new JsonObject
                {
                    ["status"] = battery.Status ?? "unknown",
                    ["capacityPercent"] = battery.CapacityPercent ?? -1,
                    ["healthPercent"] = battery.HealthPercent ?? -1,
                    ["powerWatts"] = battery.PowerWatts ?? -1
                };
            }

            var json = obj.ToJsonString();

            // The background service's loop is not async-friendly here (Append
            // is called from a synchronous context), so we block on the write.
            // Local disk I/O for a single short line is fast enough that this
            // has never been the bottleneck (unlike the old network round-trip
            // to Atlas, which this replaces).
            _store.AppendAsync(new SystemSnapshot(timestamp, json)).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[SnapshotLogger] failed to write snapshot: {ex.Message}");
        }
    }
}
