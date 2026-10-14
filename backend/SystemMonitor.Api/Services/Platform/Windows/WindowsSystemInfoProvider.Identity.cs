using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Native;

namespace SystemMonitor.Api.Services;

[SupportedOSPlatform("windows")]
public partial class WindowsSystemInfoProvider
{
    // Everything except uptime is fixed for the life of the process, and each field costs a
    // WMI round-trip, so it is read once. A read where every field failed is retried next call.
    private SystemIdentity? _identity;

    public SystemIdentity GetSystemIdentity()
    {
        var identity = _identity;
        if (identity is null)
        {
            identity = ReadSystemIdentity();
            if (identity.ComputerName is not null || identity.Manufacturer is not null || identity.WindowsEdition is not null)
                _identity = identity;
        }
        return identity.LastBootTime is { } boot
            ? identity with { UptimeSeconds = Math.Max(0, (DateTime.Now - boot).TotalSeconds) }
            : identity;
    }

    // System Identity (spec §6-§8). Deliberately independent CIM queries in
    // separate try/catch blocks rather than one combined query — spec §23:
    // one optional field failing must not take the others down with it.
    private SystemIdentity ReadSystemIdentity()
    {
        string? computerName = null, manufacturer = null, model = null;
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT Name, Manufacturer, Model FROM Win32_ComputerSystem");
            foreach (ManagementObject obj in searcher.Get())
            {
                computerName = obj["Name"]?.ToString();
                manufacturer = obj["Manufacturer"]?.ToString();
                model = obj["Model"]?.ToString();
            }
        }
        catch
        {
            // Win32_ComputerSystem unavailable — leave these fields null.
        }

        string? biosVersion = null;
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT SMBIOSBIOSVersion FROM Win32_BIOS");
            foreach (ManagementObject obj in searcher.Get())
            {
                biosVersion = obj["SMBIOSBIOSVersion"]?.ToString();
            }
        }
        catch
        {
            // Win32_BIOS unavailable — leave null.
        }

        string? windowsEdition = null, windowsBuild = null, architecture = null;
        DateTime? lastBoot = null;
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT Caption, BuildNumber, OSArchitecture, LastBootUpTime FROM Win32_OperatingSystem");
            foreach (ManagementObject obj in searcher.Get())
            {
                windowsEdition = obj["Caption"]?.ToString()?.Trim();
                windowsBuild = obj["BuildNumber"]?.ToString();
                architecture = obj["OSArchitecture"]?.ToString();

                var rawBootTime = obj["LastBootUpTime"]?.ToString();
                if (!string.IsNullOrEmpty(rawBootTime))
                {
                    try
                    {
                        lastBoot = ManagementDateTimeConverter.ToDateTime(rawBootTime);
                    }
                    catch
                    {
                        // Malformed CIM datetime — leave unavailable rather than guessing.
                    }
                }
            }
        }
        catch
        {
            // Win32_OperatingSystem unavailable — leave these fields null.
        }

        // Physical core count (distinct from logical processor count, which
        // Environment.ProcessorCount already covers elsewhere). Win32_Processor
        // returns one instance per physical CPU package — a typical consumer
        // machine has exactly one, but this sums NumberOfCores across every
        // instance returned so multi-socket systems aren't undercounted.
        int? physicalCores = NativePhysicalCores();
        if (physicalCores is null)
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT NumberOfCores FROM Win32_Processor");
            int sum = 0;
            bool any = false;
            foreach (ManagementObject obj in searcher.Get())
            {
                if (obj["NumberOfCores"] is { } coresVal)
                {
                    try
                    {
                        sum += Convert.ToInt32(coresVal);
                        any = true;
                    }
                    catch
                    {
                        // Malformed value on this instance — skip it, keep summing the rest.
                    }
                }
            }
            physicalCores = any && sum > 0 ? sum : null;
        }
        catch
        {
            // Win32_Processor unavailable — leave null.
        }

        double? uptimeSeconds = lastBoot.HasValue
            ? Math.Max(0, (DateTime.Now - lastBoot.Value).TotalSeconds)
            : null;

        return new SystemIdentity(
            ComputerName: string.IsNullOrWhiteSpace(computerName) ? null : computerName,
            Manufacturer: string.IsNullOrWhiteSpace(manufacturer) ? null : manufacturer,
            Model: string.IsNullOrWhiteSpace(model) ? null : model,
            BiosVersion: string.IsNullOrWhiteSpace(biosVersion) ? null : biosVersion,
            WindowsEdition: string.IsNullOrWhiteSpace(windowsEdition) ? null : windowsEdition,
            WindowsBuild: string.IsNullOrWhiteSpace(windowsBuild) ? null : windowsBuild,
            Architecture: string.IsNullOrWhiteSpace(architecture) ? null : architecture,
            LastBootTime: lastBoot,
            UptimeSeconds: uptimeSeconds,
            PhysicalCores: physicalCores
        );
    }

    // Physical core count from the native topology call (one syscall, no WMI round-trip).
    // Null when the native library is missing or the OS does not report it, so callers fall back.
    private static int? NativePhysicalCores()
    {
        try { return NativeHardware.GetCpuTopology()?.PhysicalCores; }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException) { return null; }
    }
}
