import { memo, useMemo } from 'react';
import { ListTree } from 'lucide-react';
import type { ProcessInfo } from '../../../types/system';
import { formatMB } from '../../../lib/format';
import Panel from '../../common/Panel';
import { EmptyState } from '../../common/States';
import { rankProcesses } from './model';

/** The six heaviest processes: rank, name, size, and a bar relative to the heaviest. */
function TopProcessesPanel({ processes }: { processes: ProcessInfo[] }) {
  const ranked = useMemo(() => rankProcesses(processes, 6), [processes]);

  return (
    <Panel title="Top processes" icon={ListTree} hue="cpu" meta="by memory">
      {ranked.length === 0 ? (
        <EmptyState icon={ListTree} hue="cpu" title="No process data yet" />
      ) : (
        <ol className="space-y-3.5">
          {ranked.map(({ process: p, relative, shareOfAll }, i) => (
            <li key={p.pid} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
              <span className="num text-[12px] text-faint">{i + 1}</span>
              <span className="min-w-0 truncate text-[13px] font-medium text-ink" title={`${p.name} (PID ${p.pid})`}>{p.name}</span>
              <span className="num text-right text-[12px] text-muted">{formatMB(p.memoryMB, 1)} <span className="text-faint">· {shareOfAll.toFixed(1)}%</span></span>
              <span />
              <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-[var(--h)]" style={{ width: `${relative}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-[11px] text-faint">Percentages are each process's share of all process memory.</p>
    </Panel>
  );
}

export default memo(TopProcessesPanel);
