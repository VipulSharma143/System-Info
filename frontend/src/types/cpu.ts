/** GET /api/system/cpu/detail. A null number means "not measurable on this machine" — never 0. */

export interface CpuIdentity {
  model: string | null;
  vendor: string | null;
  architecture: string | null;
  family: number | null;
  modelId: number | null;
  stepping: number | null;
  virtualized: boolean | null;
}

export interface CpuTopology {
  packages: number | null;
  physicalCores: number | null;
  logicalProcessors: number | null;
  performanceCores: number | null;
  efficiencyCores: number | null;
  lowPowerCores: number | null;
}

export type CoreKind = 'performance' | 'efficiency' | 'low-power';

export interface CpuLive {
  usagePercent: number | null;
  temperatureC: number | null;
  temperatureSource: string | null;
  temperatureNote: string | null;
  clockMhz: number | null;
  highestClockMhz: number | null;
  lowestClockMhz: number | null;
  /** Logical processors at 10% load or more. */
  activeThreads: number | null;
  busiestThreadPercent: number | null;
  note: string | null;
}

export interface CpuCore {
  index: number;
  /** Shared by the SMT siblings of one physical core; null when the OS does not say. */
  coreKey: number | null;
  kind: CoreKind | null;
  usagePercent: number | null;
  mhz: number | null;
  temperatureC: number | null;
}

export interface CpuFrequency {
  baseMhz: number | null;
  baseSource: string | null;
  maxMhz: number | null;
  maxSource: string | null;
  minMhz: number | null;
  policyMaxMhz: number | null;
  governor: string | null;
  driver: string | null;
  preference: string | null;
  boost: boolean | null;
}

export interface CpuCache {
  level: number;
  type: 'Data' | 'Instruction' | 'Unified' | string;
  totalBytes: number | null;
  instances: number;
  /** Null when the instances differ in size (hybrid CPUs). */
  perInstanceBytes: number | null;
}

export interface CpuSensor {
  label: string | null;
  kind: 'package' | 'core' | 'ccd' | 'other' | string | null;
  coreKey: number | null;
  tempC: number | null;
  highC: number | null;
  criticalC: number | null;
}

export interface CpuPower {
  packageWatts: number | null;
  limit1Watts: number | null;
  limit2Watts: number | null;
  source: string | null;
  note: string | null;
}

export interface CpuTimeBreakdown {
  userPercent: number | null;
  systemPercent: number | null;
  idlePercent: number | null;
  iowaitPercent: number | null;
  irqPercent: number | null;
  stealPercent: number | null;
}

export interface CpuActivity {
  load1: number | null;
  load5: number | null;
  load15: number | null;
  runnableTasks: number | null;
  queueLength: number | null;
  threads: number | null;
  processes: number | null;
  contextSwitchesPerSec: number | null;
  interruptsPerSec: number | null;
  systemCallsPerSec: number | null;
}

export interface CpuDetail {
  platform: 'windows' | 'linux';
  /** When the live numbers were sampled (drives the Live / Slow / Stopped state). */
  sampledAtMs: number;
  intervalMs: number;
  detailSampledAtMs: number;
  identity: CpuIdentity;
  topology: CpuTopology;
  /** Null until the live monitor has produced its first sample. */
  live: CpuLive | null;
  cores: CpuCore[];
  frequency: CpuFrequency;
  caches: CpuCache[];
  features: string[];
  sensors: CpuSensor[];
  sensorsNote: string | null;
  power: CpuPower;
  throttle: { packageEvents: number | null; coreEvents: number | null };
  time: CpuTimeBreakdown;
  activity: CpuActivity;
  history: { intervalMs: number; usage: (number | null)[]; temperature: (number | null)[] };
}
