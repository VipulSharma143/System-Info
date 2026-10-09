/** The native monitor engine's snapshot (GET /api/overlay). A null number means "not measurable here" — never 0. */

export interface OverlayCore {
  u: number | null;
  mhz: number | null;
}

export interface OverlayCpu {
  usagePercent: number | null;
  temperatureC: number | null;
  temperatureSource: string | null;
  temperatureNote: string | null;
  clockMhz: number | null;
  logicalProcessors: number;
  busiestCorePercent: number | null;
  activeCores: number | null;
  cores: OverlayCore[];
  note: string | null;
}

export interface OverlayRam {
  totalBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  usedPercent: number | null;
  cachedBytes: number | null;
  swapTotalBytes: number | null;
  swapUsedBytes: number | null;
}

export interface OverlayGpu {
  id: string;
  name: string;
  luid: string | null;
  vendor: string | null;
  kind: 'discrete' | 'integrated' | null;
  pciAddress: string | null;
  driverVersion: string | null;
  utilizationPercent: number | null;
  temperatureC: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  memoryPercent: number | null;
  powerWatts: number | null;
  powerLimitWatts: number | null;
  coreClockMhz: number | null;
  memoryClockMhz: number | null;
  fanPercent: number | null;
  performanceState: string | null;
  engines: { name: string; percent: number }[];
  source: { utilization: string | null; temperature: string | null; memory: string | null };
  note: string | null;
}

export interface OverlayHistory {
  intervalMs: number;
  cpu: (number | null)[];
  cpuTemp: (number | null)[];
  ram: (number | null)[];
  gpus: Record<string, { usage: (number | null)[]; temp: (number | null)[]; memory: (number | null)[] }>;
}

export interface OverlaySnapshot {
  schema: number;
  seq: number;
  sampledAtMs: number;
  intervalMs: number;
  platform: 'windows' | 'linux';
  engine: { isa: number; asmDemotions: number; cycleMs: number; nvml: string; gpuCounters: string };
  cpu: OverlayCpu;
  ram: OverlayRam;
  gpus: OverlayGpu[];
  history: OverlayHistory;
}
