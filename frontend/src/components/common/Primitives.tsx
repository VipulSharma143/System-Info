import type { ReactNode } from 'react';
import { severity } from '../../lib/format';

/*
  Shared primitives for the redesigned dashboard.

  Everything here exists so sections stop inventing their own spacing,
  type sizes, and card shapes. The rules, applied everywhere:
    - card padding: px-4 py-3  (compact) / p-4 (panel body)
    - grid gap:     gap-3
    - radius:       rounded-md
    - label text:   12px muted
    - value text:   20px (tile) / 26px (hero) tabular
    - detail text:  12px faint
  A component sized to its content, not to fill a column.
*/

const SEVERITY_COLOR: Record<string, string> = {
  ok: 'var(--accent)',
  warn: 'var(--warn)',
  critical: 'var(--critical)',
};

export function severityColor(percent: number | undefined) {
  return percent === undefined ? 'var(--text-muted)' : SEVERITY_COLOR[severity(percent)];
}

/* ------------------------------------------------------------------ */
/* StatTile — the compact building block for dense metric grids.       */
/* Deliberately shorter than the old MetricCard: one line of label,    */
/* one line of value, one optional line of detail. Nothing stretches.  */
/* ------------------------------------------------------------------ */

interface StatTileProps {
  label: string;
  value: ReactNode;
  unit?: string;
  detail?: ReactNode;
  percentForColor?: number;
  accent?: string;
}

export function StatTile({
  label,
  value,
  unit,
  detail,
  percentForColor,
  accent,
}: StatTileProps) {
  const color = accent ?? severityColor(percentForColor);

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="flex items-center gap-1.5">
        {percentForColor !== undefined && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="truncate text-[12px] text-[var(--text-muted)]">{label}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="tabular text-[20px] font-medium leading-none text-[var(--text)]">
          {value}
        </span>
        {unit && <span className="text-[12px] text-[var(--text-muted)]">{unit}</span>}
      </div>
      {detail && (
        <div className="mt-1 truncate text-[12px] text-[var(--text-faint)]">{detail}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* InfoRow — label/value pair for two-column information layouts.      */
/* Used by Battery details and the System page so both read the same.  */
/* ------------------------------------------------------------------ */

export function InfoRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] py-2 last:border-b-0">
      <span className="shrink-0 text-[12px] text-[var(--text-muted)]">{label}</span>
      <span className="tabular min-w-0 truncate text-right text-[13px] text-[var(--text)]">
        {value}
        {hint && (
          <span className="ml-1.5 font-sans text-[11px] text-[var(--text-faint)]">{hint}</span>
        )}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badge — status pill. Always pairs a dot with a WORD, never colour   */
/* alone, so status is readable without relying on colour perception.  */
/* ------------------------------------------------------------------ */

export type BadgeTone = 'ok' | 'warn' | 'critical' | 'info' | 'muted';

const TONE: Record<BadgeTone, { fg: string; bg: string }> = {
  ok: { fg: 'var(--accent)', bg: 'var(--accent-soft)' },
  warn: { fg: 'var(--warn)', bg: 'var(--warn-soft)' },
  critical: { fg: 'var(--critical)', bg: 'var(--critical-soft)' },
  info: { fg: 'var(--info)', bg: 'var(--info-soft)' },
  muted: { fg: 'var(--text-muted)', bg: 'var(--surface-hover)' },
};

export function Badge({
  tone = 'muted',
  children,
  dot = true,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  dot?: boolean;
}) {
  const { fg, bg } = TONE[tone];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ color: fg, backgroundColor: bg }}
    >
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: fg }} />
      )}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Unavailable — the honest empty value.                               */
/* The backend never fabricates missing hardware readings, so the UI    */
/* never renders a fake 0 either. This is what "we don't know" looks   */
/* like, and it stays compact instead of becoming a giant empty card.  */
/* ------------------------------------------------------------------ */

export function Unavailable({ reason }: { reason?: string | null }) {
  return (
    <span
      className="text-[13px] text-[var(--text-faint)]"
      title={reason ?? undefined}
    >
      Unavailable
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Grid — the one responsive grid every section uses.                  */
/* 4 columns → 2 → 1 as width drops, so nothing ever overflows         */
/* horizontally on a 1280-wide laptop.                                 */
/* ------------------------------------------------------------------ */

export function TileGrid({
  children,
  cols = 4,
}: {
  children: ReactNode;
  cols?: 2 | 3 | 4;
}) {
  const colClass =
    cols === 2
      ? 'sm:grid-cols-2'
      : cols === 3
        ? 'sm:grid-cols-2 lg:grid-cols-3'
        : 'sm:grid-cols-2 xl:grid-cols-4';

  return <div className={`grid grid-cols-1 gap-3 ${colClass}`}>{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Section — consistent vertical rhythm + padding for every page.      */
/* ------------------------------------------------------------------ */

export function ViewContainer({ children }: { children: ReactNode }) {
  return <div className="space-y-3 p-4">{children}</div>;
}
