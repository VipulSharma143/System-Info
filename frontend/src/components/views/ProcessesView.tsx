import { useMemo, useState } from 'react';
import { ListTree } from 'lucide-react';
import type { ProcessInfo } from '../../types/system';
import Panel from '../common/Panel';
import { Th, Td, Tr } from '../common/Table';
import { EmptyState } from '../common/States';
import SearchControl from '../common/SearchControl';
import Segmented from '../common/Segmented';
import { StatTile, TileGrid, ViewContainer } from '../common/Primitives';

interface ProcessesViewProps {
  processes: ProcessInfo[];
}

type SortKey = 'memory' | 'name' | 'pid';

const SORT_OPTIONS = [
  { value: 'memory', label: 'Memory' },
  { value: 'name', label: 'Name' },
  { value: 'pid', label: 'PID' },
] as const;

/*
  Processes is a dense table by design — it's the one page where a long
  scroll is the correct answer. Rows stay compact (py-1.5) so as many fit
  on screen as possible, and the header stays sticky so column meaning is
  never lost mid-scroll.
*/

function formatMemory(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`;
}

export default function ProcessesView({ processes }: ProcessesViewProps) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('memory');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = !q
      ? processes
      : processes.filter(
          (p) => p.name.toLowerCase().includes(q) || String(p.pid).includes(q)
        );

    const sorted = [...base];
    if (sortKey === 'memory') sorted.sort((a, b) => b.memoryMB - a.memoryMB);
    else if (sortKey === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else sorted.sort((a, b) => a.pid - b.pid);
    return sorted;
  }, [processes, query, sortKey]);

  const totalMemoryMB = processes.reduce((s, p) => s + p.memoryMB, 0);
  const heaviest =
    processes.length > 0
      ? processes.reduce((a, b) => (b.memoryMB > a.memoryMB ? b : a))
      : null;

  return (
    <ViewContainer>
      <TileGrid cols={3}>
        <StatTile label="Running processes" value={String(processes.length)} />
        <StatTile
          label="Memory in use by processes"
          value={(totalMemoryMB / 1024).toFixed(2)}
          unit="GB"
        />
        <StatTile
          label="Heaviest process"
          value={heaviest ? heaviest.name : '—'}
          detail={heaviest ? formatMemory(heaviest.memoryMB) : undefined}
        />
      </TileGrid>

      <Panel
        title="Processes"
        meta={`${filtered.length} of ${processes.length}`}
        action={
          <div className="flex items-center gap-2">
            <span className="hidden text-[12px] text-[var(--text-faint)] lg:inline">Sort by</span>
            <Segmented
              ariaLabel="Sort processes"
              value={sortKey}
              onChange={setSortKey}
              options={SORT_OPTIONS}
            />
            <SearchControl value={query} onChange={setQuery} placeholder="Filter by name or PID" />
          </div>
        }
        noPad
      >
        {processes.length === 0 ? (
          <EmptyState icon={ListTree} title="No process data yet" />
        ) : (
          <div className="max-h-[calc(100vh-320px)] min-h-[240px] overflow-y-auto scrollbar-thin">
            <table className="table-flush w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-[var(--surface)] shadow-[0_1px_0_var(--border)]">
                <tr>
                  <Th className="w-28">PID</Th>
                  <Th>Process</Th>
                  <Th className="w-32 text-right">Memory</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <Tr key={p.pid}>
                    <Td className="tabular py-1.5 text-[var(--text-faint)]">{p.pid}</Td>
                    <Td className="py-1.5 font-medium">{p.name}</Td>
                    <Td className="tabular py-1.5 text-right text-[var(--text-muted)]">
                      {formatMemory(p.memoryMB)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <EmptyState title={`No processes match "${query}"`} icon={ListTree} />
            )}
          </div>
        )}
      </Panel>
    </ViewContainer>
  );
}
