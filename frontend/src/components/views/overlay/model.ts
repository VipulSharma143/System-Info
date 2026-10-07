import type { CpuCoreReading, CpuDetail, GpuAdapter, GpuLiveReading, RamDetails } from '../../../types/system';

/*
  Pure derivations for the overlay: every number shown comes from a backend field or simple arithmetic on two of
  them. A missing input yields null (rendered as "Not reported"), never a default.
*/

export type LoadState = 'Idle' | 'Light' | 'Moderate' | 'Heavy' | 'Saturated';

/** A logical processor counts as active above this share of busy time. */
export const ACTIVE_CORE_THRESHOLD = 10;

export function loadState(percent: number | null | undefined): LoadState | null {
  if (percent == null) return null;
  return percent < 10 ? 'Idle' : percent < 40 ? 'Light' : percent < 70 ? 'Moderate' : percent < 90 ? 'Heavy' : 'Saturated';
}

export const hotness = (celsius: number | null | undefined) => (celsius == null ? undefined : celsius >= 85 ? 'var(--critical)' : celsius >= 75 ? 'var(--warn)' : undefined);

export interface CoreGroup {
  key: 'performance' | 'efficiency' | 'all';
  label: string;
  cores: CpuCoreReading[];
}

/** One group per core type on a hybrid CPU, a single group otherwise. Built from the readings, never from a CPU model. */
export function groupCores(cores: CpuCoreReading[]): CoreGroup[] {
  const typed = cores.length > 0 && cores.every((c) => c.coreType != null);
  if (!typed) return cores.length ? [{ key: 'all', label: 'Logical processors', cores }] : [];
  const performance = cores.filter((c) => c.coreType === 'performance');
  const efficiency = cores.filter((c) => c.coreType === 'efficiency');
  return [
    { key: 'performance' as const, label: 'Performance cores', cores: performance },
    { key: 'efficiency' as const, label: 'Efficiency cores', cores: efficiency },
  ].filter((g) => g.cores.length > 0);
}

export interface CpuView {
  usage: number | null;
  load: LoadState | null;
  logical: number | null;
  physical: number | null;
  hybrid: boolean;
  performanceCores: number | null;
  efficiencyCores: number | null;
  performanceThreads: number | null;
  efficiencyThreads: number | null;
  /** Logical processors measured so far, and how many of them are above the activity threshold. */
  measured: number;
  active: number | null;
  packageTemperature: number | null;
  hottestCore: number | null;
  systemTemperature: number | null;
  power: number | null;
  status: 'live' | 'measuring' | 'unavailable';
}

export function cpuView(cpu: CpuDetail | null, fallbackPhysical: number | null, fallbackLogical: number | null): CpuView {
  const layout = cpu?.layout ?? null;
  const cores = cpu?.cores ?? [];
  const measuredCores = cores.filter((c) => c.usagePercent != null);
  const coreTemps = cores.map((c) => c.temperatureC).filter((t): t is number => t != null);
  return {
    usage: cpu?.totalUsagePercent ?? null,
    load: loadState(cpu?.totalUsagePercent),
    logical: layout?.logicalProcessors ?? (cores.length || fallbackLogical),
    physical: layout?.physicalCores ?? fallbackPhysical,
    hybrid: layout?.hybrid === true,
    performanceCores: layout?.performanceCores ?? null,
    efficiencyCores: layout?.efficiencyCores ?? null,
    performanceThreads: layout?.performanceThreads ?? null,
    efficiencyThreads: layout?.efficiencyThreads ?? null,
    measured: measuredCores.length,
    active: measuredCores.length ? measuredCores.filter((c) => (c.usagePercent ?? 0) >= ACTIVE_CORE_THRESHOLD).length : null,
    packageTemperature: cpu?.packageTemperatureC ?? null,
    hottestCore: coreTemps.length ? Math.max(...coreTemps) : null,
    systemTemperature: cpu?.systemTemperatureC ?? null,
    power: cpu?.powerWatts ?? null,
    status: cpu === null ? 'unavailable' : cpu.totalUsagePercent == null ? 'measuring' : 'live',
  };
}

export interface GpuView {
  id: string;
  name: string;
  vendor: string | null;
  kind: 'Integrated' | 'Discrete' | null;
  usage: number | null;
  vramUsedBytes: number | null;
  vramTotalBytes: number | null;
  vramFreeBytes: number | null;
  vramPercent: number | null;
  sharedUsedBytes: number | null;
  temperature: number | null;
  power: number | null;
  powerLimit: number | null;
  status: 'live' | 'no-live-data';
  note: string | null;
}

export function gpuView(adapter: GpuAdapter, reading: GpuLiveReading | undefined): GpuView {
  const total = reading?.memoryTotalBytes ?? adapter.dedicatedMemoryBytes;
  const used = reading?.memoryUsedBytes ?? null;
  return {
    id: adapter.id,
    name: adapter.name,
    vendor: adapter.vendor,
    kind: adapter.integrated === null ? null : adapter.integrated ? 'Integrated' : 'Discrete',
    usage: reading?.utilizationPercent ?? null,
    vramUsedBytes: used,
    vramTotalBytes: total ?? null,
    vramFreeBytes: used != null && total != null && total >= used ? total - used : null,
    vramPercent: reading?.memoryUsagePercent ?? (used != null && total ? Math.min(100, (used / total) * 100) : null),
    sharedUsedBytes: reading?.sharedMemoryUsedBytes ?? null,
    temperature: reading?.temperatureC ?? null,
    power: reading?.powerWatts ?? null,
    powerLimit: reading?.powerLimitWatts ?? null,
    status: reading ? 'live' : 'no-live-data',
    note: reading?.note ?? null,
  };
}

export interface MemoryView {
  total: number;
  used: number;
  available: number;
  free: number | null;
  cached: number | null;
  buffers: number | null;
  percent: number;
  swapTotal: number | null;
  swapUsed: number | null;
  swapFree: number | null;
  swapPercent: number | null;
}

export function memoryView(ram: RamDetails | null): MemoryView | null {
  if (!ram) return null;
  const { swapTotalBytes: swapTotal, swapUsedBytes: swapUsed } = ram;
  const hasSwap = swapTotal != null && swapTotal > 0;
  return {
    total: ram.totalBytes,
    used: ram.usedBytes,
    available: ram.availableBytes,
    free: ram.freeBytes,
    cached: ram.cachedBytes,
    buffers: ram.buffersBytes,
    percent: ram.usedPercent,
    swapTotal,
    swapUsed,
    swapFree: hasSwap && swapUsed != null && swapTotal >= swapUsed ? swapTotal - swapUsed : null,
    swapPercent: hasSwap && swapUsed != null ? Math.min(100, (swapUsed / swapTotal) * 100) : null,
  };
}

/** "6P + 8E · 14 cores · 20 threads", or "8 cores · 16 threads" when the split is not reported. */
export function topologyLabel(cpu: CpuView): string | null {
  if (cpu.logical == null) return null;
  const parts: string[] = [];
  if (cpu.hybrid && cpu.performanceCores != null && cpu.efficiencyCores != null) parts.push(`${cpu.performanceCores}P + ${cpu.efficiencyCores}E`);
  if (cpu.physical != null) parts.push(`${cpu.physical} cores`);
  parts.push(`${cpu.logical} threads`);
  return parts.join(' · ');
}
