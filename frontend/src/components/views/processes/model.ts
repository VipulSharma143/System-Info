import type { ProcessInfo } from '../../../types/system';

/*
  Pure view-model for the Processes page. The backend reports one row per process (pid, name, resident memory in MB);
  nothing else is measured per process, so nothing else is shown — no per-process CPU figure is invented.
*/

export type SortKey = 'memory' | 'name' | 'pid';
export type ViewMode = 'grouped' | 'all';

export interface ProcessGroup {
  name: string;
  count: number;
  memoryMB: number;
  /** Members, heaviest first. */
  members: ProcessInfo[];
}

export interface ProcessTotals {
  count: number;
  memoryMB: number;
  heaviest: ProcessInfo | null;
  /** The five heaviest processes' combined share of all process memory (0..100), or null with no memory reported. */
  topFiveShare: number | null;
}

export function totals(processes: readonly ProcessInfo[]): ProcessTotals {
  let memoryMB = 0;
  let heaviest: ProcessInfo | null = null;
  for (const p of processes) {
    memoryMB += p.memoryMB;
    if (!heaviest || p.memoryMB > heaviest.memoryMB) heaviest = p;
  }
  const topFive = [...processes].sort((a, b) => b.memoryMB - a.memoryMB).slice(0, 5).reduce((s, p) => s + p.memoryMB, 0);
  return { count: processes.length, memoryMB, heaviest, topFiveShare: memoryMB > 0 ? (topFive / memoryMB) * 100 : null };
}

export function matches(p: Pick<ProcessInfo, 'name' | 'pid'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || p.name.toLowerCase().includes(q) || String(p.pid).includes(q);
}

export function share(memoryMB: number, totalMB: number): number {
  return totalMB > 0 ? Math.min(100, (memoryMB / totalMB) * 100) : 0;
}

const SORTERS: Record<SortKey, (a: ProcessInfo, b: ProcessInfo) => number> = {
  memory: (a, b) => b.memoryMB - a.memoryMB || a.pid - b.pid,
  name: (a, b) => a.name.localeCompare(b.name) || a.pid - b.pid,
  pid: (a, b) => a.pid - b.pid,
};

export function sortProcesses(list: readonly ProcessInfo[], key: SortKey): ProcessInfo[] {
  return [...list].sort(SORTERS[key]);
}

/** Processes with the same name (a browser's helpers, for example) become one row with a count and a combined size. */
export function groupProcesses(list: readonly ProcessInfo[], key: SortKey): ProcessGroup[] {
  const byName = new Map<string, ProcessInfo[]>();
  for (const p of list) {
    const existing = byName.get(p.name);
    if (existing) existing.push(p);
    else byName.set(p.name, [p]);
  }
  const groups: ProcessGroup[] = [...byName.entries()].map(([name, members]) => ({
    name,
    count: members.length,
    memoryMB: members.reduce((s, m) => s + m.memoryMB, 0),
    members: sortProcesses(members, 'memory'),
  }));
  const sorters: Record<SortKey, (a: ProcessGroup, b: ProcessGroup) => number> = {
    memory: (a, b) => b.memoryMB - a.memoryMB || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    pid: (a, b) => a.members[0].pid - b.members[0].pid,
  };
  return groups.sort(sorters[key]);
}
