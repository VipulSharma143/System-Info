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


}