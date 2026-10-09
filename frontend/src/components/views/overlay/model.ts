import type { Hue } from '../../../lib/hues';
import type { OverlayCpu, OverlayGpu, OverlayHistory, OverlayRam, OverlaySnapshot } from '../../../types/overlay';

/*
  Pure view-model for the live monitor: turns the engine's snapshot into tiles of display-ready strings.
  Rules that hold everywhere here:
    - null stays null until the very last step; a value that was not measured is never shown as 0;
    - every number that comes from a backend says which one (sourceLabel), so a wrong-looking value can be traced.
*/

export interface Stat {
  label: string;
  /** Display string, or null when the platform did not report it. */
  value: string | null;
  /** Why the value is missing, or extra context. */
  hint?: string | null;
}

export interface TileView {
  id: string;
  kind: 'cpu' | 'gpu' | 'ram';
  hue: Hue;
  title: string;
  subtitle: string;
  /** Headline load 0-100; null while unknown (first sample) or unmeasurable. */
  percent: number | null;
  stats: Stat[];
  history: number[];
  /** Backends behind this tile's numbers, in display form. */
  sources: string[];
  /** Explanations for anything missing. */
  notes: string[];
  /** CPU only: one cell per logical processor. */
  cores?: { index: number; percent: number | null; clock: string | null }[];
  /** GPU only: busiest engines, most loaded first. */
  engines?: { name: string; percent: number }[];
}

export type LiveState = 'live' | 'lagging' | 'stalled';

const GIB = 1024 ** 3;

export const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export function formatTemp(c: number | null): string | null {
  return num(c) ? `${Math.round(c)} °C` : null;
}
export function formatGiB(bytes: number | null, digits = 1): string | null {
  return num(bytes) ? `${(bytes / GIB).toFixed(digits)} GB` : null;
}
export function formatPair(used: number | null, total: number | null): string | null {
  if (!num(used)) return null;
  const u = (used / GIB).toFixed(1);
  return num(total) ? `${u} / ${(total / GIB).toFixed(1)} GB` : `${u} GB`;
}
export function formatClock(mhz: number | null): string | null {
  if (!num(mhz) || mhz <= 0) return null;
  return mhz >= 1000 ? `${(mhz / 1000).toFixed(2)} GHz` : `${Math.round(mhz)} MHz`;
}
export function formatPower(w: number | null, limit: number | null): string | null {
  if (!num(w)) return null;
  return num(limit) ? `${Math.round(w)} / ${Math.round(limit)} W` : `${Math.round(w)} W`;
}

const SOURCES: Record<string, string> = {
  nvml: 'NVIDIA driver',
  'windows-counters': 'Windows counters',
  sysfs: 'Linux driver files',
  hwmon: 'Linux sensors',
};
export function sourceLabel(code: string | null | undefined): string | null {
  return code ? (SOURCES[code] ?? code) : null;
}

/** The series without gaps; the sparkline draws what was measured. */
export function measured(series: (number | null)[] | undefined): number[] {
  return (series ?? []).filter(num);
}

/** How fresh the snapshot is: the engine samples twice a second, so a few seconds of silence means it stopped. */
export function liveState(snapshot: Pick<OverlaySnapshot, 'sampledAtMs' | 'intervalMs'> | null, now: number): LiveState {
  if (!snapshot) return 'stalled';
  const age = now - snapshot.sampledAtMs;
  // Idle heartbeat of the engine is 2 s, so allow for it before calling anything late.
  const slack = Math.max(snapshot.intervalMs, 2000);
  return age <= slack * 2 + 500 ? 'live' : age <= 10_000 ? 'lagging' : 'stalled';
}

function unique<T>(items: (T | null)[]): T[] {
  return [...new Set(items.filter((i): i is T => i !== null))];
}

export function cpuTile(cpu: OverlayCpu, history: OverlayHistory): TileView {
  const notes: string[] = [];
  if (!num(cpu.temperatureC) && cpu.temperatureNote) notes.push(cpu.temperatureNote);
  if (cpu.note) notes.push(cpu.note);
  const cores = cpu.logicalProcessors;
  return {
    id: 'cpu',
    kind: 'cpu',
    hue: 'cpu',
    title: 'CPU',
    subtitle: cores > 0 ? `${cores} logical processors` : 'Measuring…',
    percent: cpu.usagePercent,
    stats: [
      { label: 'Temperature', value: formatTemp(cpu.temperatureC), hint: cpu.temperatureNote },
      { label: 'Clock', value: formatClock(cpu.clockMhz) },
      { label: 'Busy cores', value: num(cpu.activeCores) && cores > 0 ? `${cpu.activeCores} of ${cores}` : null },
      { label: 'Busiest core', value: num(cpu.busiestCorePercent) ? `${Math.round(cpu.busiestCorePercent)}%` : null },
    ],
    history: measured(history.cpu),
    sources: unique([cpu.temperatureSource]),
    notes,
    cores: coreCells(cpu),
  };
}

export function gpuTile(gpu: OverlayGpu, history: OverlayHistory): TileView {
  const h = history.gpus[gpu.id];
  const notes = gpu.note ? [gpu.note] : [];
  const kind = gpu.kind === 'discrete' ? 'Discrete' : gpu.kind === 'integrated' ? 'Integrated' : null;
  return {
    id: gpu.id,
    kind: 'gpu',
    hue: 'gpu',
    title: gpu.name,
    subtitle: [kind, gpu.driverVersion ? `driver ${gpu.driverVersion}` : null].filter(Boolean).join(' · ') || 'Graphics adapter',
    percent: gpu.utilizationPercent,
    stats: [
      { label: 'Temperature', value: formatTemp(gpu.temperatureC), hint: gpu.source.temperature ? null : 'This adapter does not report a temperature here.' },
      { label: 'Video memory', value: formatPair(gpu.memoryUsedBytes, gpu.memoryTotalBytes) },
      { label: 'Core clock', value: formatClock(gpu.coreClockMhz) },
      { label: 'Power', value: formatPower(gpu.powerWatts, gpu.powerLimitWatts) },
    ],
    history: measured(h?.usage),
    sources: unique([sourceLabel(gpu.source.utilization), sourceLabel(gpu.source.temperature), sourceLabel(gpu.source.memory)]),
    notes,
    engines: gpu.engines,
  };
}

export function ramTile(ram: OverlayRam, history: OverlayHistory): TileView {
  const swap = num(ram.swapTotalBytes) && ram.swapTotalBytes > 0 ? formatPair(ram.swapUsedBytes, ram.swapTotalBytes) : null;
  return {
    id: 'ram',
    kind: 'ram',
    hue: 'ram',
    title: 'Memory',
    subtitle: formatPair(ram.usedBytes, ram.totalBytes) ?? 'Measuring…',
    percent: ram.usedPercent,
    stats: [
      { label: 'Available', value: formatGiB(ram.availableBytes) },
      { label: 'Cached', value: formatGiB(ram.cachedBytes) },
      { label: 'Swap / page file', value: swap },
    ],
    history: measured(history.ram),
    sources: [],
    notes: [],
  };
}

/** CPU first, then graphics (discrete before integrated), then memory — the order a game session reads in. */
export function buildTiles(s: OverlaySnapshot): TileView[] {
  const rank = (g: OverlayGpu) => (g.kind === 'discrete' ? 0 : g.kind === 'integrated' ? 2 : 1);
  const gpus = [...s.gpus].sort((a, b) => rank(a) - rank(b));
  return [cpuTile(s.cpu, s.history), ...gpus.map((g) => gpuTile(g, s.history)), ramTile(s.ram, s.history)];
}

/** Per-core strip data: load and clock per logical processor, unknown cores kept as null. */
export function coreCells(cpu: OverlayCpu): { index: number; percent: number | null; clock: string | null }[] {
  return cpu.cores.map((c, index) => ({ index, percent: num(c.u) ? c.u : null, clock: formatClock(c.mhz) }));
}

export function engineLabel(isa: number): string {
  return isa === 2 ? 'AVX2' : isa === 1 ? 'SSE2' : 'portable';
}

/** Problems the engine knows about, in plain words (a missing driver, counters that will not open). */
export function sourceProblems(s: OverlaySnapshot): string[] {
  const out: string[] = [];
  if (s.gpus.some((g) => g.vendor === 'NVIDIA') && s.engine.nvml !== 'ok') out.push(s.engine.nvml);
  if (s.platform === 'windows' && s.engine.gpuCounters !== 'ok') out.push(s.engine.gpuCounters);
  return out;
}
