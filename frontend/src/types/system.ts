export interface RamInfo {
  totalMB: number;
usedMB: number;
availableMB: number;
usedPercent: number;
}

export interface CpuInfo {
usedPercent: number;
}

export interface ProcessInfo {
pid: number;
name: string;
memoryMB: number;
}

export interface DiskInfo {
name: string;
volumeLabel: string;
driveType: string;
totalGB: number;
freeGB: number;
usedGB: number;
usedPercent: number;
}

export interface NetworkInfo {
iface: string;
rxKBps: number;
txKBps: number;
}

// Mirrors BatteryInfo (Interface/ISystemInfoProvider.cs). Every numeric/string
// field is nullable because C#'s System.Text.Json serializes a record's null
// properties as JSON null — on a desktop (or Windows, until implemented),
// available is false and every other field comes through as null, not 0/"".
export interface BatteryInfo {
available: boolean;
status: string | null;
capacityPercent: number | null;
cycleCount: number | null;
cycleCountNote: string | null;
designCapacityMah: number | null;
fullCapacityMah: number | null;
nowCapacityMah: number | null;
healthPercent: number | null;
voltageNow: number | null;
powerWatts: number | null;
model: string | null;
manufacturer: string | null;
note: string | null;
// "mAh" on Linux (sysfs charge_* files) or "mWh" on Windows (the battery
// class driver reports energy, never charge). The capacity fields above
// are named *Mah for backwards compatibility with the existing contract,
// so the UI must read this to label them correctly rather than assuming.
capacityUnit: string | null;
}

// Shape returned by /api/system/info — static, fetched once, not polled.
export interface SystemIdentification {
osDescription: string;
osArchitecture: string;
processArchitecture: string;
frameworkDescription: string;
machineName: string;
cpuModel: string | null;
// True physical CPU core count (Win32_Processor.NumberOfCores on Windows,
// /proc/cpuinfo grouped by socket on Linux — see WindowsSystemInfoProvider
// / LinuxSystemInfoProvider's GetSystemIdentity()). Distinct from
// logicalProcessors below, which counts threads, not cores — the backend
// previously conflated the two under a field also called "coreCount"; this
// replaces that field, it is not the same value.
physicalCores: number | null;
logicalProcessors: number;
appVersion: string;
// Extended identity (Win32_ComputerSystem/Win32_BIOS/Win32_OperatingSystem
// on Windows). Null wherever the underlying query is unavailable — show
// "Unavailable" in the UI, never a fabricated value.
manufacturer: string | null;
model: string | null;
biosVersion: string | null;
windowsEdition: string | null;
windowsBuild: string | null;
lastBootTime: string | null;
uptimeSeconds: number | null;
}

// One sample of a single GPU engine's utilization. Engines are reported
// individually (3D, Copy, VideoDecode, ...) rather than summed into one
// number — see the backend's GpuInfo doc comment for why.
export interface GpuEngineUsage {
instanceName: string;
usagePercent: number;
}

// One detected display adapter — a laptop can report more than one
// (integrated + discrete), so this is always an array. Every field is
// nullable; a null field means "Windows didn't expose this", not zero.
export interface GpuInfo {
name: string | null;
videoProcessor: string | null;
adapterMemoryBytes: number | null;
driverVersion: string | null;
driverDate: string | null;
status: string | null;
resolutionWidth: number | null;
resolutionHeight: number | null;
refreshRateHz: number | null;
engineUsage: GpuEngineUsage[] | null;
note: string | null;
}

// Shape returned by /api/system/all
export interface SystemSnapshot {
ram: RamInfo;
cpu: CpuInfo;
processes: ProcessInfo[];
disks: DiskInfo[];
network: NetworkInfo[];
battery: BatteryInfo;
}

// ---------------------------------------------------------------------------
// RAM page models. Three separate endpoints, three separate shapes — physical
// DIMM data and health counters are deliberately NOT folded into RamDetails.
// Every nullable field means "the platform did not report it": render
// "Not reported", never 0.
// ---------------------------------------------------------------------------

// GET /api/system/ram — runtime memory state (bytes).
export interface RamDetails {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;

  freeBytes: number | null;
  cachedBytes: number | null;
  buffersBytes: number | null;

  // Linux swap / Windows page file.
  swapTotalBytes: number | null;
  swapUsedBytes: number | null;

  commitLimitBytes: number | null;
  commitUsedBytes: number | null;

  usedPercent: number;

  source: 'native' | 'managed-fallback';
  note: string | null;
}

// One populated physical module. Empty slots are never listed.
export interface MemoryModule {
  manufacturer: string | null;
  partNumber: string | null;
  serialNumber: string | null;
  locator: string | null;
  bankLocator: string | null;
  formFactor: string | null;
  memoryType: string | null;
  capacityBytes: number | null;
  speedMTs: number | null;
  configuredSpeedMTs: number | null;
  dataWidthBits: number | null;
  totalWidthBits: number | null;
  rank: number | null;
  eccCapable: boolean | null;
}

export interface MemoryHardwareSummary {
  installedBytes: number | null;
  moduleCount: number | null;
  slotCount: number | null;
  emptySlots: number | null;
  maxCapacityBytes: number | null;
  maxModuleCapacityBytes: number | null;
  memoryType: string | null;
  formFactor: string | null;
  configuredSpeedMTs: number | null;
  maxSpeedMTs: number | null;
  // Stays null until a platform provider can prove it; the UI shows "Unknown".
  channelMode: string | null;
  eccSupport: boolean | null;
}

// GET /api/system/memory/hardware. available=false is a normal outcome
// (no access to firmware tables, unsupported platform), not an error.
export interface MemoryHardwareInfo {
  available: boolean;
  summary: MemoryHardwareSummary | null;
  modules: MemoryModule[];
  source: 'smbios' | 'unavailable';
  note: string | null;
}

// GET /api/system/memory/health. ECC capability, ECC enabled and live error
// counters are three different facts with three different sources.
export interface MemoryHealth {
  eccSupport: boolean | null;
  eccEnabled: boolean | null;
  correctedErrors: number | null;
  uncorrectedErrors: number | null;
  source: 'edac' | 'unavailable';
  note: string | null;
}
