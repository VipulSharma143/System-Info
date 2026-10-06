using System.Text;
using SystemMonitor.Api.Native;
using SystemMonitor.Api.Services;

// Sensor selection against fake sysfs trees (hardware independent), the flatline guard for generic zones, and a
// contract test that the managed and native implementations pick the same sensor and value from the same tree.
static class CpuTemperatureTests
{
    static void Write(string path, string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
    }

    public static (int Failures, int Checks) Run()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }

        var root = Path.Combine(Path.GetTempPath(), "sysinfo-temp-" + Guid.NewGuid().ToString("N"));
        try
        {
            string Tree(string name) => Path.Combine(root, name);

            // The regression: only generic ACPI data exists. It is not a CPU temperature.
            var acpi = Tree("acpi");
            Write(Path.Combine(acpi, "class", "thermal", "thermal_zone0", "type"), "acpitz\n");
            Write(Path.Combine(acpi, "class", "thermal", "thermal_zone0", "temp"), "27800\n");
            Write(Path.Combine(acpi, "class", "hwmon", "hwmon0", "name"), "acpitz\n");
            Write(Path.Combine(acpi, "class", "hwmon", "hwmon0", "temp1_input"), "27800\n");
            Check(CpuTemperatureSelection.Read(acpi) is null, "acpitz alone is not a CPU temperature");
            Check(CpuTemperatureSelection.Read(Tree("missing")) is null, "a missing sysfs is no sensor, not an exception");

            // Live: every read goes to the file, nothing is remembered.
            var intel = Tree("intel");
            var hw = Path.Combine(intel, "class", "hwmon", "hwmon4");
            Write(Path.Combine(hw, "name"), "coretemp\n");
            Write(Path.Combine(hw, "temp1_input"), "52000\n"); Write(Path.Combine(hw, "temp1_label"), "Package id 0\n");
            Write(Path.Combine(hw, "temp2_input"), "50000\n"); Write(Path.Combine(hw, "temp2_label"), "Core 0\n");
            Check(CpuTemperatureSelection.Read(intel) is { PackageCelsius: 52, Source: "coretemp" } r0 && r0.Cores[0] == 50, "coretemp package and core");
            Write(Path.Combine(hw, "temp1_input"), "88000\n");
            Check(CpuTemperatureSelection.Read(intel)?.PackageCelsius == 88, "a changed file gives a changed reading");
            Write(Path.Combine(hw, "temp1_input"), "0\n");
            Check(CpuTemperatureSelection.Read(intel) is { PackageCelsius: 50 }, "a broken 0 C package sensor is skipped and the hottest real core stands in");
            Write(Path.Combine(hw, "temp2_input"), "0\n");
            Check(CpuTemperatureSelection.Read(intel) is null, "with every sensor broken there is no reading, not 0 C");

            // Native/managed contract on trees with a real answer.
            var trees = new List<(string Name, string Path)>();
            var amd = Tree("amd");
            Write(Path.Combine(amd, "class", "hwmon", "hwmon0", "name"), "k10temp\n");
            Write(Path.Combine(amd, "class", "hwmon", "hwmon0", "temp1_input"), "71000\n"); Write(Path.Combine(amd, "class", "hwmon", "hwmon0", "temp1_label"), "Tctl\n");
            Write(Path.Combine(amd, "class", "hwmon", "hwmon0", "temp2_input"), "65000\n"); Write(Path.Combine(amd, "class", "hwmon", "hwmon0", "temp2_label"), "Tdie\n");
            trees.Add(("amd", amd));
            Check(CpuTemperatureSelection.Read(amd) is { PackageCelsius: 65, Source: "k10temp" }, "k10temp prefers Tdie");

            var cores = Tree("cores");
            Write(Path.Combine(cores, "class", "hwmon", "hwmon1", "name"), "coretemp\n");
            Write(Path.Combine(cores, "class", "hwmon", "hwmon1", "temp2_input"), "55000\n"); Write(Path.Combine(cores, "class", "hwmon", "hwmon1", "temp2_label"), "Core 0\n");
            Write(Path.Combine(cores, "class", "hwmon", "hwmon1", "temp3_input"), "61000\n"); Write(Path.Combine(cores, "class", "hwmon", "hwmon1", "temp3_label"), "Core 1\n");
            trees.Add(("cores", cores));

            var zone = Tree("zone");
            Write(Path.Combine(zone, "class", "thermal", "thermal_zone0", "type"), "acpitz\n"); Write(Path.Combine(zone, "class", "thermal", "thermal_zone0", "temp"), "27000\n");
            Write(Path.Combine(zone, "class", "thermal", "thermal_zone3", "type"), "x86_pkg_temp\n"); Write(Path.Combine(zone, "class", "thermal", "thermal_zone3", "temp"), "55000\n");
            trees.Add(("zone", zone));

            var arm = Tree("arm");
            Write(Path.Combine(arm, "class", "hwmon", "hwmon0", "name"), "cpu_thermal\n");
            Write(Path.Combine(arm, "class", "hwmon", "hwmon0", "temp1_input"), "47000\n");
            trees.Add(("arm", arm));
            trees.Add(("intel-low", intel));
            Write(Path.Combine(hw, "temp1_input"), "67000\n");
            trees.Add(("intel", intel));

            if (NativeTests.LoadedLibrary is null)
            {
                Console.WriteLine("SKIPPED native/managed temperature contract: native library not found.");
            }
            else
            {
                foreach (var (name, path) in trees)
                {
                    var managed = CpuTemperatureSelection.Read(path);
                    var source = new StringBuilder(64);
                    var status = NativeInterop.CpuTemperatureAt(path, out var celsius, source, source.Capacity);
                    Check(managed is not null && status == 1 && Math.Abs(celsius - managed.PackageCelsius) < 1e-9 && source.ToString() == managed.Source,
                        $"native and managed agree on '{name}' (managed {managed?.PackageCelsius} {managed?.Source}, native {celsius} {source})");
                }
                var none = new StringBuilder(64);
                Check(NativeInterop.CpuTemperatureAt(acpi, out _, none, none.Capacity) == 0, "native also refuses acpitz");
                Check(NativeInterop.CpuTemperatureAt(Tree("missing"), out _, none, none.Capacity) == 0, "native reports no sensor for a missing tree");
            }

            // Flatline guard for generic zones.
            var guard = new TemperatureFlatlineGuard();
            var tripped = false;
            for (var i = 0; i < TemperatureFlatlineGuard.Window + 5; i++) tripped |= guard.Observe(28.0, i % 2 == 0 ? 5 : 90);
            Check(tripped, "a zone constant at 28 C while load swings 5-90% is withheld");

            guard = new TemperatureFlatlineGuard();
            tripped = false;
            for (var i = 0; i < TemperatureFlatlineGuard.Window + 5; i++) tripped |= guard.Observe(40 + i * 0.5, i % 2 == 0 ? 5 : 90);
            Check(!tripped, "a zone that follows the load is trusted");

            guard = new TemperatureFlatlineGuard();
            tripped = false;
            for (var i = 0; i < TemperatureFlatlineGuard.Window + 5; i++) tripped |= guard.Observe(36.0, 8 + (i % 3));
            Check(!tripped, "an idle machine with a steady zone is not accused (load did not swing)");

            guard = new TemperatureFlatlineGuard();
            tripped = false;
            for (var i = 0; i < TemperatureFlatlineGuard.Window + 5; i++) tripped |= guard.Observe(28.0, null);
            Check(!tripped, "without load data nothing is concluded");

            guard = new TemperatureFlatlineGuard();
            Check(!guard.Observe(28.0, 5) && !guard.Observe(28.0, 90), "too few samples never trip the guard");
        }
        finally
        {
            try { Directory.Delete(root, true); } catch (IOException) { }
        }
        return (failures, checks);
    }
}
