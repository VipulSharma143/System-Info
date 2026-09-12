using System.Text.Json;
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

             // Battery — present/not-present conditional, same honesty pattern as
        // GPU/fan: a desktop with no battery reports available=false, never
        // fabricated numbers. Cycle count is reported as-is; some firmware
        // (like this dev machine's) never increments it past 0, so it's
        // surfaced with a note rather than trusted blindly.
        app.MapGet("/api/native/battery", () =>
        {
            var buffer = new System.Text.StringBuilder(512);
            NativeInterop.GetBatteryInfoJson(buffer, buffer.Capacity);

            using var doc = JsonDocument.Parse(buffer.ToString());
            var root = doc.RootElement;

            bool present = root.GetProperty("present").GetBoolean();
            if (!present)
            {
                return Results.Ok(new
                {
                    available = false,
                    note = "No battery detected on this system"
                });
            }

            double healthPercent = root.GetProperty("healthPercent").GetDouble();
            long cycleCount = root.GetProperty("cycleCount").GetInt64();

            return Results.Ok(new
            {
                available = true,
                status = root.GetProperty("status").GetString(),
                capacityPercent = root.GetProperty("capacityPercent").GetInt64(),
                cycleCount,
                cycleCountNote = cycleCount == 0
                    ? "Firmware reports 0 — not all hardware tracks cycle count reliably"
                    : (string?)null,
                designCapacityMah = Math.Round(root.GetProperty("designCapacityMah").GetDouble(), 0),
                fullCapacityMah = Math.Round(root.GetProperty("fullCapacityMah").GetDouble(), 0),
                nowCapacityMah = Math.Round(root.GetProperty("nowCapacityMah").GetDouble(), 0),
                healthPercent = healthPercent >= 0 ? Math.Round(healthPercent, 1) : (double?)null,
                voltageNow = root.GetProperty("voltageNow").GetDouble(),
                powerWatts = Math.Round(root.GetProperty("powerWatts").GetDouble(), 1),
                model = root.GetProperty("model").GetString(),
                manufacturer = root.GetProperty("manufacturer").GetString()
            });
        })
        .WithName("GetBatteryInfo");


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