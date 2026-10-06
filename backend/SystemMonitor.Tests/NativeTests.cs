using System.Runtime.InteropServices;
using SystemMonitor.Api.Native;

// Non-async on purpose: Span<T> locals are not allowed in async methods.
static class NativeTests
{
    /// <summary>Path of the native library the tests loaded, or null when it could not be found. Other test files use it to skip native contract checks.</summary>
    public static string? LoadedLibrary { get; private set; }

    public static (int Failures, int Checks) Run()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }
        void Near(double? actual, double expected, double tol, string what) =>
            Check(actual is { } a && Math.Abs(a - expected) <= tol, $"{what} (expected {expected}, got {actual?.ToString() ?? "null"})");

        // =====================================================================
        // Native kernels through the managed wrappers, vs plain C# references.
        // Needs the built native library: set SYSTEMINFO_NATIVE_DIR, or build it
        // under native/build*/. Skipped (loudly) if it cannot be found; CI builds it first.
        // =====================================================================
        static string? FindLibrary(string dir) =>
            !Directory.Exists(dir) ? null : Directory.EnumerateFiles(dir, "*systemmonitor_native*", SearchOption.AllDirectories)
                .FirstOrDefault(f => f.EndsWith(".so") || f.EndsWith(".dll") || f.EndsWith(".dylib"));   // not the .lib/.a import/static libs

        string? libraryPath = null;
        var configured = Environment.GetEnvironmentVariable("SYSTEMINFO_NATIVE_DIR");
        if (configured is not null) libraryPath = FindLibrary(configured);
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null && libraryPath is null; d = d.Parent)
            foreach (var n in d.EnumerateDirectories("native"))
                foreach (var b in n.EnumerateDirectories("build*"))
                    libraryPath ??= FindLibrary(b.FullName);
        LoadedLibrary = libraryPath;
        if (libraryPath is null)
        {
            Console.WriteLine("SKIPPED native tests: native library not found (build native/ or set SYSTEMINFO_NATIVE_DIR).");
            if (Environment.GetEnvironmentVariable("CI") == "true") { Console.WriteLine("FAIL: native library must exist in CI"); failures++; }
        }
        else
        {
            NativeLibrary.SetDllImportResolver(typeof(NativeInterop).Assembly, (name, asm, path) =>
            name == "systemmonitor_native" ? NativeLibrary.Load(libraryPath) : IntPtr.Zero);

        var rng = new Random(20260929);
            int[] ints = Enumerable.Range(0, 5000).Select(_ => rng.Next(int.MinValue, int.MaxValue)).ToArray();
            float[] fa = Enumerable.Range(0, 5000).Select(_ => (float)(rng.Next(-1000, 1000) / 8.0)).ToArray();
            float[] fb = Enumerable.Range(0, 5000).Select(_ => (float)(rng.Next(-1000, 1000) / 8.0)).ToArray();
            ulong[] words = Enumerable.Range(0, 5000).Select(_ => (ulong)rng.NextInt64() ^ ((ulong)rng.NextInt64() << 1)).ToArray();

            foreach (int off in new[] { 0, 1, 2, 3 })              // slice offsets => unaligned starts
                foreach (int n in new[] { 0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 33, 100, 1000, 4000 })
                {
                    var i = ints.AsSpan(off, n);
                    Check(NativeKernels.SumInt32(i) == NativeKernels.Reference.SumInt32(i), $"sum n={n} off={off}");
                    Check(NativeKernels.MinMax(i) == NativeKernels.Reference.MinMax(i), $"minmax n={n} off={off}");
                    Near(NativeKernels.Dot(fa.AsSpan(off, n), fb.AsSpan(off, n)), NativeKernels.Reference.Dot(fa.AsSpan(off, n), fb.AsSpan(off, n)), 1e-3 * (1 + n), $"dot n={n} off={off}");
                    Check(NativeKernels.XorChecksum(words.AsSpan(off, n)) == NativeKernels.Reference.Xor(words.AsSpan(off, n)), $"xor n={n} off={off}");

                    var outv = new float[n + 2]; outv[n] = -1f; outv[n + 1] = -1f;
                    NativeKernels.Add(fa.AsSpan(off, n), fb.AsSpan(off, n), outv.AsSpan(0, n));
                    bool addOk = outv[n] == -1f && outv[n + 1] == -1f;               // nothing written past the end
                    for (int k = 0; k < n && addOk; k++) addOk = outv[k] == fa[off + k] + fb[off + k];
                    Check(addOk, $"add n={n} off={off}");

                    var src = Enumerable.Range(0, n).Select(k => (byte)(k * 7 + off)).ToArray();
                    var dst = new byte[n + 8]; Array.Fill(dst, (byte)0xAB);
                    NativeKernels.Copy(src, dst.AsSpan(4, n));
                    Check(dst.AsSpan(4, n).SequenceEqual(src) && dst[..4].All(b => b == 0xAB) && dst[(4 + n)..].All(b => b == 0xAB), $"copy n={n} off={off}");
                }

            Check(NativeKernels.MinMax(ReadOnlySpan<int>.Empty) is null, "minmax of empty is null, not (0,0)");
            Check(NativeKernels.SumInt32(new[] { int.MaxValue, int.MaxValue, int.MaxValue }) == 3L * int.MaxValue, "int32 sum accumulates in 64 bits");
            var ov = Enumerable.Range(0, 64).Select(k => (byte)k).ToArray();
            var expect = (byte[])ov.Clone(); Buffer.BlockCopy(ov, 0, expect, 5, 40);   // memmove semantics
            NativeKernels.Copy(ov.AsSpan(0, 40), ov.AsSpan(5, 40));
            Check(ov.SequenceEqual(expect), "overlapping managed copy behaves like memmove");
            bool threw = false; try { NativeKernels.Dot(new float[3], new float[4]); } catch (ArgumentException) { threw = true; }
            Check(threw, "dot rejects mismatched lengths instead of reading out of bounds");

            // ---- hardware enumeration: cross-checked against what .NET itself reports ----
            var topo = NativeHardware.GetCpuTopology();
            Check(topo is not null && topo.LogicalCores >= 1, "topology available");
            Check(topo is not null && (topo.PhysicalCores is null || (topo.PhysicalCores >= 1 && topo.PhysicalCores <= topo.LogicalCores)), "physical <= logical or unknown");
            Console.WriteLine($"info: topology physical={topo?.PhysicalCores?.ToString() ?? "unknown"} logical={topo?.LogicalCores} packages={topo?.Packages?.ToString() ?? "unknown"}");

            var vols = NativeHardware.GetStorageVolumes();
            Check(vols.All(v => v.TotalBytes > 0 && v.FreeBytes >= 0 && v.FreeBytes <= v.TotalBytes), "volume sizes sane");
            foreach (var v in vols.Take(3))
            {
                try
                {
                    var di = new DriveInfo(v.Mount);
                    Check(di.TotalSize == v.TotalBytes, $"{v.Mount}: native total {v.TotalBytes} == DriveInfo {di.TotalSize}");
                }
                catch (Exception ex) { Console.WriteLine($"info: could not cross-check {v.Mount}: {ex.Message}"); }
            }
            Console.WriteLine($"info: {vols.Count} volume(s): {string.Join(", ", vols.Select(v => $"{v.Mount} ({v.FileSystem}) {v.TotalBytes / 1_000_000_000} GB"))}");
            _ = NativeHardware.GetFans();     // may legitimately be empty; must simply not throw

            Check(NativeInterop.MemoryBandwidth(8 << 20, 2, out var cGB, out var rGB) == 1 && cGB > 0 && rGB > 0, "bandwidth benchmark returns positive rates");
        }


        return (failures, checks);
    }
}
