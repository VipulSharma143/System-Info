import { memo } from 'react';
import { HardDrive } from 'lucide-react';
import { hueStyle } from '../../../lib/hues';
import { useJsonResource } from '../../../hooks/useJsonResource';
import type { HardwareSensors } from '../../../types/sensors';
import UsageBar from '../../common/UsageBar';
import { driveTileState } from './driveModel';

const POLL_MS = 5000;

/**
 * SSD / NVMe / HDD temperatures next to the CPU, GPU and memory tiles: drive name, its hottest reading, every sensor it
 * reports and the limits it gives. Polls only while the Overlay page is open (the drive sensors are read on demand).
 */
function DrivesTile({ active, compact }: { active: boolean; compact: boolean }) {
  const sensors = useJsonResource<HardwareSensors>('/api/system/sensors', { active, intervalMs: POLL_MS });
  const state = driveTileState(sensors.data);

  return (
    <section style={hueStyle('disk')} className="panel min-w-0 p-5">
      <header className="flex items-center gap-2.5">
        <span className="glyph"><HardDrive className="h-4 w-4" strokeWidth={2} /></span>
        <div className="min-w-0">
          <h2 className="num truncate text-[15px] font-semibold text-ink">Drives</h2>
          <p className="truncate text-[12px] text-faint">
            {state.kind === 'ready' ? `${state.drives.length} reporting a temperature` : 'Temperature sensors'}
          </p>
        </div>
      </header>

      {state.kind === 'loading' && (
        <p className="mt-4 text-[12px] text-faint">{sensors.error ? 'Drive temperatures could not be loaded. The rest of this page is unaffected.' : 'Reading drive sensors…'}</p>
      )}
      {state.kind === 'empty' && <p className="mt-4 text-[12px] leading-relaxed text-muted">{state.note}</p>}

      {state.kind === 'ready' && (
        <>
          <ul className="mt-4 space-y-3">
            {state.drives.map((d) => (
              <li key={d.id} className="min-w-0 rounded-[var(--r-sm)] bg-surface-2 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[13px] font-medium text-ink" title={d.name}>{d.name}</span>
                  <span className="num shrink-0 text-[15px] font-semibold text-ink">{d.hottest ?? '—'}</span>
                </div>
                {d.detail && <div className="truncate text-[11px] text-faint">{d.detail}</div>}
                {!compact && (
                  <ul className="mt-2 space-y-2">
                    {d.readings.map((r, i) => (
                      <li key={`${r.label}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[12px]">
                        <span className="truncate text-muted">{r.label}</span>
                        <span className="num text-right font-medium text-ink">{r.value}</span>
                        {r.percent !== null && <div className="col-span-2"><UsageBar percent={r.percent} compact hue="disk" hideValue /></div>}
                        {r.limits && <span className="col-span-2 text-[11px] text-faint">{r.limits}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
            <span>Read from</span>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-muted">{state.source}</span>
          </p>
        </>
      )}
    </section>
  );
}

export default memo(DrivesTile);
