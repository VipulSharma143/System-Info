import type { ReactNode } from 'react';
import { hueStyle, usageColor, type Hue } from '../../lib/hues';
import Figure from './Figure';

/*
  Small shared building blocks. Rules applied everywhere:
    - tiles sit on the `panel` surface; the hue only tints a figure, a dot or a bar
    - label 12px muted · figure in the display face · detail 12px faint
*/

/* ------------------------------------------------------------------ */
/* StatTile — compact label / figure / detail block.                   */
/* ------------------------------------------------------------------ */

interface StatTileProps {
  label: string;
  value: ReactNode;
  unit?: string;
  detail?: ReactNode;
  /** Switches the figure to warn / critical colour when usage is high. */
  percentForColor?: number;
  hue?: Hue;
}

export function StatTile({ label, value, unit, detail, percentForColor, hue = 'neutral' }: StatTileProps) {
  return (
    <div className="panel min-w-0 rounded-[var(--r-md)] px-4 py-3.5" style={hueStyle(hue)}>
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: 'var(--h)' }} />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2">
        <Figure
          size="sm"
          value={value}
          unit={unit}
          color={percentForColor !== undefined && percentForColor >= 70 ? usageColor(percentForColor) : undefined}
        />
      </div>
      {detail && <div className="mt-1.5 truncate text-[12px] text-faint">{detail}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* InfoRow — label ........ value, the spec-sheet row.                 */
/* ------------------------------------------------------------------ */

export function InfoRow({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3 py-[7px]">
      <span className="shrink-0 text-[12px] text-muted">{label}</span>
      <span aria-hidden="true" className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-line-strong" />
      <span className="min-w-0 truncate text-right text-[13px] font-medium text-ink">
        {value}
        {hint && <span className="ml-1.5 text-[11px] font-normal text-faint">{hint}</span>}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badge — status pill. Always a dot AND a word, never colour alone.   */
/* ------------------------------------------------------------------ */

export type BadgeTone = 'ok' | 'warn' | 'critical' | 'info' | 'muted';

const TONE: Record<BadgeTone, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  critical: 'var(--critical)',
  info: 'var(--info)',
  muted: 'var(--text-muted)',
};

export function Badge({ tone = 'muted', children, dot = true }: { tone?: BadgeTone; children: ReactNode; dot?: boolean }) {
  const color = TONE[tone];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-4"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Unavailable — the honest empty value. Never a fake 0.               */
/* ------------------------------------------------------------------ */

export function Unavailable({ reason }: { reason?: string | null }) {
  return (
    <span className="text-[13px] font-normal text-faint" title={reason ?? undefined}>
      Unavailable
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Layout helpers                                                      */
/* ------------------------------------------------------------------ */

/** Responsive tile grid: columns collapse as the window narrows, so nothing overflows sideways. */
export function TileGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const colClass =
    cols === 2 ? 'sm:grid-cols-2' : cols === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2 xl:grid-cols-4';
  return <div className={`grid grid-cols-1 gap-3.5 ${colClass}`}>{children}</div>;
}

/** Page padding and vertical rhythm shared by every view. */
export function ViewContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1280px] space-y-3.5 px-6 pb-8 pt-1 max-md:px-4">{children}</div>;
}
