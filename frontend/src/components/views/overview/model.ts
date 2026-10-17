import type { SystemSnapshot } from '../../../types/system';
import type { ProcessInfo } from '../../../types/system';

/*
  What the Overview headline says. It only restates measurements already on screen (CPU, memory and the fullest drive
  against the app's usual 70 % / 90 % thresholds); it never claims to know why the machine is busy.
*/

export type OverallTone = 'ok' | 'warn' | 'critical';

export interface Driver {
  label: string;
  percent: number;
}

export interface OverallState {
  tone: OverallTone;
  headline: string;
  detail: string;
  /** The readings at or above the warning threshold, highest first. */
  drivers: Driver[];
}

const WARN = 70;
const CRITICAL = 90;

export function overallState(cpuPercent: number, ramPercent: number, fullestDrive: { name: string; percent: number } | null): OverallState {
  const readings: Driver[] = [
    { label: 'Processor', percent: cpuPercent },
    { label: 'Memory', percent: ramPercent },
    ...(fullestDrive ? [{ label: `Drive ${fullestDrive.name}`, percent: fullestDrive.percent }] : []),
  ];
  const drivers = readings.filter((r) => r.percent >= WARN).sort((a, b) => b.percent - a.percent);
  const peak = drivers[0]?.percent ?? 0;
  if (peak >= CRITICAL) {
    return { tone: 'critical', headline: 'Under heavy load', detail: `${drivers[0].label} is at ${drivers[0].percent.toFixed(0)}%.`, drivers };
  }
  if (peak >= WARN) {
    return { tone: 'warn', headline: 'Running warm', detail: `${drivers.map((d) => `${d.label} ${d.percent.toFixed(0)}%`).join(' · ')}.`, drivers };
  }
  return { tone: 'ok', headline: 'Running smoothly', detail: 'Processor, memory and storage are all within their normal range.', drivers };
}

export function fullestDrive(disks: SystemSnapshot['disks']): { name: string; percent: number; freeGB: number } | null {
  if (disks.length === 0) return null;
  const d = disks.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a));
  return { name: d.name, percent: d.usedPercent, freeGB: d.freeGB };
}

export interface RankedProcess {
  process: ProcessInfo;
  /** 0..100 of the heaviest process shown, so the bars read as shape. */
  relative: number;
  /** 0..100 of all process memory. */
  shareOfAll: number;
}

export function rankProcesses(processes: readonly ProcessInfo[], limit: number): RankedProcess[] {
  const total = processes.reduce((s, p) => s + p.memoryMB, 0);
  const top = [...processes].sort((a, b) => b.memoryMB - a.memoryMB || a.pid - b.pid).slice(0, limit);
  const peak = top[0]?.memoryMB || 1;
  return top.map((p) => ({ process: p, relative: (p.memoryMB / peak) * 100, shareOfAll: total > 0 ? (p.memoryMB / total) * 100 : 0 }));
}
