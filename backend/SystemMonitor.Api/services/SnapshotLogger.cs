
// Appends one JSON line per background-service sample to
// backend/SystemMonitor.Api/data/snapshots.jsonl
//
// Matches the real CpuInfo/NetworkInfo record shapes from
// backend/SystemMonitor.Api/interface/ISystemInfoProvider.cs:
//   public record CpuInfo(double UsedPercent);
//   public record NetworkInfo(string Iface, double RxKBps, double TxKBps);
//
// Does not touch RAM/processes/disks — those aren't sampled by the
// background loop (per SystemMonitorBackgroundService.cs), so logging
// them here would mean extra slow reads inside a loop that's currently
// fast specifically because it only does CPU+network. If you want
// RAM/disk/process history too, that's a separate decision, not a
// silent addition to this loop.
//
// Never throws — a logging failure must not kill the background loop,
// same principle as the existing catch-and-continue in ExecuteAsync.

using SystemMonitor.Api.Interface;
using System.Text.Json;

namespace SystemMonitor.Api.Services;

public static class SnapshotLogger
{
    private static readonly object _lock = new();

    private static readonly string LogPath = Path.Combine(
        AppContext.BaseDirectory, "..", "..", "..", "data", "snapshots.jsonl");
    // AppContext.BaseDirectory points at bin/Debug/net.../ when running via
    // `dotnet run`, so we walk back up to the project root (SystemMonitor.Api/)
    // with "..", "..", ".." — three levels: net.../ -> Debug/ -> bin/ -> project root.
    // If this ends up in the wrong place on your machine, just hardcode an
    // absolute path here instead; it's a dev-mode logging path, not a
    // deployment concern yet.

    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static void Append(CpuInfo? cpu, List<NetworkInfo>? network)
    {
        try
        {
            var fullPath = Path.GetFullPath(LogPath);
            var dir = Path.GetDirectoryName(fullPath)!;
            if (!Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            var record = new
            {
                timestamp = DateTimeOffset.UtcNow,
                cpuUsedPercent = cpu?.UsedPercent,
                network = network?.Select(n => new { n.Iface, n.RxKBps, n.TxKBps })
            };

            var line = JsonSerializer.Serialize(record, Options);

            lock (_lock)
            {
                File.AppendAllText(fullPath, line + Environment.NewLine);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[SnapshotLogger] failed to write snapshot: {ex.Message}");
        }
    }
}