import { memo, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';

import { hueStyle, usageColor, type Hue } from '../../../lib/hues';

/** Shared building blocks of the overlay panels. Everything here is presentational and takes primitives, so memo() holds. */

export function Missing({ hint }: { hint?: string | null }) {
  return <span className="font-normal text-faint" title={hint ?? undefined}>Unavailable</span>;
}

interface MetricProps {
  label: string;
  /** Pre-formatted value; null/undefined renders "Not reported" (never 0). */
  value: ReactNode | null | undefined;
  detail?: ReactNode;
  color?: string;
  hint?: string | null;
}

/** One compact label/value cell. */
export const Metric = memo(function Metric({ label, value, detail, color, hint }: MetricProps) {
  return (
    <div className="min-w-0 rounded-[var(--r-sm)] bg-surface-2 px-3 py-2.5">
      <div className="truncate text-[11px] text-faint">{label}</div>
      <div className="num mt-0.5 truncate text-[15px] font-semibold" style={{ color }}>
        {value == null ? <Missing hint={hint} /> : value}
      </div>
      {detail && <div className="truncate text-[11px] text-faint">{detail}</div>}
    </div>
  );
});

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">{children}</div>;
}

/** Thin utilisation bar; width is the only thing that changes between samples. */
export const Meter = memo(function Meter({ percent, hue, label }: { percent: number | null | undefined; hue: Hue; label?: string }) {
  const clamped = percent == null ? 0 : Math.min(100, Math.max(0, percent));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent == null ? undefined : Math.round(clamped)}>
      <div className="h-full rounded-full" style={{ width: `${clamped}%`, backgroundColor: usageColor(percent ?? undefined, hue) }} />
    </div>
  );
});

interface SectionProps {
  title: string;
  icon: LucideIcon;
  hue: Hue;
  /** Short right-aligned summary, visible while collapsed. */
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Expandable panel on a native <details>: collapsing costs no React state and no re-render. */
export function Section({ title, icon: Icon, hue, meta, defaultOpen = true, children }: SectionProps) {
  return (
    <details open={defaultOpen} className="panel group min-w-0" style={hueStyle(hue)}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="glyph"><Icon className="h-4 w-4" strokeWidth={2} /></span>
          <h2 className="num truncate text-[15px] font-semibold text-ink">{title}</h2>
        </span>
        <span className="flex min-w-0 items-center gap-3">
          {meta && <span className="truncate text-[12px] text-faint">{meta}</span>}
          <ChevronDown className="h-4 w-4 shrink-0 text-faint transition-transform group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <div className="space-y-4 px-5 pb-5">{children}</div>
    </details>
  );
}

export function SubHeading({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-wide text-faint">{children}</div>;
}
