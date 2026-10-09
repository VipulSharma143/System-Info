import { memo } from 'react';
import { usageColor } from '../../../lib/hues';
import type { TileView } from './model';

/** One bar per logical processor; unknown cores are drawn hollow, never as 0. */
export const CoreStrip = memo(function CoreStrip({ cores }: { cores: NonNullable<TileView['cores']> }) {
  if (cores.length === 0) return <p className="text-[12px] text-faint">Per-processor load appears after the second sample.</p>;
  return (
    <div>
      <div className="flex h-20 items-end gap-[3px]" role="img" aria-label="Load of each logical processor">
        {cores.map((c) => (
          <div
            key={c.index}
            className="min-w-[3px] flex-1 rounded-[3px]"
            style={{
              height: c.percent === null ? '8%' : `${Math.max(6, c.percent)}%`,
              background: c.percent === null ? 'transparent' : usageColor(c.percent, 'cpu'),
              border: c.percent === null ? '1px dashed var(--line)' : undefined,
              transition: 'height 400ms ease',
            }}
            title={`Processor ${c.index} · ${c.percent === null ? 'not measured' : `${Math.round(c.percent)}%`}${c.clock ? ` · ${c.clock}` : ''}`}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-faint">Each bar is one logical processor (hover for its clock).</p>
    </div>
  );
});

/** The busiest GPU engines (3D, Copy, Video…), as Windows names them. */
export const EngineList = memo(function EngineList({ engines }: { engines: NonNullable<TileView['engines']> }) {
  if (engines.length === 0) return <p className="text-[12px] text-faint">No engine is doing measurable work right now.</p>;
  return (
    <ul className="space-y-2">
      {engines.map((e) => (
        <li key={e.name} className="grid grid-cols-[84px_1fr_44px] items-center gap-3 text-[12px]">
          <span className="truncate text-muted">{e.name}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full" style={{ width: `${Math.min(100, e.percent)}%`, background: usageColor(e.percent, 'gpu') }} />
          </span>
          <span className="num text-right text-ink">{Math.round(e.percent)}%</span>
        </li>
      ))}
    </ul>
  );
});
