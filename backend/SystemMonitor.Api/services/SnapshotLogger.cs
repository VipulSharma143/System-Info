using System.Text.Json.Nodes;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Serialises one sample into the snapshot line AnalyticsService reads and hands it to the
/// store. A failed write is reported on stderr and never reaches the sampling loop.
/// </summary>
public static class SnapshotLogger
{
    private static ISnapshotStore? _store;

    public static void Initialize(ISnapshotStore store) => _store = store;

    public static void Append(CpuInfo? cpu, List<NetworkInfo>? network, BatteryInfo? battery = null)
    {
        if (_store is null) return;

        try
        {
            var timestamp = DateTime.UtcNow;

            var networkArray = new JsonArray();
            foreach (var n in network ?? [])
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
                ["timestamp"] = timestamp.ToString("o"),
                ["cpuUsedPercent"] = cpu?.UsedPercent ?? 0,
                ["network"] = networkArray
            };

            // Desktops without a battery omit the field rather than store placeholders.
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

            _store.AppendAsync(new SystemSnapshot(timestamp, obj.ToJsonString())).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[SnapshotLogger] failed to queue snapshot: {ex.Message}");
        }
    }

    public static void Flush()
    {
        try { _store?.Flush(); }
        catch (Exception ex) { Console.Error.WriteLine($"[SnapshotLogger] flush failed: {ex.Message}"); }
    }
}
