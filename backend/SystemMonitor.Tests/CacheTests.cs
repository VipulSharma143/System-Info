using Microsoft.Extensions.Logging.Abstractions;
using SystemMonitor.Api.Services;

// SystemInfoCache must only ever speed things up: every failure is a miss, never an exception.
static class CacheTests
{
    sealed record Sample(string Name, int Value);

    public static async Task<(int Failures, int Checks)> RunAsync()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }

        var root = Path.Combine(Path.GetTempPath(), "sysinfo-cache-" + Guid.NewGuid().ToString("N"));
        var dir = Path.Combine(root, "cache");
        SystemInfoCache New(string d = "") => new(d.Length > 0 ? d : dir, NullLogger<SystemInfoCache>.Instance);

        try
        {
            Check(await New().ReadAsync<Sample>("a") is null, "missing directory and file is a miss");
            Check(Directory.Exists(dir), "the cache directory is created on first use");

            await New().WriteAsync("a", new Sample("x", 1));
            Check(await New().ReadAsync<Sample>("a") is { Value: 1 }, "written value is read back by a new instance (next launch)");
            Check(await New().ReadAsync<Sample>("a", s => s.Value == 2) is null, "a value rejected by the validator is a miss");

            File.WriteAllText(Path.Combine(dir, "a.json"), "{ not json");
            Check(await New().ReadAsync<Sample>("a") is null, "corrupt file is a miss, not an exception");
            Check(!File.Exists(Path.Combine(dir, "a.json")), "corrupt file is removed so it is rebuilt");

            await New().WriteAsync("a", new Sample("x", 3));
            Directory.Delete(dir, true);
            Check(await New().ReadAsync<Sample>("a") is null, "deleted directory is a miss");
            await New().WriteAsync("a", new Sample("x", 4));
            Check(await New().ReadAsync<Sample>("a") is { Value: 4 }, "directory and file are recreated after deletion");

            var running = New();
            await running.WriteAsync("b", new Sample("y", 5));
            Directory.Delete(dir, true);
            await running.WriteAsync("b", new Sample("y", 6));
            Check(await New().ReadAsync<Sample>("b") is { Value: 6 }, "a directory deleted while running is recreated on the next write");

            // A different app version / schema / machine must never see old data.
            File.WriteAllText(Path.Combine(dir, ".version"), "0|0.0.0|other");
            Check(await New().ReadAsync<Sample>("b") is null, "marker mismatch discards cached data");
            Check(Directory.GetFiles(dir).Length == 1, "only the new marker remains after invalidation");

            // Concurrent first use with stale data: nothing written after the sweep may be deleted by it.
            File.WriteAllText(Path.Combine(dir, ".version"), "0|0.0.0|other");
            var shared = New();
            await Task.WhenAll(Enumerable.Range(0, 8).Select(i => shared.WriteAsync("c" + i, new Sample("z", i))));
            Check(Enumerable.Range(0, 8).All(i => File.Exists(Path.Combine(dir, $"c{i}.json"))), "concurrent writes survive the version sweep");
            // Many writers to ONE file at once: each write is whole (never torn), the last one wins, and no temp file is left.
            var hot = New();
            await Task.WhenAll(Enumerable.Range(0, 200).Select(i => hot.WriteAsync("hot", new Sample("hot", i))));
            var settled = await New().ReadAsync<Sample>("hot");
            Check(settled is { Value: >= 0 and < 200 }, "200 concurrent writes to one file leave a complete, readable value");
            Check(!Directory.EnumerateFiles(dir, "*.tmp").Any(), "no temporary files are left behind");

            // A path that cannot be a directory: never throws, always a miss.
            var blocked = Path.Combine(root, "blocked");
            File.WriteAllText(blocked, "");
            var broken = New(Path.Combine(blocked, "cache"));
            await broken.WriteAsync("a", new Sample("x", 1));
            Check(await broken.ReadAsync<Sample>("a") is null, "unusable location degrades to no cache, without throwing");
        }
        finally { try { Directory.Delete(root, true); } catch { } }

        return (failures, checks);
    }
}
