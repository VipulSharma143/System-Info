import { memo } from 'react';

import { formatNumber } from '../../../lib/format';
import { usageColor } from '../../../lib/hues';
import type { CpuCoreReading } from '../../../types/system';

import { groupCores } from './model';
import { SubHeading } from './parts';

interface CellProps {
  index: number;
  percent: number | null;
  temperature: number | null;
}

/** Takes only primitives, so a cell re-renders only when its own number changed. */
const Cell = memo(function Cell({ index, percent, temperature }: CellProps) {
  const label = `C${String(index + 1).padStart(2, '0')}`;
  const width = percent == null ? 0 : Math.min(100, Math.max(0, percent));
  return (
    <div className="min-w-0 rounded-[var(--r-sm)] bg-surface-2 px-2 py-1.5" title={temperature != null ? `${label} · ${formatNumber(temperature, 0)} °C` : label}>
      <div className="flex items-baseline justify-between gap-1 text-[11px]">
        <span className="text-faint">{label}</span>
        <span className="num font-medium" style={{ color: percent == null ? 'var(--text-faint)' : undefined }}>{percent == null ? '—' : `${formatNumber(percent, 0)}%`}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: usageColor(percent ?? undefined, 'cpu') }} />
      </div>
    </div>
  );
});

/** One dense grid per core type (hybrid CPUs) or a single grid; built entirely from the readings it is given. */
function CoreGrid({ cores }: { cores: CpuCoreReading[] }) {
  const groups = groupCores(cores);
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.key} className="space-y-1.5">
          {group.key !== 'all' && <SubHeading>{group.label} · {group.cores.length} threads</SubHeading>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-1.5">
            {group.cores.map((core) => <Cell key={core.index} index={core.index} percent={core.usagePercent} temperature={core.temperatureC} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

export default memo(CoreGrid);
