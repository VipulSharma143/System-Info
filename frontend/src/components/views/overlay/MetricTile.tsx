import { memo, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { useMetricHistory } from '../../../hooks/useMetricHistory';
import { formatNumber } from '../../../lib/format';
import { hueStyle, usageColor, type Hue } from '../../../lib/hues';

import Sparkline from '../../common/Sparkline';
import UsageBar from '../../common/UsageBar';

export interface TileStat {
  label: string;
  /** Pre-formatted value, or null/undefined when the platform does not report it (shown as an em dash, never as 0). */
  value: string | null | undefined;
  /** Colours the value when the reading is hot (temperature). */
  color?: string;
  /** Why a value is missing, shown on hover. */
  hint?: string | null;
}

interface MetricTileProps {
  icon: LucideIcon;
  hue: Hue;
  title: string;
  subtitle?: string | null;
  /** The headline utilisation. Null/undefined renders "—"; `pending` says a first reading is still on its way. */
  percent: number | null | undefined;
  pending?: boolean;
  stats: TileStat[];
}

/**
 * One compact monitoring tile: a single headline number, one bar, a short trend and a few secondary readings.
 * Deliberately no borders, nested cards or animation beyond the bar's width transition.
 */
function MetricTile({ icon: Icon, hue, title, subtitle, percent, pending = false, stats }: MetricTileProps) {
  const history = useMetricHistory(percent ?? undefined);
  const color = usageColor(percent ?? undefined, hue);

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
        <div className="w-[45%] min-w-[80px]"><Sparkline points={history} color={color} height={36} /></div>
      </div>

      <div className="mt-3">{percent != null ? <UsageBar percent={percent} hue={hue} compact hideValue /> : <div className="h-1.5 rounded-full bg-surface-3" />}</div>

      {stats.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
          {stats.map((stat) => (
            <Stat key={stat.label} {...stat} />
          ))}
        </dl>
      )}
    </section>
  );
}

function Stat({ label, value, color, hint }: TileStat): ReactNode {
  return (
    <div className="min-w-0" title={value == null ? (hint ?? 'Not reported') : undefined}>
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="num truncate text-[13px] font-medium" style={{ color: value == null ? 'var(--text-faint)' : color }}>{value ?? '—'}</dd>
    </div>
  );
}

export default memo(MetricTile);
