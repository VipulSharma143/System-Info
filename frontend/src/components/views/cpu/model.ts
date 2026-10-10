import type { CoreKind, CpuCache, CpuCore, CpuDetail, CpuTimeBreakdown } from '../../../types/cpu';
import { formatMemory } from '../../../lib/format.ts';
import { num, sourceLabel } from '../overlay/model.ts';

/*
  Pure view-model for the CPU tab. Same rules as the live monitor's: null stays null until the last step, and a value
  that was not measured is never drawn as 0. Every explanation for a missing value is specific to the platform, so
  "Unavailable" is always followed by the reason when there is one.
*/

export const KIND_LABEL: Record<CoreKind, string> = { performance: 'P-core', efficiency: 'E-core', 'low-power': 'LP E-core' };

export interface CoreGroup {
  key: string;
  /** "Core 3" — the number the OS gives the core (matches the sensor labels). */
  label: string;
  kind: CoreKind | null;
  temperatureC: number | null;
  threads: CpuCore[];
  /** Mean load of the measured threads; null when none was measured. */
  usagePercent: number | null;
}

/** Threads grouped by physical core (SMT siblings together). Threads with no known core stand alone. */
export function groupCores(cores: CpuCore[]): CoreGroup[] {
  const groups = new Map<string, CoreGroup>();
  for (const c of cores) {
    const key = c.coreKey !== null ? `core-${c.coreKey}` : `thread-${c.index}`;
    let g = groups.get(key);
    if (!g) {
      // The Linux key is package * 100000 + core id; Windows numbers cores from 0. The remainder is the OS's own core number.
      const label = c.coreKey !== null ? `Core ${c.coreKey % 100000}` : `Thread ${c.index}`;
      g = { key, label, kind: c.kind, temperatureC: c.temperatureC, threads: [], usagePercent: null };
      groups.set(key, g);
    }
    g.threads.push(c);
  }
  for (const g of groups.values()) {
    const measured = g.threads.map((t) => t.usagePercent).filter(num);
    g.usagePercent = measured.length > 0 ? measured.reduce((a, b) => a + b, 0) / measured.length : null;
  }
  return [...groups.values()];
}

export function cacheLabel(c: Pick<CpuCache, 'level' | 'type'>): string {
  return c.type === 'Unified' ? `L${c.level} cache` : `L${c.level} ${c.type.toLowerCase()} cache`;
}

/** "160 KB" plus how it is split: "4 × 48 KB" when the copies match, "4 caches" when they differ. */
export function cacheValue(c: CpuCache): { total: string | null; split: string | null } {
  const total = num(c.totalBytes) ? formatMemory(c.totalBytes) : null;
  if (c.instances <= 1) return { total, split: null };
  return { total, split: num(c.perInstanceBytes) ? `${c.instances} × ${formatMemory(c.perInstanceBytes)}` : `${c.instances} caches` };
}

export function formatWatts(w: number | null): string | null {
  return num(w) ? `${w >= 100 ? Math.round(w) : w.toFixed(1)} W` : null;
}

export function formatRate(perSec: number | null): string | null {
  if (!num(perSec)) return null;
  return perSec >= 1_000_000 ? `${(perSec / 1_000_000).toFixed(2)} M/s` : perSec >= 1000 ? `${(perSec / 1000).toFixed(1)} k/s` : `${Math.round(perSec)}/s`;
}

export function formatCount(n: number | null): string | null {
  return num(n) ? Math.round(n).toLocaleString('en-US') : null;
}

const SOURCES: Record<string, string> = {
  cpufreq: 'Linux frequency driver',
  cpuid: 'the processor itself',
  'windows-power': 'Windows power information',
  registry: 'the Windows registry',
  rapl: 'the processor energy counter',
  'windows-energy-meter': 'Windows energy meter',
};
export function cpuSourceLabel(code: string | null): string | null {
  return code ? (SOURCES[code] ?? sourceLabel(code)) : null;
}

/** Why a clock or policy figure is missing, specific to the operating system. */
export function missingFrequencyReason(d: CpuDetail, field: 'max' | 'min' | 'base' | 'policy'): string {
  if (d.platform === 'windows') {
    if (field === 'max') return 'Windows does not report a maximum boost clock.';
    if (field === 'min') return 'Windows does not report a minimum clock.';
    if (field === 'policy') return 'Windows has no frequency governor to report.';
    return 'Windows did not report a base clock.';
  }
  return d.identity.virtualized
    ? 'A virtual machine does not see the host processor’s clock limits.'
    : 'This computer’s frequency driver does not expose it.';
}

export function describeCoreCounts(d: CpuDetail): string | null {
  const t = d.topology;
  if (!num(t.physicalCores) && !num(t.logicalProcessors)) return null;
  const parts: string[] = [];
  if (num(t.physicalCores)) parts.push(`${t.physicalCores} ${t.physicalCores === 1 ? 'core' : 'cores'}`);
  if (num(t.logicalProcessors)) parts.push(`${t.logicalProcessors} ${t.logicalProcessors === 1 ? 'thread' : 'threads'}`);
  return parts.join(' · ');
}

/** "6 P + 8 E", only for hybrid CPUs. */
export function describeHybrid(d: CpuDetail): string | null {
  const { performanceCores: p, efficiencyCores: e, lowPowerCores: lp } = d.topology;
  if (!num(p) || !num(e)) return null;
  return `${p} P + ${e} E${num(lp) ? ` + ${lp} LP` : ''}`;
}

export interface TimeSegment { key: string; label: string; percent: number; color: string }

/** Where processor time went, only the parts the platform reports, largest meaning first. Idle is drawn last. */
export function timeSegments(t: CpuTimeBreakdown): TimeSegment[] {
  const defs: [keyof CpuTimeBreakdown, string, string][] = [
    ['userPercent', 'Programs (user)', 'var(--hue-cpu)'],
    ['systemPercent', 'Operating system (kernel)', 'var(--hue-ram)'],
    ['irqPercent', 'Interrupts and drivers', 'var(--hue-net)'],
    ['iowaitPercent', 'Waiting for disk', 'var(--hue-disk)'],
    ['stealPercent', 'Taken by the host (VM)', 'var(--hue-power)'],
    ['idlePercent', 'Idle', 'var(--surface-3)'],
  ];
  return defs.flatMap(([key, label, color]) => {
    const v = t[key];
    return num(v) ? [{ key, label, percent: Math.max(0, Math.min(100, v)), color }] : [];
  });
}

/** Distinct, non-empty feature groups for the badges (the engine already filters to what the CPU and OS support). */
export function featureBadges(features: string[]): string[] {
  return [...new Set(features.filter(Boolean))];
}
