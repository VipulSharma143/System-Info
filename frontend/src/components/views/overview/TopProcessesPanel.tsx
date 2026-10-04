import { memo } from 'react';
import { ListTree } from 'lucide-react';
import type { ProcessInfo } from '../../../types/system';
import { formatMB } from '../../../lib/format';
import Panel from '../../common/Panel';
import { EmptyState } from '../../common/States';

/** The heaviest processes, each with a bar relative to the heaviest one. */
function TopProcessesPanel({ processes }: { processes: ProcessInfo[] }) {
  const top = [...processes].sort((a, b) => b.memoryMB - a.memoryMB).slice(0, 6);
  const peak = top[0]?.memoryMB || 1;

  return (
    <Panel title="Top processes" icon={ListTree} hue="cpu" meta="by memory">
      {top.length === 0 ? (
        <EmptyState icon={ListTree} hue="cpu" title="No process data yet" />
      ) : (
        <ul className="space-y-3">
          {top.map((p) => (
            <li key={p.pid}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[13px] font-medium text-ink">{p.name}</span>
                <span className="num shrink-0 text-[12px] text-muted">{formatMB(p.memoryMB, 1)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-[var(--h)]" style={{ width: `${(p.memoryMB / peak) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default memo(TopProcessesPanel);
