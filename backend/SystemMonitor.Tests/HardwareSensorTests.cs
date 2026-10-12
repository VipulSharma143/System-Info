using SystemMonitor.Api.Services;

// Drive, motherboard and memory-module sensors: the Linux sysfs reader against a fake /sys tree, the shared rules, and the service.
static class HardwareSensorTests
{
    static void Put(string path, string text) { Directory.CreateDirectory(Path.GetDirectoryName(path)!); File.WriteAllText(path, text); }

    static string Hw(string root, int n, string name, params (string File, string Text)[] files)
    {
        var dir = Path.Combine(root, "class", "hwmon", "hwmon" + n);
        Put(Path.Combine(dir, "name"), name + "\n");
        foreach (var (f, t) in files) Put(Path.Combine(dir, f), t + "\n");
        return dir;
    }

    static void Link(string hwmonDir, string target) => Directory.CreateSymbolicLink(Path.Combine(hwmonDir, "device"), target);

    public static (int Failures, int Checks) Run()
    {
        int failures = 0, checks = 0;
        void Check(bool ok, string what) { checks++; if (!ok) { failures++; Console.WriteLine($"FAIL: {what}"); } }
        const string T = HardwareSensorSelection.Temperature, V = HardwareSensorSelection.Voltage, F = HardwareSensorSelection.Fan;

        // ---- the shared rules
        Check(HardwareSensorSelection.Plausible(T, 41.8) && !HardwareSensorSelection.Plausible(T, 0) && !HardwareSensorSelection.Plausible(T, -127) && !HardwareSensorSelection.Plausible(T, 150) && !HardwareSensorSelection.Plausible(T, null) && !HardwareSensorSelection.Plausible(T, double.NaN), "a temperature must be above 0 and below 150");
        Check(HardwareSensorSelection.Plausible(V, 1.008) && !HardwareSensorSelection.Plausible(V, 0) && !HardwareSensorSelection.Plausible(V, 400), "a voltage of 0 (no rail) or hundreds of volts is not real");
        Check(HardwareSensorSelection.Plausible(F, 0) && HardwareSensorSelection.Plausible(F, 1200) && !HardwareSensorSelection.Plausible(F, -1) && !HardwareSensorSelection.Plausible(F, 99999), "a stopped fan (0 RPM) is real; negative or absurd speeds are not");
        Check(!HardwareSensorSelection.Plausible("other", 5), "an unknown kind is never plausible");

        var lib = HardwareSensorSelection.FromLibrary([
            new("Temperature", "Temperature", 41.84), new("Temperature", "Warning Temperature", 70), new("Temperature", "Critical Temperature", 85),
            new("Temperature", "Temperature #1", 0), new("Temperature", "Temperature #2", double.NaN), new("Level", "Remaining Life", 98),
            new("Voltage", "Vcore", 1.0084), new("Voltage", "VIN3", 0), new("Fan", "Chassis Fan", 900), new("Fan", "Unused Fan", 0), new("Data", "Data Read", 12)]);
        Check(lib.Select(s => s.Label).SequenceEqual(["Temperature", "Vcore", "Chassis Fan", "Unused Fan"]), "library: only plausible temperature/voltage/fan readings, thresholds and other quantities are not listed, temperature first");
        Check(lib[0].Value == 41.8 && lib[0].HighC == 70 && lib[0].CriticalC == 85 && lib[1].HighC is null && lib[1].Value == 1.008, "library: limits attach to the temperature only, values are rounded sensibly");
        Check(HardwareSensorSelection.FromLibrary([]).Count == 0, "no sensors in, none out");

        // ---- Linux reader against a fake /sys
        var sys = Path.Combine(Path.GetTempPath(), "sysinfo-hwmon-" + Guid.NewGuid().ToString("N"));
        try
        {
            Hw(sys, 0, "coretemp", ("temp1_input", "55000"));                                       // CPU: another page's data
            var nvme = Hw(sys, 1, "nvme", ("temp1_input", "41800"), ("temp1_label", "Composite"), ("temp1_max", "84800"), ("temp1_crit", "89800"),
                ("temp2_input", "39000"), ("temp2_label", "Sensor 1"));
            Put(Path.Combine(sys, "devices", "nvme0", "model"), "Samsung SSD 980 PRO 1TB   \n");
            Link(nvme, Path.Combine(sys, "devices", "nvme0"));
            var sata = Hw(sys, 2, "drivetemp", ("temp1_input", "34000"), ("temp1_max", "60000"));
            Put(Path.Combine(sys, "devices", "scsi0", "vendor"), "ATA     \n"); Put(Path.Combine(sys, "devices", "scsi0", "model"), "CT500MX500SSD1\n");
            Link(sata, Path.Combine(sys, "devices", "scsi0"));
            var dimm = Hw(sys, 3, "spd5118", ("temp1_input", "36200"));
            Directory.CreateDirectory(Path.Combine(sys, "devices", "1-0050"));
            Link(dimm, Path.Combine(sys, "devices", "1-0050"));
            Hw(sys, 4, "nct6798", ("temp1_input", "38000"), ("temp1_label", "SYSTIN"), ("temp2_input", "0"), ("temp3_input", "-127000"),
                ("in0_input", "1008"), ("in0_label", "Vcore"), ("in1_input", "0"), ("fan1_input", "1200"), ("fan1_label", "CPU Fan"), ("fan2_input", "0"));
            Hw(sys, 5, "amdgpu", ("temp1_input", "61000"));                                        // GPU: another page's data
            Hw(sys, 6, "BAT0", ("in0_input", "12000"));                                            // battery: not a board chip
            Hw(sys, 7, "acpitz", ("temp1_input", "27800"));
            Hw(sys, 8, "nvme", ("temp1_input", "not a number"));                                   // unreadable value: no sensors, no device
            Hw(sys, 10, "it8688", ("fan1_input", "800"), ("temp1_input", "31000"));                // hwmon10 must sort after hwmon4, not before

            var r = LinuxHwmonReader.Read(sys, 123);
            Check(r.Ready && r.Platform == "linux" && r.Source == "sysfs hwmon" && r.SampledAtMs == 123, "reader reports its platform and source");
            Check(r.Drives.Devices.Count == 2 && r.Drives.Note is null, "two drives (NVMe and SATA); the unreadable NVMe entry is skipped");
            var n = r.Drives.Devices.Single(d => d.Detail == "NVMe");
            Check(n.Name == "Samsung SSD 980 PRO 1TB" && n.Id == "hwmon1", "NVMe drive named from its model, padding trimmed");
            Check(n.Sensors.Count == 2 && n.Sensors[0].Label == "Composite" && n.Sensors[0].Value == 41.8 && n.Sensors[0].HighC == 84.8 && n.Sensors[0].CriticalC == 89.8, "NVMe composite temperature with its high and critical limits");
            Check(n.Sensors[1].Label == "Sensor 1" && n.Sensors[1].Value == 39.0 && n.Sensors[1].HighC is null, "NVMe second sensor, no limits when the kernel gives none");
            var s = r.Drives.Devices.Single(d => d.Detail == "SATA");
            Check(s.Name == "CT500MX500SSD1" && s.Sensors.Single().Value == 34.0 && s.Sensors.Single().HighC == 60.0, "SATA drive: the generic 'ATA' vendor is dropped, limit kept");
            Check(r.Memory.Devices.Count == 1 && r.Memory.Devices[0].Name == "Memory module (SMBus 0x50)" && r.Memory.Devices[0].Detail == "DDR5 SPD hub" && r.Memory.Devices[0].Sensors.Single().Value == 36.2, "DDR5 module with its SMBus address and temperature");
            Check(r.Board.Devices.Select(d => d.Id).SequenceEqual(["hwmon4", "hwmon7", "hwmon10"]), "board chips in numeric hwmon order, CPU / GPU / battery chips left out");
            var chip = r.Board.Devices[0];
            Check(chip.Name == "nct6798" && chip.Detail == "Motherboard sensor chip", "board chip is named after its driver");
            Check(chip.Sensors.Select(x => x.Label).SequenceEqual(["SYSTIN", "Vcore", "CPU Fan", "Fan 2"]), "unconnected temperature inputs and the 0 V rail are dropped; temperature, voltage, fan order; unlabelled fan gets a default name");
            Check(chip.Sensors[1].Value == 1.008 && chip.Sensors[1].Unit == "V" && chip.Sensors[2].Value == 1200 && chip.Sensors[3].Value == 0 && chip.Sensors[3].Unit == "RPM", "millivolts become volts; a stopped fan still shows 0 RPM");
            Check(r.Board.Devices[1].Name == "acpitz" && r.Board.Devices[1].Detail == "Firmware thermal zone", "ACPI thermal zone is described as firmware, not a chip");
            Check(!r.Drives.Devices.Concat(r.Board.Devices).Concat(r.Memory.Devices).Any(d => d.Name is "coretemp" or "amdgpu" or "BAT0"), "CPU, GPU and battery sensors do not appear here");
        }
        finally { try { Directory.Delete(sys, true); } catch { } }

        // ---- nothing there: say why, never an empty silence
        var empty = Path.Combine(Path.GetTempPath(), "sysinfo-hwmon-empty-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(empty, "class", "hwmon"));
        try
        {
            var r = LinuxHwmonReader.Read(empty, 1);
            Check(r.Drives.Devices.Count == 0 && r.Drives.Note == HardwareSensorSelection.DrivesNoneLinux && r.Board.Note == HardwareSensorSelection.BoardNoneLinux && r.Memory.Note == HardwareSensorSelection.MemoryNoneLinux, "with no sensors every category explains how to get them");
            Check(r.Drives.Note!.Contains("drivetemp") && r.Memory.Note!.Contains("spd5118"), "the notes name the kernel module that is missing");
        }
        finally { try { Directory.Delete(empty, true); } catch { } }
        var none = LinuxHwmonReader.Read(Path.Combine(Path.GetTempPath(), "does-not-exist-" + Guid.NewGuid().ToString("N")), 1);
        Check(none.Ready && none.Drives.Devices.Count == 0 && none.Drives.Note is not null, "a system without /sys/class/hwmon does not throw");

        // ---- the service
        var now = new DateTime(2026, 10, 12, 9, 0, 0, DateTimeKind.Utc);
        var tree = Path.Combine(Path.GetTempPath(), "sysinfo-hwmon-svc-" + Guid.NewGuid().ToString("N"));
        try
        {
            Hw(tree, 0, "nct6798", ("fan1_input", "1000"));
            var svc = new HardwareSensorService(null, tree, () => now);
            var first = svc.Read();
            Check(first.Board.Devices.Count == 1, "the service reads sysfs when no library source is registered");
            Hw(tree, 1, "acpitz", ("temp1_input", "30000"));
            Check(ReferenceEquals(svc.Read(), first) && svc.Read().Board.Devices.Count == 1, "a read within a second reuses the last one");
            now = now.AddSeconds(2);
            Check(svc.Read().Board.Devices.Count == 2, "after a second the files are read again");
        }
        finally { try { Directory.Delete(tree, true); } catch { } }

        var starting = new HardwareSensorService(new FakeSource(null)).Read();
        Check(!starting.Ready && starting.Drives.Note == HardwareSensorSelection.Reading && starting.Drives.Devices.Count == 0, "while a library is still opening the answer is 'not ready', not 'no sensors'");
        var ready = new HardwareSensors(true, "windows", "LibreHardwareMonitor", 5, new HwCategory([], "x"), new HwCategory([], null), new HwCategory([], null));
        Check(ReferenceEquals(new HardwareSensorService(new FakeSource(ready)).Read(), ready), "a registered library source is used as is");

        return (failures, checks);
    }

    sealed class FakeSource(HardwareSensors? value) : IHardwareSensorSource
    {
        public HardwareSensors? Read() => value;
    }
}
