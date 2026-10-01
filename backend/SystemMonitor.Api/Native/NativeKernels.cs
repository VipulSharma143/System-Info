using System.Runtime.InteropServices;
using System.Text;

namespace SystemMonitor.Api.Native;

/// <summary>
/// Safe managed façade over the Assembly kernels (SSE2/AVX2, chosen at run time
/// by the native CPUID dispatcher). Spans in, values out: no unsafe code, no
/// pointers escape, lengths are validated here, and every call is bounded by
/// the span it was given. Each method has a plain-C# reference implementation
/// in <see cref="Reference"/> that the tests compare against.
/// </summary>
public static class NativeKernels
{
    public static long SumInt32(ReadOnlySpan<int> data)
        => data.IsEmpty ? 0 : NativeInterop.SumI32(in MemoryMarshal.GetReference(data), data.Length);

    public static (int Min, int Max)? MinMax(ReadOnlySpan<int> data)
    {
        if (data.IsEmpty) return null;
        return NativeInterop.MinMaxI32(in MemoryMarshal.GetReference(data), data.Length, out var min, out var max) == 1
            ? (min, max)
            : null;
    }

    public static float Dot(ReadOnlySpan<float> a, ReadOnlySpan<float> b)
    {
        if (a.Length != b.Length) throw new ArgumentException("Vectors must have the same length.", nameof(b));
        return a.IsEmpty ? 0f : NativeInterop.DotF32(in MemoryMarshal.GetReference(a), in MemoryMarshal.GetReference(b), a.Length);
    }

    public static void Add(ReadOnlySpan<float> a, ReadOnlySpan<float> b, Span<float> output)
    {
        if (a.Length != b.Length || output.Length < a.Length) throw new ArgumentException("Length mismatch.");
        if (a.IsEmpty) return;
        NativeInterop.VecAddF32(in MemoryMarshal.GetReference(a), in MemoryMarshal.GetReference(b), ref MemoryMarshal.GetReference(output), a.Length);
    }

    /// <summary>Copies src into the start of dst. Overlapping spans are handled correctly.</summary>
    public static void Copy(ReadOnlySpan<byte> src, Span<byte> dst)
    {
        if (dst.Length < src.Length) throw new ArgumentException("Destination is too small.", nameof(dst));
        if (src.IsEmpty) return;
        if (NativeInterop.MemCopy(ref MemoryMarshal.GetReference(dst), in MemoryMarshal.GetReference(src), src.Length) != 1)
            throw new InvalidOperationException("Native copy rejected its arguments.");
    }

    public static ulong XorChecksum(ReadOnlySpan<ulong> words)
        => words.IsEmpty ? 0UL : NativeInterop.XorU64(in MemoryMarshal.GetReference(words), words.Length);

    /// <summary>Plain C# versions used to verify the native results.</summary>
    public static class Reference
    {
        public static long SumInt32(ReadOnlySpan<int> d) { long s = 0; foreach (var v in d) s += v; return s; }
        public static (int, int)? MinMax(ReadOnlySpan<int> d)
        {
            if (d.IsEmpty) return null;
            int mn = d[0], mx = d[0];
            foreach (var v in d) { if (v < mn) mn = v; if (v > mx) mx = v; }
            return (mn, mx);
        }
        public static double Dot(ReadOnlySpan<float> a, ReadOnlySpan<float> b) { double s = 0; for (int i = 0; i < a.Length; i++) s += (double)a[i] * b[i]; return s; }
        public static ulong Xor(ReadOnlySpan<ulong> w) { ulong x = 0; foreach (var v in w) x ^= v; return x; }
    }
}

public sealed record StorageVolume(string Mount, string FileSystem, long TotalBytes, long FreeBytes);
public sealed record FanReading(string Label, int Rpm);
public sealed record CpuTopology(int? PhysicalCores, int LogicalCores, int? Packages);

/// <summary>Managed views over the native topology/storage/fan enumerators.</summary>
public static class NativeHardware
{
    public static CpuTopology? GetCpuTopology()
    {
        if (NativeInterop.GetCpuTopology(out var phys, out var logical, out var pkgs) != 1 || logical <= 0) return null;
        return new CpuTopology(phys > 0 ? phys : null, logical, pkgs > 0 ? pkgs : null);
    }

    public static List<StorageVolume> GetStorageVolumes()
    {
        var list = new List<StorageVolume>();
        for (int i = 0; i < 128; i++)        // bounded: a misbehaving native call can never loop us forever
        {
            var mount = new StringBuilder(512);
            var fs = new StringBuilder(64);
            if (NativeInterop.GetStorageVolume(i, mount, mount.Capacity, fs, fs.Capacity, out var total, out var free) != 1) break;
            list.Add(new StorageVolume(mount.ToString(), fs.ToString(), total, free));
        }
        return list;
    }

    public static List<FanReading> GetFans()
    {
        var list = new List<FanReading>();
        for (int i = 0; i < 64; i++)
        {
            var label = new StringBuilder(128);
            if (NativeInterop.GetFan(i, label, label.Capacity, out var rpm) != 1) break;
            list.Add(new FanReading(label.ToString(), rpm));
        }
        return list;
    }
}
