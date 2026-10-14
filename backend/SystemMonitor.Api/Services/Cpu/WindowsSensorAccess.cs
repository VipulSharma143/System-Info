using System.Runtime.Versioning;
using System.Security.Principal;
using Microsoft.Win32;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Why a Windows processor temperature can be missing. Used only to give an honest reason when the sensor library returns
/// no usable value; it never supplies a temperature.
/// </summary>
[SupportedOSPlatform("windows")]
public static class WindowsSensorAccess
{
    private const string SensorDriverService = @"SYSTEM\CurrentControlSet\Services\PawnIO";

    public static bool IsElevated()
    {
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch (Exception) { return false; }
    }

    /// <summary>True when the PawnIO kernel driver service that LibreHardwareMonitor uses for processor registers is registered.</summary>
    public static bool SensorDriverRegistered()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(SensorDriverService);
            return key is not null;
        }
        catch (Exception) { return false; }
    }
}
