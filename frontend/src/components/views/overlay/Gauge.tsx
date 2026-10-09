import { memo } from 'react';
import { usageColor, type Hue } from '../../../lib/hues';

interface GaugeProps {
  /** 0-100, or null while unknown. */
  percent: number | null;
  hue: Hue;
  size?: number;
  /** Words under the dash when there is no number. */
  unknown?: string;
}

const SWEEP = 0.75; // a 270° dial, open at the bottom

/** Dial gauge. The number is always printed, so colour is never the only signal; no number means a dash, never 0. */
function Gauge({ percent, hue, size = 132, unknown = 'Measuring…' }: GaugeProps) {
  const known = percent !== null;
  const value = known ? Math.min(100, Math.max(0, percent)) : 0;
  const stroke = 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = c * SWEEP;
  const common = { cx: size / 2, cy: size / 2, r, fill: 'none', strokeWidth: stroke, strokeLinecap: 'round' as const, transform: `rotate(135 ${size / 2} ${size / 2})` };

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={known ? `${Math.round(value)} percent` : unknown}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle {...common} stroke="var(--surface-3)" strokeDasharray={`${arc} ${c}`} />
        {known && value > 0 && (
          <circle {...common} stroke={usageColor(value, hue)} strokeDasharray={`${(arc * value) / 100} ${c}`} style={{ transition: 'stroke-dasharray 400ms ease, stroke 300ms' }} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {known ? (
          <span className="num text-[30px] font-semibold leading-none text-ink">
            {Math.round(value)}
            <span className="ml-0.5 text-[14px] font-medium text-muted">%</span>
          </span>
        ) : (
          <>
            <span className="num text-[26px] leading-none text-faint">—</span>
            <span className="mt-1 max-w-[80%] text-center text-[10.5px] leading-tight text-faint">{unknown}</span>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(Gauge);
