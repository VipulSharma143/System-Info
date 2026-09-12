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