// SnapshotLogger.cs
// Same public interface as before (Append(cpu, network)) — only the
// destination changed, from a JSONL file to a MongoDB Atlas collection
// (SystemMonitorDB.snapshots), matching the document shape already
// proven in test_mongo_insert.py.
//
// Reads the connection string from the MONGO_URI environment variable,
// same variable already set in ~/.bashrc and used by the Python side —
// one shared secret, not duplicated across languages.
//
// Graceful degradation preserved: a failed insert is logged to stderr
// and does not crash the background sampling loop.

using MongoDB.Bson;
using MongoDB.Driver;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

public static class SnapshotLogger
{
private static readonly IMongoCollection<BsonDocument>? Collection = InitCollection();

private static IMongoCollection<BsonDocument>? InitCollection()
    {
var uri = Environment.GetEnvironmentVariable("MONGO_URI");
if (string.IsNullOrWhiteSpace(uri))
        {
Console.Error.WriteLine("[SnapshotLogger] MONGO_URI not set — snapshot logging disabled.");
return null;
        }

try
        {
var client = new MongoClient(uri);
var db = client.GetDatabase("SystemMonitorDB");
return db.GetCollection<BsonDocument>("snapshots");
        }
catch (Exception ex)
        {
Console.Error.WriteLine($"[SnapshotLogger] failed to connect to Mongo: {ex.Message}");
return null;
        }
    }

    // battery is optional so any existing caller passing just (cpu, network)
    // still compiles — but the background service now always supplies it.
public static void Append(CpuInfo? cpu, List<NetworkInfo>? network, BatteryInfo? battery = null)
    {
if (Collection is null)
return;

try
        {
var networkArray = new BsonArray(
                (network ?? new List<NetworkInfo>()).Select(n => new BsonDocument
                {
                    { "iface", n.Iface },
                    { "rxKBps", n.RxKBps },
                    { "txKBps", n.TxKBps }
                })
            );

var doc = new BsonDocument
            {
                { "timestamp", DateTime.UtcNow },
                { "cpuUsedPercent", cpu?.UsedPercent ?? 0 },
                { "network", networkArray }
            };

            // Only written when a battery is actually present — desktops (or
            // Windows until that provider is implemented) simply omit the
            // field rather than storing fabricated/null placeholder values.
            if (battery is { Available: true })
            {
                doc["battery"] = new BsonDocument
                {
                    { "status", battery.Status ?? "unknown" },
                    { "capacityPercent", battery.CapacityPercent ?? -1 },
                    { "healthPercent", battery.HealthPercent ?? -1 },
                    { "powerWatts", battery.PowerWatts ?? -1 }
                };
            }

Collection.InsertOne(doc);
        }
catch (Exception ex)
        {
Console.Error.WriteLine($"[SnapshotLogger] failed to write snapshot: {ex.Message}");
        }
    }
}