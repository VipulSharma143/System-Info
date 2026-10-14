using System.Buffers;
using System.Text;
using System.Text.Json;
using SystemMonitor.Api.Interface;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Serialises one sample into the snapshot line AnalyticsService reads and hands it to the
/// store. A failed write is reported on stderr and never reaches the sampling loop.
/// </summary>
public static class SnapshotLogger
{
    private static ISnapshotStore? _store;
    private static BatteryHistoryService? _battery;

    // One line is written per second, so the buffer and the writer are reused instead of building a JSON tree each time.
    // Per thread, so concurrent callers never share them.
    [ThreadStatic] private static ArrayBufferWriter<byte>? t_buffer;
    [ThreadStatic] private static Utf8JsonWriter? t_writer;

    public static void Initialize(ISnapshotStore store, BatteryHistoryService? battery = null)
    {
        _store = store;
        _battery = battery;
    }

    /// <param name="battery">The current battery reading, or null when there is none (a desktop, or readings stopped). It always feeds the charging history.</param>
    /// <param name="writeBatteryField">Whether this line also carries the battery. The sampler reads the battery every few seconds, so it asks for the field only on the line that follows a new reading instead of repeating the same values every second.</param>
    public static void Append(CpuInfo? cpu, List<NetworkInfo>? network, BatteryInfo? battery = null, bool writeBatteryField = true)
    {
        if (_store is null) return;

        try
        {
            var timestamp = DateTime.UtcNow;
            _battery?.Observe(battery);   // plug-in / unplug sessions (the service uses its own clock, which is the same UTC clock in production)

            var buffer = t_buffer ??= new ArrayBufferWriter<byte>(512);
            buffer.Clear();
            var writer = t_writer;
            if (writer is null) t_writer = writer = new Utf8JsonWriter(buffer);
            else writer.Reset(buffer);

            // Same fields, same order and same formatting as before, so stored history and its readers are unaffected.
            writer.WriteStartObject();
            writer.WriteString("timestamp", timestamp.ToString("o"));
            writer.WriteNumber("cpuUsedPercent", cpu?.UsedPercent ?? 0);
            writer.WriteStartArray("network");
            if (network is not null)
            {
                foreach (var n in network)
                {
                    writer.WriteStartObject();
                    writer.WriteString("iface", n.Iface);
                    writer.WriteNumber("rxKBps", n.RxKBps);
                    writer.WriteNumber("txKBps", n.TxKBps);
                    writer.WriteEndObject();
                }
            }
            writer.WriteEndArray();

            // Desktops without a battery omit the field rather than store placeholders.
            if (writeBatteryField && battery is { Available: true })
            {
                writer.WriteStartObject("battery");
                writer.WriteString("status", battery.Status ?? "unknown");
                writer.WriteNumber("capacityPercent", battery.CapacityPercent ?? -1);
                writer.WriteNumber("healthPercent", battery.HealthPercent ?? -1);
                writer.WriteNumber("powerWatts", battery.PowerWatts ?? -1);
                writer.WriteEndObject();
            }
            writer.WriteEndObject();
            writer.Flush();

            // The store buffers in memory and completes synchronously.
            _store.AppendAsync(new SystemSnapshot(timestamp, Encoding.UTF8.GetString(buffer.WrittenSpan))).GetAwaiter().GetResult();
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
