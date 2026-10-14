using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Microsoft.Win32.SafeHandles;

namespace SystemMonitor.Api.Services;

// Low-level Windows battery access via the battery class driver IOCTLs.
// GetSystemPowerStatus (used elsewhere for AC/charging/percent) does NOT
// expose cycle count, designed/full-charge capacity, voltage, or chemistry —
// those only come from talking to the battery device directly, the same way
// Windows' own Battery Report (powercfg /batteryreport) does it.
//
// Flow: enumerate battery device interfaces (GUID_DEVICE_BATTERY) -> open
// each -> IOCTL_BATTERY_QUERY_TAG to get a tag for the currently-inserted
// battery -> IOCTL_BATTERY_QUERY_INFORMATION for static info (capacities,
// cycle count, chemistry) -> IOCTL_BATTERY_QUERY_STATUS for live info
// (voltage, rate, power state).
[SupportedOSPlatform("windows")]
public static class WindowsBatteryInterop
{
    private const uint DIGCF_PRESENT = 0x02;
    private const uint DIGCF_DEVICEINTERFACE = 0x10;
    private const uint GENERIC_READ = 0x80000000;
    private const uint GENERIC_WRITE = 0x40000000;
    private const uint FILE_SHARE_READ = 0x01;
    private const uint FILE_SHARE_WRITE = 0x02;
    private const uint OPEN_EXISTING = 3;

    private const uint FILE_DEVICE_BATTERY = 0x29;
    private const uint METHOD_BUFFERED = 0;
    private const uint FILE_READ_ACCESS = 0x0001;

    private static uint CTL_CODE(uint deviceType, uint function, uint method, uint access) =>
        (deviceType << 16) | (access << 14) | (function << 2) | method;

    private static readonly uint IOCTL_BATTERY_QUERY_TAG =
        CTL_CODE(FILE_DEVICE_BATTERY, 0x10, METHOD_BUFFERED, FILE_READ_ACCESS);
    private static readonly uint IOCTL_BATTERY_QUERY_INFORMATION =
        CTL_CODE(FILE_DEVICE_BATTERY, 0x11, METHOD_BUFFERED, FILE_READ_ACCESS);
    private static readonly uint IOCTL_BATTERY_QUERY_STATUS =
        CTL_CODE(FILE_DEVICE_BATTERY, 0x13, METHOD_BUFFERED, FILE_READ_ACCESS);

    private static readonly Guid GUID_DEVICE_BATTERY = new("72631e54-78a4-11d0-bcf7-00aa00b7b32a");

    private const uint BATTERY_UNKNOWN_CAPACITY = 0xFFFFFFFF;
    private const uint BATTERY_UNKNOWN_VOLTAGE = 0xFFFFFFFF;
    private const int BATTERY_UNKNOWN_RATE = unchecked((int)0x80000000);

    private const uint BATTERY_POWER_ON_LINE = 0x00000001;
    private const uint BATTERY_DISCHARGING = 0x00000002;
    private const uint BATTERY_CHARGING = 0x00000004;
    private const uint BATTERY_CRITICAL = 0x00000008;

    // BATTERY_INFORMATION_LEVEL.BatteryInformation = 0
    private const int BatteryInformationLevel = 0;

    [StructLayout(LayoutKind.Sequential)]
    private struct SP_DEVICE_INTERFACE_DATA
    {
        public int cbSize;
        public Guid InterfaceClassGuid;
        public int Flags;
        public IntPtr Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BATTERY_QUERY_INFORMATION
    {
        public uint BatteryTag;
        public int InformationLevel;
        public uint AtRate;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BATTERY_INFORMATION
    {
        public uint Capabilities;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 4)]
        public byte[] Chemistry;
        public uint DesignedCapacity;
        public uint FullChargedCapacity;
        public uint DefaultAlert1;
        public uint DefaultAlert2;
        public uint CriticalBias;
        public uint CycleCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BATTERY_WAIT_STATUS
    {
        public uint BatteryTag;
        public uint Timeout;
        public uint PowerState;
        public uint LowCapacity;
        public uint HighCapacity;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BATTERY_STATUS
    {
        public uint PowerState;
        public uint Capacity;
        public uint Voltage;
        public int Rate;
    }

    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern IntPtr SetupDiGetClassDevs(
        ref Guid classGuid, IntPtr enumerator, IntPtr hwndParent, uint flags);

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiEnumDeviceInterfaces(
        IntPtr deviceInfoSet, IntPtr deviceInfoData, ref Guid interfaceClassGuid,
        uint memberIndex, ref SP_DEVICE_INTERFACE_DATA deviceInterfaceData);

    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern bool SetupDiGetDeviceInterfaceDetail(
        IntPtr deviceInfoSet, ref SP_DEVICE_INTERFACE_DATA deviceInterfaceData,
        IntPtr deviceInterfaceDetailData, uint deviceInterfaceDetailDataSize,
        out uint requiredSize, IntPtr deviceInfoData);

    [DllImport("setupapi.dll", SetLastError = true)]
    private static extern bool SetupDiDestroyDeviceInfoList(IntPtr deviceInfoSet);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern SafeFileHandle CreateFile(
        string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes,
        uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DeviceIoControl(
        SafeFileHandle device, uint ioControlCode,
        ref uint inBuffer, uint inBufferSize,
        out uint outBuffer, uint outBufferSize,
        out uint bytesReturned, IntPtr overlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DeviceIoControl(
        SafeFileHandle device, uint ioControlCode,
        ref BATTERY_QUERY_INFORMATION inBuffer, uint inBufferSize,
        out BATTERY_INFORMATION outBuffer, uint outBufferSize,
        out uint bytesReturned, IntPtr overlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DeviceIoControl(
        SafeFileHandle device, uint ioControlCode,
        ref BATTERY_WAIT_STATUS inBuffer, uint inBufferSize,
        out BATTERY_STATUS outBuffer, uint outBufferSize,
        out uint bytesReturned, IntPtr overlapped);

    public record RawBatteryData(
        string DeviceId,
        uint? CycleCount,
        double? DesignedCapacityMWh,
        double? FullChargedCapacityMWh,
        double? CurrentCapacityMWh,
        double? VoltageMV,
        double? RateMW,
        uint PowerState,
        string? Chemistry
    );

    // Enumerates every present battery device and queries static + live info
    // for each. Returns an empty list (never null) if no battery devices are
    // found — callers must not treat an exception here as "no battery",
    // only an empty/absent enumeration result.
    public static List<RawBatteryData> QueryAllBatteries()
    {
        var results = new List<RawBatteryData>();
        var classGuid = GUID_DEVICE_BATTERY;
        IntPtr deviceInfoSet = SetupDiGetClassDevs(
            ref classGuid, IntPtr.Zero, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);

        if (deviceInfoSet == IntPtr.Zero || deviceInfoSet.ToInt64() == -1)
        {
            return results;
        }

        try
        {
            uint index = 0;
            while (true)
            {
                var interfaceData = new SP_DEVICE_INTERFACE_DATA();
                interfaceData.cbSize = Marshal.SizeOf<SP_DEVICE_INTERFACE_DATA>();

                if (!SetupDiEnumDeviceInterfaces(
                        deviceInfoSet, IntPtr.Zero, ref classGuid, index, ref interfaceData))
                {
                    break; // no more devices
                }

                index++;

                // First call to get required buffer size for the device path.
                SetupDiGetDeviceInterfaceDetail(
                    deviceInfoSet, ref interfaceData, IntPtr.Zero, 0, out uint requiredSize, IntPtr.Zero);

                if (requiredSize == 0) continue;

                IntPtr detailBuffer = Marshal.AllocHGlobal((int)requiredSize);
                try
                {
                    // SP_DEVICE_INTERFACE_DETAIL_DATA starts with a DWORD cbSize field;
                    // the struct is variable-length (trailing WCHAR path) so we write
                    // the fixed header manually rather than declare it as a managed struct.
                    Marshal.WriteInt32(detailBuffer, IntPtr.Size == 8 ? 8 : 6);

                    if (!SetupDiGetDeviceInterfaceDetail(
                            deviceInfoSet, ref interfaceData, detailBuffer, requiredSize,
                            out _, IntPtr.Zero))
                    {
                        continue;
                    }

                    string devicePath = Marshal.PtrToStringAuto(detailBuffer + 4) ?? "";
                    if (string.IsNullOrEmpty(devicePath)) continue;

                    var raw = QuerySingleBattery(devicePath);
                    if (raw != null) results.Add(raw);
                }
                finally
                {
                    Marshal.FreeHGlobal(detailBuffer);
                }
            }
        }
        finally
        {
            SetupDiDestroyDeviceInfoList(deviceInfoSet);
        }

        return results;
    }

    private static RawBatteryData? QuerySingleBattery(string devicePath)
    {
        using var handle = CreateFile(
            devicePath, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
            IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);

        if (handle.IsInvalid) return null;

        // Query the tag for whatever battery is currently inserted at this device.
        // A tag of 0 means no battery is physically present at this device slot.
        uint tagInput = 0;
        if (!DeviceIoControl(handle, IOCTL_BATTERY_QUERY_TAG, ref tagInput, sizeof(uint),
                out uint batteryTag, sizeof(uint), out _, IntPtr.Zero) || batteryTag == 0)
        {
            return null;
        }

        uint? cycleCount = null;
        double? designedMWh = null, fullChargedMWh = null;
        string? chemistry = null;

        var infoQuery = new BATTERY_QUERY_INFORMATION
        {
            BatteryTag = batteryTag,
            InformationLevel = BatteryInformationLevel,
            AtRate = 0
        };

        if (DeviceIoControl(handle, IOCTL_BATTERY_QUERY_INFORMATION,
                ref infoQuery, (uint)Marshal.SizeOf<BATTERY_QUERY_INFORMATION>(),
                out BATTERY_INFORMATION info, (uint)Marshal.SizeOf<BATTERY_INFORMATION>(),
                out _, IntPtr.Zero))
        {
            // Per Microsoft's own documentation, CycleCount and the capacity fields
            // are set to 0 when the driver cannot supply them — 0 here is the
            // driver's "unavailable" sentinel, not a real reading, so it must not
            // be surfaced to the API/UI as a real zero value.
            cycleCount = info.CycleCount > 0 ? info.CycleCount : null;
            designedMWh = (info.DesignedCapacity > 0 && info.DesignedCapacity != BATTERY_UNKNOWN_CAPACITY)
                ? info.DesignedCapacity : null;
            fullChargedMWh = (info.FullChargedCapacity > 0 && info.FullChargedCapacity != BATTERY_UNKNOWN_CAPACITY)
                ? info.FullChargedCapacity : null;
            chemistry = info.Chemistry != null
                ? System.Text.Encoding.ASCII.GetString(info.Chemistry).TrimEnd('\0')
                : null;
            if (string.IsNullOrWhiteSpace(chemistry)) chemistry = null;
        }

        double? currentMWh = null, voltageMV = null, rateMW = null;
        uint powerState = 0;

        var statusQuery = new BATTERY_WAIT_STATUS
        {
            BatteryTag = batteryTag,
            Timeout = 0,
            PowerState = 0,
            LowCapacity = 0,
            HighCapacity = 0
        };

        if (DeviceIoControl(handle, IOCTL_BATTERY_QUERY_STATUS,
                ref statusQuery, (uint)Marshal.SizeOf<BATTERY_WAIT_STATUS>(),
                out BATTERY_STATUS status, (uint)Marshal.SizeOf<BATTERY_STATUS>(),
                out _, IntPtr.Zero))
        {
            powerState = status.PowerState;
            currentMWh = status.Capacity != BATTERY_UNKNOWN_CAPACITY ? status.Capacity : null;
            voltageMV = status.Voltage != BATTERY_UNKNOWN_VOLTAGE ? status.Voltage : null;
            rateMW = status.Rate != BATTERY_UNKNOWN_RATE ? status.Rate : null;
        }

        return new RawBatteryData(
            DeviceId: devicePath,
            CycleCount: cycleCount,
            DesignedCapacityMWh: designedMWh,
            FullChargedCapacityMWh: fullChargedMWh,
            CurrentCapacityMWh: currentMWh,
            VoltageMV: voltageMV,
            RateMW: rateMW,
            PowerState: powerState,
            Chemistry: chemistry
        );
    }

    public static bool IsCharging(uint powerState) => (powerState & BATTERY_CHARGING) != 0;
    public static bool IsDischarging(uint powerState) => (powerState & BATTERY_DISCHARGING) != 0;
    public static bool IsPluggedIn(uint powerState) => (powerState & BATTERY_POWER_ON_LINE) != 0;
    public static bool IsCritical(uint powerState) => (powerState & BATTERY_CRITICAL) != 0;
}
