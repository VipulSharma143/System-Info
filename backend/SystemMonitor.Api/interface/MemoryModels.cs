namespace SystemMonitor.Api.Interface;

// Physical RAM + memory health models. Deliberately NOT part of RamDetails (runtime state):
// DIMM metadata is static firmware data and health counters are a different source again.
// Every optional field is null when the platform did not report it — never a fabricated 0.

/// <summary>One populated physical memory module (SMBIOS Type 17). Empty slots are never listed.</summary>
public record MemoryModule(
    string? Manufacturer,
    string? PartNumber,
    string? SerialNumber,
    string? Locator,
    string? BankLocator,
    string? FormFactor,
    string? MemoryType,
    long? CapacityBytes,
    long? SpeedMTs,              // rated speed, mega-transfers per second (not MHz)
    long? ConfiguredSpeedMTs,
    int? DataWidthBits,
    int? TotalWidthBits,
    int? Rank,
    bool? EccCapable);           // platform-reported capability only; says nothing about live ECC state

/// <summary>Platform-level view of the installed memory (SMBIOS Type 16 + derived-from-modules facts).</summary>
public record MemoryHardwareSummary(
    long? InstalledBytes,
    int? ModuleCount,
    int? SlotCount,
    int? EmptySlots,             // SlotCount - ModuleCount, only when both are known
    long? MaxCapacityBytes,
    long? MaxModuleCapacityBytes,
    string? MemoryType,          // what the modules report; "DDR3 / DDR4" when they differ
    string? FormFactor,
    long? ConfiguredSpeedMTs,    // only when every module reports the same configured speed
    long? MaxSpeedMTs,           // highest rated speed any module reports
    string? ChannelMode,         // always null for now: installed DIMM count does not prove channel mode
    bool? EccSupport);

/// <summary>
/// Result of the physical-memory read. <see cref="Available"/> = false is a normal, expected outcome
/// (no permission to read firmware tables, unsupported platform) — not an HTTP error.
/// </summary>
public record MemoryHardwareInfo(
    bool Available,
    MemoryHardwareSummary? Summary,
    IReadOnlyList<MemoryModule> Modules,
    string Source,               // "smbios" or "unavailable"
    string? Note);

/// <summary>
/// ECC capability vs enabled vs live error counters are three different facts.
/// Capability comes from firmware; counters only from the OS (Linux EDAC). EccEnabled has no
/// reliable source yet, so it stays null rather than being guessed.
/// </summary>
public record MemoryHealth(
    bool? EccSupport,
    bool? EccEnabled,
    long? CorrectedErrors,
    long? UncorrectedErrors,
    string Source,               // "edac" or "unavailable"
    string? Note);
