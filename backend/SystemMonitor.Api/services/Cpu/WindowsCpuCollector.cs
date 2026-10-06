using System.Diagnostics;
using System.Runtime.Versioning;
using System.Text.RegularExpressions;

namespace SystemMonitor.Api.Services;

/// <summary>
/// "Processor Information" counters give per-logical-processor load and current frequency (the frequency counter is
/// base clock x performance, so it follows boost). Windows exposes no per-core or package temperature without a
/// hardware driver; the ACPI thermal zone is the only built-in sensor and is reported as approximate.
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
    private string? _note;

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
            var first = !_primed;
            _primed = true;

            return new CpuDetail(
                TotalUsagePercent: !first && totalUsage is { } t ? Math.Round(Math.Clamp(t, 0, 100), 1) : null,
                Cores: cores,
                AverageClockMhz: clocks.Count > 0 ? (int)Math.Round(clocks.Average()) : null,
                HighestClockMhz: clocks.Count > 0 ? clocks.Max() : null,
                BaseClockMhz: null,
                MaxClockMhz: null,
                PackageTemperatureC: temperature,
                PowerWatts: null,
                LoadAverage: null,
                TemperatureSource: temperature is null ? null : "acpi-thermal-zone",
                Note: _note ?? (temperature is null ? null : "Temperature is the ACPI thermal zone: an approximation, not the individual core sensors."),
                SampledAtUnixMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
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

    // The counter is in kelvin; zones that report nothing sensible (0, or a constant 27 C) are ignored.
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
