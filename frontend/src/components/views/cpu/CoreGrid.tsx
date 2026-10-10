import { memo, useMemo } from 'react';
import { Cpu } from 'lucide-react';

import type { CpuCore, CpuDetail } from '../../../types/cpu';
import Panel from '../../common/Panel';
import UsageBar from '../../common/UsageBar';
import { formatClock, formatTemp, num } from '../overlay/model';
import { groupCores, KIND_LABEL } from './model';

function ThreadRow({ core, label }: { core: CpuCore; label: string }) {
  return (
    <div className="grid grid-cols-[52px_1fr_62px] items-center gap-2 text-[12px]">
      <span className="text-faint">{label}</span>
      {num(core.usagePercent)
        ? <UsageBar percent={core.usagePercent} compact hue="cpu" hideValue />
        : <span className="h-1.5 rounded-full border border-dashed border-line" title="Not measured yet" />}
      <span className="num text-right text-ink" title={num(core.mhz) ? undefined : 'Clock not reported for this thread'}>
        {num(core.usagePercent) ? `${Math.round(core.usagePercent)}%` : '—'}
      </span>
    </div>
  );
}

/** Every physical core with its threads: load, clock, hybrid type and (where the hardware exposes it) temperature. */
function CoreGrid({ detail }: { detail: CpuDetail }) {
  const groups = useMemo(() => groupCores(detail.cores), [detail.cores]);
  const perCoreTemps = detail.cores.some((c) => num(c.temperatureC));

  return (
    <Panel title="Cores and threads" icon={Cpu} hue="cpu"
      meta={num(detail.live?.activeThreads) && detail.cores.length > 0 ? `${detail.live.activeThreads} of ${detail.cores.length} threads at 10% load or more` : undefined}>
      {groups.length === 0 ? (
        <p className="text-[12px] text-faint">Per-core load appears after the monitor’s second sample.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {groups.map((g) => (
            <div key={g.key} className="min-w-0 rounded-[var(--r-sm)] bg-surface-2 px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="num truncate text-[13px] font-semibold text-ink">{g.label}</span>
                <span className="flex shrink-0 items-center gap-2 text-[11px] text-faint">
                  {g.kind && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-muted">{KIND_LABEL[g.kind]}</span>}
                  {num(g.temperatureC) && <span className="num text-muted">{formatTemp(g.temperatureC)}</span>}
                </span>
              </div>
              <div className="mt-2.5 space-y-1.5">
                {g.threads.map((t, i) => <ThreadRow key={t.index} core={t} label={g.threads.length > 1 ? `Thread ${i + 1}` : 'Load'} />)}
              </div>
              {g.threads.some((t) => num(t.mhz)) && (
                <p className="num mt-2 text-[11px] text-faint">{g.threads.map((t) => formatClock(t.mhz) ?? '—').join(' · ')}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {groups.length > 0 && !perCoreTemps && (
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          {detail.sensorsNote ?? 'This hardware does not expose a temperature for each core.'}
        </p>
      )}
    </Panel>
  );
}

export default memo(CoreGrid);
