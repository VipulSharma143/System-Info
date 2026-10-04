import { memo, useDeferredValue, useMemo, useState } from 'react';
import { ListTree } from 'lucide-react';
import type { ProcessInfo } from '../../types/system';
import { formatMB } from '../../lib/format';
import Panel from '../common/Panel';
import { Th, Td, Tr } from '../common/Table';
import { EmptyState } from '../common/States';
import SearchControl from '../common/SearchControl';
import Segmented from '../common/Segmented';
import { StatTile, TileGrid, ViewContainer } from '../common/Primitives';

type SortKey = 'memory' | 'name' | 'pid';

const SORT_OPTIONS = [
  { value: 'memory', label: 'Memory' },
  { value: 'name', label: 'Name' },
  { value: 'pid', label: 'PID' },
] as const;

const SORTERS: Record<SortKey, (a: ProcessInfo, b: ProcessInfo) => number> = {
  memory: (a, b) => b.memoryMB - a.memoryMB,
  name: (a, b) => a.name.localeCompare(b.name),
  pid: (a, b) => a.pid - b.pid,
};

// Each row carries a bar relative to the heaviest process, so memory reads as shape, not just digits.
const ProcessRow = memo(function ProcessRow({ p, peak }: { p: ProcessInfo; peak: number }) {
  return (
    <Tr>
      <Td className="num py-2 text-faint">{p.pid}</Td>
      <Td className="py-2 font-medium">{p.name}</Td>
      <Td className="hidden w-[34%] py-2 md:table-cell">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-[var(--h)]" style={{ width: `${(p.memoryMB / peak) * 100}%` }} />
        </div>
      </Td>
      <Td className="num py-2 text-right text-muted">{formatMB(p.memoryMB)}</Td>
    </Tr>
  );
});

function ProcessesView({ processes }: { processes: ProcessInfo[] }) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('memory');
  // Typing stays instant; the (potentially long) table catches up without blocking input.
  const deferredQuery = useDeferredValue(query);

  const { filtered, totalMemoryMB, heaviest } = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const base = q ? processes.filter((p) => p.name.toLowerCase().includes(q) || String(p.pid).includes(q)) : processes;
    let total = 0;
    let top: ProcessInfo | null = null;
    for (const p of processes) {
      total += p.memoryMB;
      if (!top || p.memoryMB > top.memoryMB) top = p;
    }
    return { filtered: [...base].sort(SORTERS[sortKey]), totalMemoryMB: total, heaviest: top };
  }, [processes, deferredQuery, sortKey]);

  const peak = heaviest?.memoryMB || 1;

  return (
    <ViewContainer>
      <TileGrid cols={3}>
        <StatTile hue="cpu" label="Running processes" value={String(processes.length)} />
        <StatTile hue="ram" label="Memory held by processes" value={(totalMemoryMB / 1024).toFixed(2)} unit="GB" />
        <StatTile hue="cpu" label="Heaviest process" value={heaviest ? heaviest.name : '—'} detail={heaviest ? formatMB(heaviest.memoryMB) : undefined} />
      </TileGrid>

      <Panel
        title="All processes"
        icon={ListTree}
        hue="cpu"
        meta={`${filtered.length} of ${processes.length}`}
        noPad
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Segmented ariaLabel="Sort processes" value={sortKey} onChange={setSortKey} options={SORT_OPTIONS} />
            <SearchControl value={query} onChange={setQuery} placeholder="Filter by name or PID" />
          </div>
        }
      >
        {processes.length === 0 ? (
          <EmptyState icon={ListTree} hue="cpu" title="No process data yet" description="The list fills in as soon as the monitoring service reports." />
        ) : filtered.length === 0 ? (
          <EmptyState icon={ListTree} hue="cpu" title={`Nothing matches “${deferredQuery}”`} description="Try part of the process name, or its PID." />
        ) : (
          <div className="max-h-[calc(100vh-360px)] min-h-[240px] overflow-y-auto">
            <table className="table-flush w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-[var(--surface)]">
                <tr>
                  <Th className="w-24">PID</Th>
                  <Th>Process</Th>
                  <Th className="hidden md:table-cell">Share of heaviest</Th>
                  <Th className="w-32 text-right">Memory</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <ProcessRow key={p.pid} p={p} peak={peak} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </ViewContainer>
  );
}

export default memo(ProcessesView);
