import { memo, useDeferredValue, useMemo, useState } from 'react';
import { ListTree } from 'lucide-react';
import type { ProcessInfo } from '../../types/system';
import { formatMB } from '../../lib/format';
import Panel from '../common/Panel';
import { Th } from '../common/Table';
import { EmptyState } from '../common/States';
import SearchControl from '../common/SearchControl';
import Segmented from '../common/Segmented';
import { StatTile, TileGrid, ViewContainer } from '../common/Primitives';
import { groupProcesses, matches, sortProcesses, totals, type SortKey, type ViewMode } from './processes/model';
import { GroupRow, ProcessRow } from './processes/ProcessRows';

const SORT_OPTIONS = [
  { value: 'memory', label: 'Memory' },
  { value: 'name', label: 'Name' },
  { value: 'pid', label: 'PID' },
] as const;

const MODE_OPTIONS = [
  { value: 'grouped', label: 'Grouped' },
  { value: 'all', label: 'All' },
] as const;

/*
  Reading order: what is on the machine (four numbers), then the list. By default same-named processes are
  grouped into one row (a browser's helpers are one line, not forty) and open to show each PID; "All" shows the
  flat list. Memory is the only per-process measurement the backend reports, so it is the only one shown.
*/
function ProcessesView({ processes }: { processes: ProcessInfo[] }) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('memory');
  const [mode, setMode] = useState<ViewMode>('grouped');
  // Typing stays instant; the (potentially long) table catches up without blocking input.
  const deferredQuery = useDeferredValue(query);

  const summary = useMemo(() => totals(processes), [processes]);
  const visible = useMemo(() => processes.filter((p) => matches(p, deferredQuery)), [processes, deferredQuery]);
  const groups = useMemo(() => (mode === 'grouped' ? groupProcesses(visible, sortKey) : []), [mode, visible, sortKey]);
  const flat = useMemo(() => (mode === 'all' ? sortProcesses(visible, sortKey) : []), [mode, visible, sortKey]);

  const peakMB = summary.heaviest?.memoryMB ?? 1;
  const groupedHeaviest = groups.reduce((m, g) => Math.max(m, g.memoryMB), 0) || 1;
  const barPeak = mode === 'grouped' ? groupedHeaviest : peakMB;
  const rowsShown = mode === 'grouped' ? groups.length : flat.length;

  return (
    <ViewContainer>
      <TileGrid cols={4}>
        <StatTile hue="cpu" label="Running processes" value={String(summary.count)} />
        <StatTile hue="ram" label="Memory held" value={(summary.memoryMB / 1024).toFixed(2)} unit="GB" detail="by all processes" />
        <StatTile hue="cpu" label="Heaviest process" value={summary.heaviest ? summary.heaviest.name : '—'} detail={summary.heaviest ? `${formatMB(summary.heaviest.memoryMB)} · PID ${summary.heaviest.pid}` : undefined} />
        <StatTile hue="ram" label="Top five hold" value={summary.topFiveShare === null ? '—' : summary.topFiveShare.toFixed(0)} unit={summary.topFiveShare === null ? undefined : '%'} detail="of process memory" />
      </TileGrid>

      <Panel
        title="Processes"
        icon={ListTree}
        hue="cpu"
        meta={mode === 'grouped' ? `${rowsShown} groups · ${visible.length} of ${processes.length} processes` : `${visible.length} of ${processes.length}`}
        noPad
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Segmented ariaLabel="Group processes" value={mode} onChange={setMode} options={MODE_OPTIONS} />
            <Segmented ariaLabel="Sort processes" value={sortKey} onChange={setSortKey} options={SORT_OPTIONS} />
            <SearchControl value={query} onChange={setQuery} placeholder="Filter by name or PID" />
          </div>
        }
      >
        {processes.length === 0 ? (
          <EmptyState icon={ListTree} hue="cpu" title="No process data yet" description="The list fills in as soon as the monitoring service reports." />
        ) : visible.length === 0 ? (
          <EmptyState icon={ListTree} hue="cpu" title={`Nothing matches “${deferredQuery}”`} description="Try part of the process name, or its PID." />
        ) : (
          <div className="max-h-[calc(100vh-420px)] min-h-[260px] overflow-y-auto">
            <table className="table-flush w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-[var(--surface)]">
                <tr>
                  <Th className="w-24">PID</Th>
                  <Th>Process</Th>
                  <Th className="hidden md:table-cell">Relative size</Th>
                  <Th className="hidden w-20 text-right sm:table-cell">Share</Th>
                  <Th className="w-28 text-right">Memory</Th>
                </tr>
              </thead>
              <tbody>
                {mode === 'grouped'
                  ? groups.map((g) => <GroupRow key={g.name} group={g} totalMB={summary.memoryMB} peakMB={barPeak} />)
                  : flat.map((p) => <ProcessRow key={p.pid} p={p} totalMB={summary.memoryMB} peakMB={barPeak} />)}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </ViewContainer>
  );
}

export default memo(ProcessesView);
