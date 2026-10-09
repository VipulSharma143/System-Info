import { memo, useState } from 'react';
import { ChevronDown, Cpu, MemoryStick, Monitor, type LucideIcon } from 'lucide-react';
import { hueStyle } from '../../../lib/hues';
import Sparkline from '../../common/Sparkline';
import { usageColor } from '../../../lib/hues';
import Gauge from './Gauge';
import { CoreStrip, EngineList } from './Details';
import type { TileView } from './model';

const ICONS: Record<TileView['kind'], LucideIcon> = { cpu: Cpu, gpu: Monitor, ram: MemoryStick };

/**
 * One live component (CPU, a GPU, memory): dial, trend, the readings that matter, which backend produced them,
 * and — outside compact mode — a details drawer. Takes only plain data, so memo() keeps untouched tiles still.
 */
function Tile({ tile, compact }: { tile: TileView; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[tile.kind];
  const hasDetails = !compact && ((tile.cores?.length ?? 0) > 0 || tile.kind === 'gpu');
  const known = tile.stats.filter((s) => s.value !== null);
  const missing = tile.stats.filter((s) => s.value === null);

  return (
    <section style={hueStyle(tile.hue)} className="panel min-w-0 p-5">
      <header className="flex items-center gap-2.5">
        <span className="glyph"><Icon className="h-4 w-4" strokeWidth={2} /></span>
        <div className="min-w-0">
          <h2 className="num truncate text-[15px] font-semibold text-ink" title={tile.title}>{tile.title}</h2>
          <p className="truncate text-[12px] text-faint">{tile.subtitle}</p>
        </div>
      </header>

      <div className="mt-4 flex items-center gap-5">
        <Gauge percent={tile.percent} hue={tile.hue} size={compact ? 108 : 132} unknown={tile.kind === 'gpu' ? 'Not reported' : 'Measuring…'} />
        <div className="min-w-0 flex-1">
          <div className="h-[58px]"><Sparkline points={tile.history} color={usageColor(tile.percent ?? 0, tile.hue)} height={58} /></div>
          <p className="mt-1 text-[11px] text-faint">Last minute</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2">
        {known.map((s) => (
          <div key={s.label} className="min-w-0 rounded-[var(--r-sm)] bg-surface-2 px-3 py-2">
            <dt className="text-[11px] text-faint">{s.label}</dt>
            <dd className="num truncate text-[14px] font-semibold text-ink">{s.value}</dd>
          </div>
        ))}
        {missing.map((s) => (
          <div key={s.label} className="min-w-0 rounded-[var(--r-sm)] border border-dashed border-line px-3 py-2" title={s.hint ?? undefined}>
            <dt className="text-[11px] text-faint">{s.label}</dt>
            <dd className="text-[13px] text-faint">Not reported</dd>
          </div>
        ))}
      </dl>

      {tile.notes.map((n) => (
        <p key={n} className="mt-3 text-[12px] leading-relaxed text-muted">{n}</p>
      ))}

      {(tile.sources.length > 0) && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
          <span>Read from</span>
          {tile.sources.map((s) => <span key={s} className="rounded-full bg-surface-2 px-2 py-0.5 text-muted">{s}</span>)}
        </p>
      )}

      {hasDetails && (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className="mt-4 flex w-full items-center justify-between rounded-[var(--r-sm)] px-1 py-1 text-[12px] font-medium text-muted hover:text-ink">
            {tile.kind === 'cpu' ? 'Each processor' : 'Busiest engines'}
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && <div className="mt-2">{tile.kind === 'cpu' ? <CoreStrip cores={tile.cores ?? []} /> : <EngineList engines={tile.engines ?? []} />}</div>}
        </>
      )}
    </section>
  );
}

export default memo(Tile);
