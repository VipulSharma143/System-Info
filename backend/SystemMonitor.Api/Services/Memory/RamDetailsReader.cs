using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Native;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Runtime RAM for both platforms: the native engine first, a platform-specific managed fallback second.
/// The result says which one was used (<see cref="RamDetails.Source"/>), so a fallback is never silent.
/// </summary>
public static class RamDetailsReader
{
    public static RamDetails Read(Func<RamDetails?> managedFallback)
    {
        try
        {
            if (NativeHardware.GetMemoryInfo() is { } native && MemoryMapping.ToRamDetails(native) is { } details)
                return details;
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException or BadImageFormatException)
        {
            // Native engine missing or too old: fall through to the managed reading.
        }

        return managedFallback() ?? throw new InvalidOperationException("Memory information could not be read.");
    }
}
