using System.Runtime.InteropServices;
using System.Text;
using SystemMonitor.Api.Native;

namespace SystemMonitor.Api.Services;

/// <summary>The native sampler behind the overlay. Abstracted so the service can be tested without the library.</summary>
public interface IOverlayEngine
{
    bool Start(int intervalMs);
    void Stop();
    /// <summary>Latest snapshot JSON, or null when there is none yet or the engine is unavailable.</summary>
    string? ReadSnapshotJson();
    /// <summary>Why the engine cannot run (library missing), or null.</summary>
    string? Problem { get; }
}

public sealed class NativeOverlayEngine : IOverlayEngine
{
    private readonly object _gate = new();
    private byte[] _buffer = new byte[32 * 1024];
    private bool _started;

    public string? Problem { get; private set; }

    public bool Start(int intervalMs)
    {
        try
        {
            if (NativeInterop.OverlayStart(intervalMs, IntPtr.Zero) != 1) { Problem = "The native monitor engine did not start."; return false; }
            _started = true;
            Problem = null;
            return true;
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException or BadImageFormatException)
        {
            Problem = "The native monitor engine is not available in this build.";
            return false;
        }
    }

    public void Stop()
    {
        if (!_started) return;
        try { NativeInterop.OverlayStop(); }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException) { }
        _started = false;
    }

    public string? ReadSnapshotJson()
    {
        if (!_started) return null;
        lock (_gate)
        {
            for (var attempt = 0; attempt < 3; attempt++)
            {
                var n = NativeInterop.OverlaySnapshotJson(_buffer, _buffer.Length);
                if (n == 0) return null;
                if (n < 0) { _buffer = new byte[Math.Min(-n + 1024, 4 * 1024 * 1024)]; continue; }
                return Encoding.UTF8.GetString(_buffer, 0, n);
            }
            return null;
        }
    }
}
