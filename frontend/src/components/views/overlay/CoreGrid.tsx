import { memo } from 'react';

import { formatNumber } from '../../../lib/format';
import type { CpuCoreReading } from '../../../types/system';

import UsageBar from '../../common/UsageBar';

function Core({ core }: { core: CpuCoreReading }) {
  const detail = [
    core.clockMhz != null ? `${formatNumber(core.clockMhz, 0)} MHz` : null,
    core.temperatureC != null ? `${formatNumber(core.temperatureC, 0)} °C` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="min-w-0 rounded-[var(--r-sm)] bg-surface-2 px-3 py-2.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px]">
        <span className="font-medium text-ink">Core {core.index}</span>
        <span className="truncate text-faint">{detail || ' '}</span>
      </div>
      {core.usagePercent == null ? <div className="h-2.5 rounded-full bg-surface-3" /> : <UsageBar percent={core.usagePercent} hue="cpu" compact />}
    </div>
  );
}

/** One cell per logical processor, whatever their number. */
function CoreGrid({ cores }: { cores: CpuCoreReading[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4">
      {cores.map((core) => <Core key={core.index} core={core} />)}
    </div>
  );
}

export default memo(CoreGrid);
