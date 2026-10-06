using System.Runtime.InteropServices;

namespace SystemMonitor.Api.Native;

/// <summary>Mirror of <c>SiHostSnapshot</c> in native/include/native_engine.h. The native side rejects a different <c>StructSize</c>.</summary>
[StructLayout(LayoutKind.Sequential)]
public struct SiHostSnapshot
{
    public uint StructSize;
    public uint ValidMask;
    public double CpuTemperatureC;
    public ulong CpuBusyTicks;
    public ulong CpuTotalTicks;
    public ulong MemTotalKb;
    public ulong MemAvailableKb;
    public ulong MemFreeKb;
    public ulong SwapTotalKb;
    public ulong SwapFreeKb;
    public ulong SampledUnixMs;
}

/// <summary>One immutable reading from the native engine. A field is only meaningful when its <c>Has…</c> flag is true.</summary>
public sealed record HostSnapshot(
    bool HasCpuTicks, ulong CpuBusyTicks, ulong CpuTotalTicks,
    bool HasMemory, ulong MemTotalKb, ulong MemAvailableKb, ulong MemFreeKb,
    bool HasSwap, ulong SwapTotalKb, ulong SwapFreeKb,
    bool HasCpuTemperature, double CpuTemperatureC,
    long SampledUnixMs)
{
    public const uint CpuTicksBit = 1u << 0, MemoryBit = 1u << 1, SwapBit = 1u << 2, CpuTempBit = 1u << 3;

    public static HostSnapshot FromNative(in SiHostSnapshot s) => new(
        (s.ValidMask & CpuTicksBit) != 0, s.CpuBusyTicks, s.CpuTotalTicks,
        (s.ValidMask & MemoryBit) != 0, s.MemTotalKb, s.MemAvailableKb, s.MemFreeKb,
        (s.ValidMask & SwapBit) != 0, s.SwapTotalKb, s.SwapFreeKb,
        (s.ValidMask & CpuTempBit) != 0, s.CpuTemperatureC,
        (long)s.SampledUnixMs);
}

public static class NativeHost
{
    /// <summary>One P/Invoke for CPU ticks, memory and CPU temperature. Null when the library or entry point is missing or reports nothing.</summary>
    public static HostSnapshot? Read()
    {
        try
        {
            var raw = new SiHostSnapshot { StructSize = (uint)Marshal.SizeOf<SiHostSnapshot>() };
            return NativeInterop.ReadHostSnapshot(ref raw) == 1 ? HostSnapshot.FromNative(raw) : null;
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException or BadImageFormatException)
        {
            return null;
        }
    }
}
