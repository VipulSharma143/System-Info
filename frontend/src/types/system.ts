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

// Shape returned by /api/system/all
export interface SystemSnapshot {
  ram: RamInfo;
  cpu: CpuInfo;
  processes: ProcessInfo[];
  disks: DiskInfo[];
  network: NetworkInfo[];
}
