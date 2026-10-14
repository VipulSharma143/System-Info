using System.Text;

namespace SystemMonitor.Api.Services;

/// <summary>
/// One Intel or AMD graphics adapter that a managed hardware library lists. <see cref="VendorId"/> is the PCI vendor id in the
/// engine's own form ("0x8086" / "0x1002"). <see cref="CoreC"/> is the adapter's "GPU Core" temperature, or null when the driver
/// has no such sensor or reported nothing usable (never 0). <see cref="History"/> is CoreC over time, oldest first, gaps null.
/// </summary>
public sealed record GpuSensorAdapter(string VendorId, string Name, double? CoreC, IReadOnlyList<double?> History);

/// <summary>What the library saw on its last sample. <see cref="Failure"/> is set when the library could not read the adapters at all.</summary>
public sealed record GpuSensorSnapshot(IReadOnlyList<GpuSensorAdapter> Adapters, string? Failure);

/// <summary>A source of integrated-GPU temperatures that is not the native engine (Windows). Read never blocks and never throws.</summary>
public interface IGpuSensorSource
{
    GpuSensorSnapshot? Read();
}

/// <summary>
/// Fills the temperature of an integrated Intel or AMD GPU that the native engine could not measure (on Windows the engine only
/// reads temperatures through the NVIDIA driver). Rules:
///   * only an adapter the engine calls "integrated", from Intel or AMD, and only while the engine has no temperature for it;
///   * a native value is never replaced, and a discrete adapter is never touched;
///   * the value is the library's "GPU Core" temperature sensor; hot spot, memory and regulator sensors are other quantities;
///   * a reading outside 1..125 °C is a broken sensor and is not shown;
///   * the library's adapter is paired with the engine's by exact (normalised) name, or by elimination only when each side
///     has exactly one adapter of that vendor; anything less certain shows no number, never another adapter's.
/// Nothing is estimated: when there is no value the adapter says why.
/// </summary>
public static class GpuSensorSelection
{
    public const string Source = "librehardwaremonitor";
    public const string SensorName = "GPU Core";
    public const int HistoryLength = 120;
    public const string IntelVendorId = "0x8086";
    public const string AmdVendorId = "0x1002";

    public const string NoSensorNote = "The graphics driver reports no temperature for this adapter.";
    public const string NotListedNote = "The hardware sensor library does not list this adapter, so its temperature is unavailable.";
    public const string AmbiguousNote = "More than one adapter could be this one, so no temperature is shown rather than risk showing another adapter's.";

    private static bool Same(string? a, string? b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

    /// <summary>True for an integrated Intel/AMD adapter the engine has no temperature for.</summary>
    public static bool Wants(OverlayGpu g) =>
        Same(g.Kind, "integrated") && g.TemperatureC is null && (Same(g.VendorId, IntelVendorId) || Same(g.VendorId, AmdVendorId));

    /// <summary>The adapter's "GPU Core" temperature, or null when it has none that is plausible.</summary>
    public static double? PickCore(IEnumerable<RawTemperature> raw) =>
        raw.Where(r => Same(r.Name.Trim(), SensorName) && CpuSensorSelection.Plausible(r.Value))
           .Select(r => r.Value)
           .FirstOrDefault();

    /// <summary>Lower-case letters and digits only, without the trademark marks drivers add inconsistently ("(R)", "(TM)").</summary>
    public static string Normalize(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "";
        var text = name.Replace("(R)", "", StringComparison.OrdinalIgnoreCase).Replace("(TM)", "", StringComparison.OrdinalIgnoreCase);
        var sb = new StringBuilder(text.Length);
        foreach (var c in text) if (char.IsLetterOrDigit(c)) sb.Append(char.ToLowerInvariant(c));
        return sb.ToString();
    }

    private sealed record Pairing(GpuSensorAdapter? Adapter, string? Why);

    private static Pairing Resolve(OverlayGpu gpu, IReadOnlyList<OverlayGpu> engineGpus, IReadOnlyList<GpuSensorAdapter> listed)
    {
        var sameVendor = listed.Where(a => Same(a.VendorId, gpu.VendorId)).ToList();
        if (sameVendor.Count == 0) return new Pairing(null, NotListedNote);

        var name = Normalize(gpu.Name);
        var byName = name.Length == 0 ? new List<GpuSensorAdapter>() : sameVendor.Where(a => Normalize(a.Name) == name).ToList();
        var enginesWithName = engineGpus.Count(e => Same(e.VendorId, gpu.VendorId) && Normalize(e.Name) == name);
        if (byName.Count == 1 && enginesWithName == 1) return new Pairing(byName[0], null);
        if (byName.Count > 1 || (byName.Count == 1 && enginesWithName > 1)) return new Pairing(null, AmbiguousNote);

        // Names differ between the driver and the engine: only a lone adapter on both sides can be paired safely. If the engine
        // also has a discrete adapter of this vendor, the library's single entry might be that one, so nothing is assumed.
        var enginesOfVendor = engineGpus.Count(e => Same(e.VendorId, gpu.VendorId));
        if (sameVendor.Count == 1 && enginesOfVendor == 1) return new Pairing(sameVendor[0], null);
        return new Pairing(null, sameVendor.Count > 1 || enginesOfVendor > 1 ? AmbiguousNote : NotListedNote);
    }

    private static List<double?> Align(IReadOnlyList<double?> source, int length)
    {
        var tail = source.Skip(Math.Max(0, source.Count - length)).ToList();
        var padded = new List<double?>(length);
        for (var i = tail.Count; i < length; i++) padded.Add(null);
        padded.AddRange(tail);
        return padded;
    }

    private static string Join(string? existing, string why) => string.IsNullOrWhiteSpace(existing) ? why : existing + " " + why;

    /// <summary>Applies the rules above to one engine snapshot. Public so tests can drive it; the input is never modified.</summary>
    public static OverlaySnapshot Apply(OverlaySnapshot s, GpuSensorSnapshot? sensors)
    {
        if (sensors is null) return s;   // not sampled yet: the engine's own state stands

        List<OverlayGpu>? gpus = null;
        Dictionary<string, OverlayGpuHistory>? histories = null;
        for (var i = 0; i < s.Gpus.Count; i++)
        {
            var g = s.Gpus[i];
            if (!Wants(g)) continue;

            var pairing = Resolve(g, s.Gpus, sensors.Adapters);
            OverlayGpu updated;
            if (pairing.Adapter is { CoreC: { } temp } adapter)
            {
                updated = g with { TemperatureC = temp, Source = g.Source with { Temperature = Source } };
                if (s.History.Gpus.TryGetValue(g.Id, out var h) && !h.Temp.Any(v => v is not null))
                {
                    histories ??= new Dictionary<string, OverlayGpuHistory>(s.History.Gpus);
                    histories[g.Id] = h with { Temp = Align(adapter.History, h.Temp.Count) };
                }
            }
            else
            {
                var why = pairing.Adapter is not null ? NoSensorNote
                        : sensors.Failure is not null && sensors.Adapters.Count == 0 ? sensors.Failure
                        : pairing.Why ?? NotListedNote;
                updated = g with { Note = Join(g.Note, why) };
            }
            gpus ??= [.. s.Gpus];
            gpus[i] = updated;
        }

        if (gpus is null) return s;
        return s with { Gpus = gpus, History = histories is null ? s.History : s.History with { Gpus = histories } };
    }
}
