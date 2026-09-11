import { useMemo, useState } from 'react';
import { ListTree } from 'lucide-react';
import type { ProcessInfo } from '../types/system';
import Panel from './common/Panel';
import { Th, Td, Tr } from './common/Table';
import { EmptyState } from './common/States';
import SearchControl from './common/SearchControl';

interface ProcessTableProps {
  processes: ProcessInfo[];
  limit?: number;
  showSearch?: boolean;
}

export default function ProcessTable({ processes, limit, showSearch = true }: ProcessTableProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const base = !query.trim()
      ? processes
      : processes.filter(
          (p) =>
            p.name.toLowerCase().includes(query.toLowerCase()) || String(p.pid).includes(query)
        );
    return limit ? base.slice(0, limit) : base;
  }, [processes, query, limit]);

  return (
    <Panel
      title="Processes"
      meta={`by memory · ${processes.length}`}
      action={
        showSearch && (
          <SearchControl value={query} onChange={setQuery} placeholder="Filter by name or PID" />
        )
      }
      noPad
    >
      {processes.length === 0 ? (
        <EmptyState icon={ListTree} title="No process data yet" />
      ) : (
        <div className="max-h-[520px] overflow-y-auto scrollbar-thin">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-[var(--surface)]">
              <tr>
                <Th className="w-20">PID</Th>
                <Th>Name</Th>
                <Th className="text-right">Memory</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <Tr key={p.pid}>
                  <Td className="tabular text-[var(--text-muted)]">{p.pid}</Td>
                  <Td className="font-medium">{p.name}</Td>
                  <Td className="tabular text-right text-[var(--text-muted)]">{p.memoryMB} MB</Td>
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
  );
}
