import { memo } from 'react';
import { Cpu, Gpu, MemoryStick, type LucideIcon } from 'lucide-react';

import { useMetricHistory } from '../../../hooks/useMetricHistory';
import { formatMemory, formatNumber } from '../../../lib/format';
import { hueStyle, usageColor, type Hue } from '../../../lib/hues';

import Sparkline from '../../common/Sparkline';

import { Meter } from './parts';
import { topologyLabel, type CpuView, type GpuView, type MemoryView } from './model';

interface TileProps {
  icon: LucideIcon;
  hue: Hue;
  title: string;
  subtitle?: string | null;
  percent: number | null;
  pending?: boolean;
}

const Tile = memo(function Tile({ icon: Icon, hue, title, subtitle, percent, pending = false }: TileProps) {
  const history = useMetricHistory(percent ?? undefined);
  return (
    <section className="rounded-[var(--r-lg)] bg-surface-2 p-4" style={hueStyle(hue)} aria-label={title}>
      <header className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 shrink-0" style={{ color: 'var(--h)' }} aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-medium leading-tight">{title}</h3>
          {subtitle && <div className="truncate text-[11px] leading-tight text-faint">{subtitle}</div>}
        </div>
      </header>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="num text-[40px] font-semibold leading-none tracking-tight" style={{ color: percent == null ? 'var(--text-faint)' : undefined }}>
          {percent == null ? (pending ? '…' : '—') : <>{formatNumber(percent, 0)}<span className="ml-0.5 text-[18px] font-medium text-muted">%</span></>}
        </div>
        <div className="w-[45%] min-w-[80px]"><Sparkline points={history} color={usageColor(percent ?? undefined, hue)} height={36} /></div>
      </div>
      <div className="mt-3"><Meter percent={percent} hue={hue} label={`${title} utilization`} /></div>
    </section>
  );
});

interface SummaryTilesProps {
  cpu: CpuView;
  gpus: GpuView[];
  memory: MemoryView | null;
}

/** CPU | GPU | RAM: the one number each needs, always visible above the detail panels. */
function SummaryTiles({ cpu, gpus, memory }: SummaryTilesProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
      <Tile icon={Cpu} hue="cpu" title="CPU" subtitle={topologyLabel(cpu)} percent={cpu.usage} pending={cpu.status === 'measuring'} />
      {gpus.map((gpu) => (
        <Tile key={gpu.id} icon={Gpu} hue="gpu" title={gpus.length > 1 ? gpu.name : 'GPU'} subtitle={gpus.length > 1 ? gpu.kind : gpu.name} percent={gpu.usage} pending={gpu.status === 'live'} />
      ))}
      <Tile icon={MemoryStick} hue="ram" title="RAM" subtitle={memory ? `${formatMemory(memory.used)} of ${formatMemory(memory.total)}` : null} percent={memory?.percent ?? null} />
    </div>
  );
}

export default memo(SummaryTiles);
