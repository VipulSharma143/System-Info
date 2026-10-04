import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Inbox, WifiOff } from 'lucide-react';
import { inlineMessage, safeMessage } from '../../lib/errors';
import { hueStyle, type Hue } from '../../lib/hues';

/** Empty state: says what is missing and, where possible, what to do about it. */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  hue = 'neutral',
  action,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  hue?: Hue;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center" style={hueStyle(hue)}>
      <span className="glyph !h-11 !w-11 !rounded-2xl">
        <Icon className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <p className="num text-[15px] font-semibold text-ink">{title}</p>
      {description && <p className="max-w-sm text-[13px] leading-relaxed text-muted">{description}</p>}
      {action}
    </div>
  );
}

/** Three bars rising in turn; quieter than a spinner and readable at any size. */
export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 px-6 py-10 text-[13px] text-muted">
      <span aria-hidden="true" className="flex h-4 items-end gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-[3px] animate-pulse rounded-full bg-[var(--focus)]" style={{ height: `${10 + i * 3}px`, animationDelay: `${i * 140}ms` }} />
        ))}
      </span>
      {label}
    </div>
  );
}

/** Inline banner used for errors, offline notices and update announcements. */
export function Callout({
  tone,
  icon: Icon,
  children,
  action,
  role = 'alert',
}: {
  tone: 'critical' | 'warn' | 'info';
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  role?: 'alert' | 'status';
}) {
  const color = `var(--${tone})`;
  return (
    <div
      role={role}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--r-md)] px-4 py-3 text-[13px] leading-relaxed text-ink"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`, boxShadow: `inset 3px 0 0 ${color}` }}
    >
      <Icon className="h-4 w-4 shrink-0" style={{ color }} />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  // Callers pass catalogue copy; if anything technical ever slipped through, show the generic sentence.
  return <Callout tone="critical" icon={AlertTriangle}>{safeMessage(message, inlineMessage('systemInfo'))}</Callout>;
}

export function OfflineBanner() {
  return (
    <Callout tone="warn" icon={WifiOff}>
      <strong className="font-semibold">Live updates paused.</strong>{' '}
      <span className="text-muted">
        Showing the last data received. This page refreshes on its own once the connection is back.
      </span>
    </Callout>
  );
}
