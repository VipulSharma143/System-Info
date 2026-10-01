using System.Runtime.InteropServices;
using System.Text;

namespace SystemMonitor.Api.Native;

public static class NativeInterop
{
    [DllImport("systemmonitor_native", EntryPoint = "add_numbers")]
    public static extern int AddNumbers(int a, int b);

    [DllImport("systemmonitor_native", EntryPoint = "get_cpu_info")]
    public static extern int GetCpuInfo(StringBuilder modelNameOut, int bufferSize);

    [DllImport("systemmonitor_native", EntryPoint = "get_cpu_usage_percent")]
    public static extern double GetCpuUsagePercentNative();

    [DllImport("systemmonitor_native", EntryPoint = "get_cpu_temperature")]
    public static extern double GetCpuTemperature();

    [DllImport("systemmonitor_native", EntryPoint = "get_gpu_vendor")]
    public static extern int GetGpuVendor();

    [DllImport("systemmonitor_native", EntryPoint = "get_amd_gpu_usage_percent")]
    public static extern double GetAmdGpuUsagePercent();

    [DllImport("systemmonitor_native", EntryPoint = "get_fan_rpm")]
    public static extern int GetFanRpm();

    [DllImport("systemmonitor_native", EntryPoint = "call_asm_constant")]
    public static extern int CallAsmConstant();

    [DllImport("systemmonitor_native", EntryPoint = "run_cpu_benchmark")]
    public static extern double RunCpuBenchmark(long iterations, out long resultOut);

    [DllImport("systemmonitor_native", EntryPoint = "run_simd_comparison")]
    public static extern void RunSimdComparison(long iterations, out double scalarOpsPerSec, out double simdOpsPerSec);

    [DllImport("systemmonitor_native", EntryPoint = "get_battery_info_json")]
    public static extern int GetBatteryInfoJson(StringBuilder bufferOut, int bufferSize);

    // VRAM via DXGI (DXGI_ADAPTER_DESC's SIZE_T fields — not subject to the
    // 32-bit truncation WMI's Win32_VideoController.AdapterRAM has for 4GB+
    // cards). Call with adapterIndex = 0, 1, 2, ... until the return value
    // is 0 (no such adapter); that's how the caller discovers adapter count.
    [DllImport("systemmonitor_native", EntryPoint = "get_gpu_vram_bytes")]
    public static extern int GetGpuVramBytes(
        int adapterIndex,
        StringBuilder nameOut,
        int nameBufferSize,
        out long dedicatedBytes,
        out long sharedSystemBytes);

    // ---- CPU features + Assembly kernels (native/src/simd_dispatch.cpp) ----
    // Every 64-bit quantity crosses the boundary as C# long (== C++ long long);
    // nothing here narrows to int. Feature bits mirror SI_FEAT_* in native_engine.h.
    public const long FeatSse = 1L << 0, FeatSse2 = 1L << 1, FeatSse3 = 1L << 2, FeatSsse3 = 1L << 3,
        FeatSse41 = 1L << 4, FeatSse42 = 1L << 5, FeatAvx = 1L << 6, FeatAvx2 = 1L << 7, FeatFma = 1L << 8;

    [DllImport("systemmonitor_native", EntryPoint = "si_get_cpu_features")]
    public static extern long GetCpuFeatures();

    [DllImport("systemmonitor_native", EntryPoint = "si_get_cpu_vendor")]
    public static extern int GetCpuVendor(StringBuilder vendorOut, int bufferSize);

    [DllImport("systemmonitor_native", EntryPoint = "si_active_isa")]
    public static extern int GetActiveIsa();

    [DllImport("systemmonitor_native", EntryPoint = "si_kernel_selftest")]
    public static extern int KernelSelfTest();

    [DllImport("systemmonitor_native", EntryPoint = "si_kernel_benchmark")]
    public static extern int KernelBenchmark(long elements, int repeats,
        out double addGBps, out double dotGBps, out double sumGBps);

    // ---- Assembly kernels behind the C++ dispatcher (span-friendly `ref` signatures; all blittable) ----
    [DllImport("systemmonitor_native", EntryPoint = "si_vec_add_f32")]
    internal static extern void VecAddF32(in float a, in float b, ref float output, long n);

    [DllImport("systemmonitor_native", EntryPoint = "si_dot_f32")]
    internal static extern float DotF32(in float a, in float b, long n);

    [DllImport("systemmonitor_native", EntryPoint = "si_sum_i32")]
    internal static extern long SumI32(in int a, long n);

    [DllImport("systemmonitor_native", EntryPoint = "si_minmax_i32")]
    internal static extern long MinMaxI32(in int a, long n, out int min, out int max);

    [DllImport("systemmonitor_native", EntryPoint = "si_memcpy")]
    internal static extern int MemCopy(ref byte dst, in byte src, long n);

    [DllImport("systemmonitor_native", EntryPoint = "si_xor_u64")]
    internal static extern ulong XorU64(in ulong a, long nwords);

    [DllImport("systemmonitor_native", EntryPoint = "si_memory_bandwidth")]
    public static extern int MemoryBandwidth(long bytes, int repeats, out double copyGBps, out double readGBps);

    // ---- topology / storage / fans (hardware_info.cpp). 64-bit byte counts stay `long`. ----
    [DllImport("systemmonitor_native", EntryPoint = "si_get_cpu_topology")]
    public static extern int GetCpuTopology(out int physicalCores, out int logicalCores, out int packages);

    [DllImport("systemmonitor_native", EntryPoint = "si_get_storage_volume")]
    public static extern int GetStorageVolume(int index, StringBuilder mountOut, int mountSize,
        StringBuilder fsOut, int fsSize, out long totalBytes, out long freeBytes);

    [DllImport("systemmonitor_native", EntryPoint = "si_get_fan")]
    public static extern int GetFan(int index, StringBuilder labelOut, int labelSize, out int rpm);
}
