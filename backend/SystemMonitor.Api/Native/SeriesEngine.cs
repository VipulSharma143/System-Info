using System.Runtime.InteropServices;

namespace SystemMonitor.Api.Native;

/// <summary>
/// Managed façade over the native series engine (Assembly kernels in Engine/Assembly/analytics behind the C++ dispatcher):
/// statistics, trend slope and threshold scans over double series. Spans in, values out, no unsafe code. Every method is a
/// "Try": it returns false when the engine cannot be used (library or entry point missing, arguments the engine rejects),
/// and the caller then does the same work in plain C#. <see cref="Reference"/> holds those plain versions; the tests
/// compare the two.
/// </summary>
public static class SeriesEngine
{
    private static int _state;   // 0 = not probed, 1 = available, 2 = unavailable
    private static long _nativeCalls;
    private static long _managedCalls;

    /// <summary>Series shorter than this are cheaper to handle in C# than to marshal.</summary>
    public const int MinNativeLength = 256;

    /// <summary>Tests and field diagnostics can force the plain C# path.</summary>
    public static bool ForceManaged { get; set; }

    /// <summary>Whether the native engine answers (probed once).</summary>
    public static bool IsAvailable
    {
        get
        {
            if (_state == 0)
            {
                try
                {
                    ReadOnlySpan<double> probe = [1.0, 2.0];
                    _state = NativeInterop.SeriesStats(in MemoryMarshal.GetReference(probe), probe.Length, out var r) == 1 && r.Sum == 3.0 ? 1 : 2;
                }
                catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException or BadImageFormatException)
                {
                    _state = 2;
                }
            }
            return _state == 1;
        }
    }

    /// <summary>The native engine will be used for a series of this length.</summary>
    public static bool Accepts(int length) => length >= MinNativeLength && !ForceManaged && IsAvailable;

    /// <summary>Calls answered by the native engine / by plain C# since the process started (for the engine status page).</summary>
    public static (long Native, long Managed) Calls => (Interlocked.Read(ref _nativeCalls), Interlocked.Read(ref _managedCalls));

    /// <summary>Counts a series operation that ran in plain C# (too short for the engine, or the engine is unavailable).</summary>
    public static void CountManaged() => Interlocked.Increment(ref _managedCalls);

    private static void CountNative() => Interlocked.Increment(ref _nativeCalls);

    /// <summary>Sum, smallest and largest value. The values must not contain NaN.</summary>
    public static bool TryStats(ReadOnlySpan<double> values, out (double Sum, double Min, double Max) result)
    {
        result = default;
        if (!Accepts(values.Length)) return false;
        if (NativeInterop.SeriesStats(in MemoryMarshal.GetReference(values), values.Length, out var r) != 1) return false;
        result = (r.Sum, r.Min, r.Max);
        CountNative();
        return true;
    }

    /// <summary>Least-squares slope of y against x; <paramref name="slope"/> is null when there is none (fewer than two points, no spread in x).</summary>
    public static bool TrySlope(ReadOnlySpan<double> x, ReadOnlySpan<double> y, out double? slope)
    {
        slope = null;
        if (x.Length != y.Length || !Accepts(x.Length)) return false;
        slope = NativeInterop.SeriesSlope(in MemoryMarshal.GetReference(x), in MemoryMarshal.GetReference(y), x.Length, out var s) == 1 ? s : null;
        CountNative();
        return true;
    }

    /// <summary>Values at or above the threshold (a NaN never is).</summary>
    public static bool TryCountGe(ReadOnlySpan<double> values, double threshold, out int count)
    {
        count = 0;
        if (!Accepts(values.Length)) return false;
        count = (int)NativeInterop.SeriesCountGe(in MemoryMarshal.GetReference(values), values.Length, threshold);
        CountNative();
        return true;
    }

    /// <summary>Runs of at least <paramref name="minLength"/> consecutive values at or above the threshold (a NaN ends a run), as inclusive index ranges.</summary>
    public static bool TryFindRuns(ReadOnlySpan<double> values, double threshold, int minLength, out List<(int Start, int End)> runs)
    {
        runs = new List<(int, int)>();
        if (!Accepts(values.Length)) return false;
        var pairs = new long[2 * 64];
        var found = NativeInterop.SeriesFindRuns(in MemoryMarshal.GetReference(values), values.Length, threshold, minLength, ref pairs[0], pairs.Length / 2);
        if (found > pairs.Length / 2)
        {
            pairs = new long[2 * found];
            found = NativeInterop.SeriesFindRuns(in MemoryMarshal.GetReference(values), values.Length, threshold, minLength, ref pairs[0], found);
        }
        runs.Capacity = (int)found;
        for (var i = 0; i < found; i++) runs.Add(((int)pairs[2 * i], (int)pairs[2 * i + 1]));
        CountNative();
        return true;
    }

    /// <summary>Indexes (ascending) of values at or above the threshold whose skip flag is zero; <paramref name="skip"/> may be empty for "none skipped".</summary>
    public static bool TryCollectGe(ReadOnlySpan<double> values, double threshold, ReadOnlySpan<byte> skip, out List<int> indexes)
    {
        indexes = new List<int>();
        if (!Accepts(values.Length) || (!skip.IsEmpty && skip.Length != values.Length)) return false;
        var buffer = new long[256];
        var total = Collect(values, threshold, skip, buffer);
        if (total > buffer.Length)
        {
            buffer = new long[total];
            total = Collect(values, threshold, skip, buffer);
        }
        indexes.Capacity = (int)total;
        for (var i = 0; i < total; i++) indexes.Add((int)buffer[i]);
        CountNative();
        return true;
    }

    private static long Collect(ReadOnlySpan<double> values, double threshold, ReadOnlySpan<byte> skip, long[] buffer)
        => skip.IsEmpty
            ? NativeInterop.SeriesCollectGeNoSkip(in MemoryMarshal.GetReference(values), values.Length, threshold, IntPtr.Zero, ref buffer[0], buffer.Length)
            : NativeInterop.SeriesCollectGe(in MemoryMarshal.GetReference(values), values.Length, threshold, in MemoryMarshal.GetReference(skip), ref buffer[0], buffer.Length);

    /// <summary>The lines of one snapshot file as dense arrays (see <see cref="TryParseSnapshots"/>).</summary>
    public sealed class ParsedSnapshots
    {
        public int Rows;
        public long[] Ticks = [];          // UTC ticks per row
        public double[] Cpu = [];          // NaN = the line has no numeric cpuUsedPercent
        public int[] NetStart = [];        // row r owns entries [NetStart[r], NetStart[r + 1])
        public int[] NetIface = [];        // index into Names
        public double[] Rx = [];           // NaN = missing / not a number
        public double[] Tx = [];
        public string[] Names = [];
        public long Malformed;             // lines skipped because they were not complete, valid JSON snapshots
    }

    /// <summary>
    /// Reads one snapshot file (one JSON object per line) with the native reader: lines inside [fromTicks, toTicks] come back as
    /// dense arrays, malformed lines are counted. False means "read it the managed way": the engine is off or missing, or the file holds something the native reader does not handle exactly (it never guesses).
    /// </summary>
    public static bool TryParseSnapshots(byte[] file, long fromTicks, long toTicks, out ParsedSnapshots result)
    {
        result = new ParsedSnapshots();
        if (ForceManaged || !IsAvailable) return false;

        var span = file.AsSpan();
        var rowCap = span.Count((byte)'\n') + span.Count((byte)'\r') + 1;
        long netCap = (long)rowCap * 3 + 64, namesCap = 4096;

        var dataHandle = System.Runtime.InteropServices.GCHandle.Alloc(file, System.Runtime.InteropServices.GCHandleType.Pinned);
        try
        {
            for (var attempt = 0; attempt < 3; attempt++)
            {
                var r = new ParsedSnapshots
                {
                    Ticks = new long[rowCap], Cpu = new double[rowCap], NetStart = new int[rowCap + 1],
                    NetIface = new int[netCap], Rx = new double[netCap], Tx = new double[netCap],
                };
                var names = new byte[namesCap];
                var handles = new Array[] { r.Ticks, r.Cpu, r.NetStart, r.NetIface, r.Rx, r.Tx, names }
                    .Select(a => System.Runtime.InteropServices.GCHandle.Alloc(a, System.Runtime.InteropServices.GCHandleType.Pinned)).ToArray();
                try
                {
                    var batch = new NativeInterop.SiSeriesBatch
                    {
                        Ticks = handles[0].AddrOfPinnedObject(), Cpu = handles[1].AddrOfPinnedObject(), NetStart = handles[2].AddrOfPinnedObject(),
                        NetIface = handles[3].AddrOfPinnedObject(), Rx = handles[4].AddrOfPinnedObject(), Tx = handles[5].AddrOfPinnedObject(),
                        Names = handles[6].AddrOfPinnedObject(), RowCap = rowCap, NetCap = netCap, NamesCap = namesCap,
                    };
                    var rc = NativeInterop.SeriesParseLines(dataHandle.AddrOfPinnedObject(), file.Length, fromTicks, toTicks, ref batch);
                    if (rc == 0) return false;
                    if (rc < 0)
                    {
                        // a buffer was too small: the call reported what it needs
                        rowCap = (int)Math.Max(rowCap, batch.Rows);
                        netCap = Math.Max(netCap, batch.NetEntries) + 1;
                        namesCap = Math.Max(namesCap, batch.NamesBytes) + 1;
                        continue;
                    }

                    r.Rows = (int)batch.Rows;
                    r.Malformed = batch.Malformed;
                    var list = new List<string>((int)batch.NameCount);
                    var offset = 0;
                    for (var i = 0; i < batch.NameCount; i++)
                    {
                        var end = Array.IndexOf(names, (byte)0, offset);
                        list.Add(System.Text.Encoding.UTF8.GetString(names, offset, end - offset));
                        offset = end + 1;
                    }
                    r.Names = list.ToArray();
                    result = r;
                    CountNative();
                    return true;
                }
                finally
                {
                    foreach (var h in handles) h.Free();
                }
            }
            return false;
        }
        finally
        {
            dataHandle.Free();
        }
    }

    /// <summary>Plain C# versions of the same operations: the fallback, and what the tests compare the engine with.</summary>
    public static class Reference
    {
        public static (double Sum, double Min, double Max) Stats(ReadOnlySpan<double> values)
        {
            double sum = 0, min = values[0], max = values[0];
            foreach (var v in values) { sum += v; if (v < min) min = v; if (v > max) max = v; }
            return (sum, min, max);
        }

        public static int CountGe(ReadOnlySpan<double> values, double threshold)
        {
            var count = 0;
            foreach (var v in values) if (v >= threshold) count++;
            return count;
        }

        public static List<(int Start, int End)> FindRuns(ReadOnlySpan<double> values, double threshold, int minLength)
        {
            var runs = new List<(int, int)>();
            var start = -1;
            for (var i = 0; i < values.Length; i++)
            {
                var above = values[i] >= threshold;
                if (above && start < 0) start = i;
                else if (!above && start >= 0)
                {
                    if (i - start >= minLength) runs.Add((start, i - 1));
                    start = -1;
                }
            }
            if (start >= 0 && values.Length - start >= minLength) runs.Add((start, values.Length - 1));
            return runs;
        }

        public static List<int> CollectGe(ReadOnlySpan<double> values, double threshold, ReadOnlySpan<byte> skip)
        {
            var list = new List<int>();
            for (var i = 0; i < values.Length; i++)
                if (values[i] >= threshold && (skip.IsEmpty || skip[i] == 0)) list.Add(i);
            return list;
        }
    }
}
