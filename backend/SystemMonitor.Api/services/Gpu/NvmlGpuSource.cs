using System.Runtime.InteropServices;
using System.Text;

namespace SystemMonitor.Api.Services;

/// <summary>
/// NVML loaded at run time, so machines without an NVIDIA driver simply report it as unavailable.
/// Every call is individually optional: a driver or board that lacks one metric yields null for it only.
/// </summary>
public sealed class NvmlGpuSource : INvmlSource
{
    public static NvmlGpuSource Shared { get; } = new();

    // NVML error codes that mean the handles/session are no longer usable (driver reset, GPU powered off and back on,
    // G-Helper mode switch) rather than "this metric is not supported".
    private const int ErrUninitialized = 1, ErrDriverNotLoaded = 9, ErrGpuIsLost = 15, ErrResetRequired = 16, ErrUnknown = 999;

    private static readonly TimeSpan RetryAfterMissing = TimeSpan.FromSeconds(20);

    private readonly object _gate = new();
    private Api? _api;
    private IReadOnlyList<NvmlDevice> _devices = [];
    private List<IntPtr> _handles = [];
    private string? _driverVersion;
    private long _nextAttemptAt;
    private string? _problem;

    public bool IsAvailable => Ensure() is not null;

    public string? DriverVersion
    {
        get { Ensure(); lock (_gate) return _driverVersion; }
    }

    public IReadOnlyList<NvmlDevice> Devices
    {
        get { Ensure(); lock (_gate) return _devices; }
    }

    /// <summary>Why NVIDIA telemetry is missing right now, or null when it is working.</summary>
    public string? Problem
    {
        get { Ensure(); lock (_gate) return _problem; }
    }

    public NvmlSample? Sample(int deviceIndex)
    {
        // A lost session is rebuilt once and the read repeated, so one driver hiccup costs one sample, not the run.
        for (var attempt = 0; attempt < 2; attempt++)
        {
            Api? api;
            IntPtr h;
            lock (_gate)
            {
                api = Ensure();
                if (api is null || deviceIndex < 0 || deviceIndex >= _handles.Count) return null;
                h = _handles[deviceIndex];
            }

            var lost = false;
            int Call(int code)
            {
                if (code is ErrUninitialized or ErrDriverNotLoaded or ErrGpuIsLost or ErrResetRequired or ErrUnknown) lost = true;
                return code;
            }

            double? utilization = null;
            long? used = null, total = null;
            if (Ok(Call(api.Utilization(h, out var util)))) utilization = util.Gpu;
            if (Ok(Call(api.Memory(h, out var mem)))) { used = (long)mem.Used; total = (long)mem.Total; }

            var tempCode = Call(api.Temperature(h, 0, out var t));
            double? temperature = Ok(tempCode) && t is > 0 and < 150 ? t : null;
            int? core = Ok(Call(api.Clock(h, 0, out var c))) ? (int)c : null;
            int? memClock = Ok(Call(api.Clock(h, 2, out var m))) ? (int)m : null;
            double? power = Ok(api.PowerMilliwatts(h, out var p)) ? p / 1000.0 : null;
            double? limit = Ok(api.PowerLimitMilliwatts(h, out var l)) ? l / 1000.0 : null;
            int? fan = Ok(api.FanPercent(h, out var f)) ? (int)f : null;
            string? pstate = Ok(api.PerformanceState(h, out var s)) && s is >= 0 and <= 15 ? $"P{s}" : null;

            if (lost && utilization is null && temperature is null && attempt == 0)
            {
                Invalidate("NVIDIA driver session was lost; reconnecting.");
                continue;
            }

            lock (_gate) _problem = temperature is null ? $"NVML could not read the GPU temperature (code {tempCode})." : null;
            return new NvmlSample(utilization, used, total, temperature, core, memClock, power, limit, fan, pstate);
        }
        return null;
    }

    private void Invalidate(string reason)
    {
        lock (_gate)
        {
            _api = null;
            _handles = [];
            _devices = [];
            _problem = reason;
            _nextAttemptAt = 0;
        }
    }

    private static bool Ok(int code) => code == 0;

    private Api? Ensure()
    {
        lock (_gate)
        {
            if (_api is not null) return _api;
            var now = Environment.TickCount64;
            if (now < _nextAttemptAt) return null;
            try
            {
                _api = Load();
                if (_api is null) _nextAttemptAt = now + (long)RetryAfterMissing.TotalMilliseconds;
            }
            catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException or BadImageFormatException or MarshalDirectiveException or ArgumentException)
            {
                _api = null;
                _problem = $"NVIDIA management library could not be used ({ex.GetType().Name}).";
                _nextAttemptAt = now + (long)RetryAfterMissing.TotalMilliseconds;
            }
            return _api;
        }
    }

    private Api? Load()
    {
        var library = OpenLibrary();
        if (library == IntPtr.Zero) { _problem = "NVIDIA management library (nvml) was not found."; return null; }

        var api = Api.Bind(library);
        var init = api.Init();
        if (init != 0) { _problem = $"NVML failed to initialise (code {init})."; return null; }

        _driverVersion = ReadString(buffer => api.DriverVersion(buffer, (uint)buffer.Length));

        if (api.Count(out var count) != 0) count = 0;
        var devices = new List<NvmlDevice>();
        var handles = new List<IntPtr>();
        for (uint i = 0; i < count; i++)
        {
            if (api.Handle(i, out var handle) != 0) continue;

            var name = ReadString(buffer => api.Name(handle, buffer, (uint)buffer.Length)) ?? "NVIDIA GPU";
            var (pci, vendor, device) = ReadPci(api, handle);
            long? memory = Ok(api.Memory(handle, out var mem)) ? (long)mem.Total : null;

            devices.Add(new NvmlDevice(name, pci, vendor, device, memory));
            handles.Add(handle);
        }

        _devices = devices;
        _handles = handles;
        _problem = devices.Count == 0 ? "NVML found no NVIDIA device." : null;
        if (devices.Count == 0) return null;
        return api;
    }

    private static IntPtr OpenLibrary()
    {
        string[] candidates = OperatingSystem.IsWindows()
            ? ["nvml.dll", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "NVIDIA Corporation", "NVSMI", "nvml.dll")]
            : ["libnvidia-ml.so.1", "libnvidia-ml.so"];

        foreach (var candidate in candidates)
        {
            if (NativeLibrary.TryLoad(candidate, out var handle)) return handle;
        }
        return IntPtr.Zero;
    }

    private static string? ReadString(Func<byte[], int> call)
    {
        var buffer = new byte[96];
        if (call(buffer) != 0) return null;
        var end = Array.IndexOf(buffer, (byte)0);
        var text = Encoding.ASCII.GetString(buffer, 0, end < 0 ? buffer.Length : end).Trim();
        return text.Length == 0 ? null : text;
    }

    // nvmlPciInfo_t: char busIdLegacy[16]; uint domain, bus, device, pciDeviceId, pciSubSystemId; char busId[32].
    private static (string? Pci, string? Vendor, string? Device) ReadPci(Api api, IntPtr handle)
    {
        var buffer = Marshal.AllocHGlobal(128);
        try
        {
            if (api.Pci(handle, buffer) != 0) return (null, null, null);

            var busId = Marshal.PtrToStringAnsi(buffer + 36);
            var ids = (uint)Marshal.ReadInt32(buffer, 28);
            return (NormalizePci(busId), $"0x{ids & 0xFFFF:x4}", $"0x{ids >> 16:x4}");
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    /// <summary>"00000000:01:00.0" (NVML) and "0000:01:00.0" (sysfs) name the same device.</summary>
    public static string? NormalizePci(string? address)
    {
        if (string.IsNullOrWhiteSpace(address)) return null;
        var text = address.Trim().ToLowerInvariant();
        return text.Length > 12 ? text[^12..] : text;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Memory { public ulong Total, Free, Used; }

    [StructLayout(LayoutKind.Sequential)]
    private struct Utilization { public uint Gpu, Memory; }

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int InitFn();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int CountFn(out uint count);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int HandleFn(uint index, out IntPtr handle);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int DeviceTextFn(IntPtr handle, byte[] buffer, uint length);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int SystemTextFn(byte[] buffer, uint length);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int MemoryFn(IntPtr handle, out Memory memory);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int UtilizationFn(IntPtr handle, out Utilization utilization);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int UintFn(IntPtr handle, out uint value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int TypedUintFn(IntPtr handle, int kind, out uint value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int IntFn(IntPtr handle, out int value);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int PciFn(IntPtr handle, IntPtr info);

    private sealed class Api
    {
        public required InitFn Init;
        public required CountFn Count;
        public required HandleFn Handle;
        public required DeviceTextFn Name;
        public required SystemTextFn DriverVersion;
        public required MemoryFn Memory;
        public required UtilizationFn Utilization;
        public required TypedUintFn Temperature;
        public required TypedUintFn Clock;
        public required UintFn PowerMilliwatts;
        public required UintFn PowerLimitMilliwatts;
        public required UintFn FanPercent;
        public required IntFn PerformanceState;
        public required PciFn Pci;

        public static Api Bind(IntPtr library)
        {
            T Fn<T>(string symbol) where T : Delegate =>
                Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(library, symbol));

            return new Api
            {
                Init = Fn<InitFn>("nvmlInit_v2"),
                Count = Fn<CountFn>("nvmlDeviceGetCount_v2"),
                Handle = Fn<HandleFn>("nvmlDeviceGetHandleByIndex_v2"),
                Name = Fn<DeviceTextFn>("nvmlDeviceGetName"),
                DriverVersion = Fn<SystemTextFn>("nvmlSystemGetDriverVersion"),
                Memory = Fn<MemoryFn>("nvmlDeviceGetMemoryInfo"),
                Utilization = Fn<UtilizationFn>("nvmlDeviceGetUtilizationRates"),
                Temperature = Fn<TypedUintFn>("nvmlDeviceGetTemperature"),
                Clock = Fn<TypedUintFn>("nvmlDeviceGetClockInfo"),
                PowerMilliwatts = Fn<UintFn>("nvmlDeviceGetPowerUsage"),
                PowerLimitMilliwatts = Fn<UintFn>("nvmlDeviceGetEnforcedPowerLimit"),
                FanPercent = Fn<UintFn>("nvmlDeviceGetFanSpeed"),
                PerformanceState = Fn<IntFn>("nvmlDeviceGetPerformanceState"),
                Pci = Fn<PciFn>("nvmlDeviceGetPciInfo_v3"),
            };
        }
    }
}
