using System.Diagnostics;
using System.Runtime.Versioning;
using System.Text.RegularExpressions;
using SystemMonitor.Api.Native;

namespace SystemMonitor.Api.Services;

/// <summary>
/// "Processor Information" counters give per-logical-processor load and current frequency (the frequency counter is
/// base clock x performance, so it follows boost). Windows exposes no per-core or package temperature without a
/// hardware driver (those are model-specific registers, readable only from kernel mode). The ACPI thermal zone is the
/// only built-in sensor; it is a firmware/system zone, so it is reported as <c>SystemTemperatureC</c> and never as the
/// CPU package temperature. Package power comes from the "Energy Meter" counters where the platform provides them.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed partial class WindowsCpuCollector : ICpuCollector
{
    private const string Category = "Processor Information";

    private readonly object _gate = new();
    private bool _initialised;
    private bool _primed;
    private PerformanceCounter? _total;
    private List<PerformanceCounter> _usage = [];
    private List<PerformanceCounter> _frequency = [];
    private List<PerformanceCounter> _thermal = [];
    private PerformanceCounter? _packagePower;
    private readonly Func<IReadOnlyList<LogicalCpuInfo>> _logicalCpus;
    private IReadOnlyList<LogicalCpuInfo>? _logical;

    public WindowsCpuCollector(Func<IReadOnlyList<LogicalCpuInfo>>? logicalCpus = null) =>
        _logicalCpus = logicalCpus ?? (() => NativeHardware.GetLogicalCpus());
    private string? _note;
    private readonly TemperatureFlatlineGuard _flatline = new();
    private bool _zoneIsConstant;

    [GeneratedRegex(@"^\d+,\d+$")]
    private static partial Regex LogicalInstance();

    public CpuDetail Read()
    {
        lock (_gate)
        {
            if (!_initialised)
            {
                _initialised = true;
                Initialise();
            }

            var cores = new List<CpuCoreReading>(_usage.Count);
            for (var i = 0; i < _usage.Count; i++)
            {
                var usage = Next(_usage[i]);
                var clock = i < _frequency.Count ? Next(_frequency[i]) : null;
                cores.Add(new CpuCoreReading(i, _primed && usage is { } u ? Math.Round(Math.Clamp(u, 0, 100), 1) : null,
                    clock is > 0 ? (int)Math.Round(clock.Value) : null, null));
            }

            var totalUsage = _total is null ? null : Next(_total);
            var clocks = cores.Where(c => c.ClockMhz is not null).Select(c => c.ClockMhz!.Value).ToList();
            var temperature = ReadThermalZone();
            var load = !_primed || totalUsage is not { } tu ? (double?)null : Math.Clamp(tu, 0, 100);
            // A generic ACPI zone that never moves while the CPU load swings is not the CPU: withhold it (latched for
            // the session) instead of showing a constant as a live temperature.
            if (temperature is { } zone && !_zoneIsConstant && _flatline.Observe(zone, load)) _zoneIsConstant = true;
            if (_zoneIsConstant) temperature = null;
            var first = !_primed;
            _primed = true;
            _logical ??= _logicalCpus();
            var typed = CpuLayoutBuilder.Annotate(cores, _logical);
            var power = ReadPackagePower();

            return new CpuDetail(
                TotalUsagePercent: !first && totalUsage is { } t ? Math.Round(Math.Clamp(t, 0, 100), 1) : null,
                Cores: typed,
                AverageClockMhz: clocks.Count > 0 ? (int)Math.Round(clocks.Average()) : null,
                HighestClockMhz: clocks.Count > 0 ? clocks.Max() : null,
                BaseClockMhz: null,
                MaxClockMhz: null,
                PackageTemperatureC: null,
                PowerWatts: power,
                LoadAverage: null,
                TemperatureSource: null,
                Note: _note
                    ?? (_zoneIsConstant ? "Windows exposes no CPU temperature without a hardware driver; this PC's firmware thermal zone does not follow CPU load, so it is not shown."
                    : temperature is null ? "Windows exposes no CPU temperature without a hardware driver, and this PC reports no system thermal zone."
                    : "Windows exposes no CPU package or core temperature without a hardware driver. The value shown separately is the firmware's system thermal zone, not the CPU."),
                SampledAtUnixMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Layout: CpuLayoutBuilder.Build(_logical),
                SystemTemperatureC: temperature,
                SystemTemperatureSource: temperature is null ? null : "acpi-thermal-zone");
        }
    }

    private void Initialise()
    {
        try
        {
            if (!PerformanceCounterCategory.Exists(Category)) return;
            var category = new PerformanceCounterCategory(Category);
            var utility = category.CounterExists("% Processor Utility") ? "% Processor Utility" : "% Processor Time";
            var instances = category.GetInstanceNames().Where(n => LogicalInstance().IsMatch(n)).OrderBy(SortKey).ToList();

            _usage = instances.Select(n => new PerformanceCounter(Category, utility, n, readOnly: true)).ToList();
            _total = new PerformanceCounter(Category, utility, "_Total", readOnly: true);
            if (category.CounterExists("Processor Frequency"))
            {
                _frequency = instances.Select(n => new PerformanceCounter(Category, "Processor Frequency", n, readOnly: true)).ToList();
            }

            foreach (var counter in _usage.Append(_total)) counter.NextValue();
        }
        catch (Exception ex) when (ex is InvalidOperationException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        {
            _note = "Processor performance counters are not available to this account.";
        }

        InitialisePackagePower();

        try
        {
            if (PerformanceCounterCategory.Exists("Thermal Zone Information"))
            {
                var zones = new PerformanceCounterCategory("Thermal Zone Information");
                _thermal = zones.GetInstanceNames().Select(n => new PerformanceCounter("Thermal Zone Information", "Temperature", n, readOnly: true)).ToList();
            }
        }
        catch (Exception ex) when (ex is InvalidOperationException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        {
            _thermal = [];
        }
    }

    // "Energy Meter" is Windows' RAPL-backed counter set; only some platforms provide it. The counter is in milliwatts.
    private double? ReadPackagePower()
    {
        if (_packagePower is null) return null;
        var milliwatts = Next(_packagePower);
        return milliwatts is > 0 and < 500_000 ? Math.Round(milliwatts.Value / 1000.0, 1) : null;
    }

    private void InitialisePackagePower()
    {
        try
        {
            if (!PerformanceCounterCategory.Exists("Energy Meter")) return;
            var category = new PerformanceCounterCategory("Energy Meter");
            if (!category.CounterExists("Power")) return;
            var instance = category.GetInstanceNames().Where(n => n.Contains("PKG", StringComparison.OrdinalIgnoreCase)).OrderBy(n => n, StringComparer.Ordinal).FirstOrDefault();
            if (instance is null) return;
            _packagePower = new PerformanceCounter("Energy Meter", "Power", instance, readOnly: true);
            _packagePower.NextValue();
        }
        catch (Exception ex) when (ex is InvalidOperationException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        {
            _packagePower = null;
        }
    }

    private static (int, int) SortKey(string instance)
    {
        var parts = instance.Split(',');
        return (int.Parse(parts[0]), int.Parse(parts[1]));
    }

    private static double? Next(PerformanceCounter counter)
    {
        try
        {
            return counter.NextValue();
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    // The counter is in kelvin; zones that report nothing sensible (outside 1..125 C) are ignored. A zone that is
    // plausible but constant is caught by the flatline guard in Read().
    private double? ReadThermalZone()
    {
        double? best = null;
        foreach (var counter in _thermal)
        {
            if (Next(counter) is not { } kelvin) continue;
            var celsius = kelvin - 273.15;
            if (celsius is > 1 and < 125) best = Math.Max(best ?? celsius, celsius);
        }
        return best is { } b ? Math.Round(b, 1) : null;
    }
}
