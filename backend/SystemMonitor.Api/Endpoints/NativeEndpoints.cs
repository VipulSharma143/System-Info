using SystemMonitor.Api.Native;

namespace SystemMonitor.Api.Endpoints;

public static class NativeEndpoints
{
    public static void MapNativeEndpoints(this WebApplication app)
    {
        app.MapGet("/api/native/test", () =>
        {
            int result = NativeInterop.AddNumbers(5, 7);
            return new { result, message = "C++ native call succeeded" };
        })
        .WithName("TestNativeCall");

        app.MapGet("/api/native/cpuinfo", () =>
        {
            var buffer = new System.Text.StringBuilder(256);
            int coreCount = NativeInterop.GetCpuInfo(buffer, buffer.Capacity);

            return new
            {
                modelName = buffer.ToString(),
                coreCount,
                source = "C++ native (/proc/cpuinfo)"
            };
        })
        .WithName("GetNativeCpuInfo");

        app.MapGet("/api/native/cpu", () =>
        {
            double usedPercent = NativeInterop.GetCpuUsagePercentNative();
            return new { usedPercent = Math.Round(usedPercent, 1), source = "C++ native" };
        })
        .WithName("GetNativeCpuUsage");

        app.MapGet("/api/native/cputemp", () =>
        {
            double temp = NativeInterop.GetCpuTemperature();
            return new { temperatureC = Math.Round(temp, 1) };
        })
        .WithName("GetCpuTemperature");

        // GPU info — vendor-conditional. AMD gets live sysfs data; NVIDIA and
        // Intel return an informative "not yet implemented" note rather than
        // fake data; unknown vendors degrade gracefully instead of crashing.
        app.MapGet("/api/native/gpu", () =>
        {
            int vendorCode = NativeInterop.GetGpuVendor();
            string vendorName = vendorCode switch
            {
                1 => "NVIDIA",
                2 => "AMD",
                3 => "Intel",
                _ => "Unknown/Unsupported"
            };

            double? usagePercent = null;
            string note;

            switch (vendorCode)
            {
                case 2:
                    double amdUsage = NativeInterop.GetAmdGpuUsagePercent();
                    if (amdUsage >= 0)
                    {
                        usagePercent = amdUsage;
                        note = "Live usage from AMD sysfs (gpu_busy_percent)";
                    }
                    else
                    {
                        note = "AMD GPU detected but gpu_busy_percent not available on this driver/kernel";
                    }
                    break;

                case 1:
                    note = "NVIDIA detected — live usage % not yet implemented (planned: nvidia-smi/NVML)";
                    break;

                case 3:
                    note = "Intel iGPU: live usage % requires additional debugfs work (planned later)";
                    break;

                default:
                    note = "GPU vendor not recognized on this system";
                    break;
            }

            return new { vendor = vendorName, vendorCode, usagePercent, note };
        })
        .WithName("GetNativeGpuInfo");

        app.MapGet("/api/native/fan", () =>
        {
            int rpm = NativeInterop.GetFanRpm();
            return rpm >= 0
                ? new { available = true, rpm, note = (string?)null }
                : new { available = false, rpm = 0, note = "No fan sensor exposed via hwmon on this system" };
        })
        .WithName("GetFanRpm");

        app.MapGet("/api/native/asmtest", () =>
        {
            int result = NativeInterop.CallAsmConstant();
            return new { result, message = "C# -> C++ -> Assembly chain succeeded" };
        })
        .WithName("TestAsmCall");

        app.MapGet("/api/native/benchmark", () =>
        {
            long iterations = 200_000_000;
            double opsPerSecond = NativeInterop.RunCpuBenchmark(iterations, out long result);

            return new
            {
                iterations,
                opsPerSecond = Math.Round(opsPerSecond, 0),
                accumulatedResult = result,
                note = "Tight arithmetic loop written in hand-crafted x86-64 Assembly, timed via std::chrono in C++"
            };
        })
        .WithName("RunCpuBenchmark");

        app.MapGet("/api/native/simd-benchmark", () =>
        {
            long iterations = 200_000_000;
            NativeInterop.RunSimdComparison(iterations, out double scalarOps, out double simdOps);

            double speedup = scalarOps > 0 ? simdOps / scalarOps : 0;

            return new
            {
                iterations,
                scalarOpsPerSecond = Math.Round(scalarOps, 0),
                simdOpsPerSecond = Math.Round(simdOps, 0),
                speedupFactor = Math.Round(speedup, 2),
                note = "Scalar (1 element/iteration) vs SSE2 SIMD (4 elements/iteration), identical add+xor work per element"
            };
        })
        .WithName("RunSimdComparison");
    }
}