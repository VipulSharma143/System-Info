import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Inbox, Loader2, WifiOff } from 'lucide-react';
import { inlineMessage, safeMessage } from '../../lib/errors';

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <Icon className="h-5 w-5 text-[var(--text-faint)]" strokeWidth={1.5} />
      <p className="text-[13px] text-[var(--text-muted)]">{title}</p>
      {description && (
        <p className="max-w-sm text-[12px] text-[var(--text-faint)]">
          {description}
        </p>
      )}
    </div>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-10 text-[13px] text-[var(--text-muted)]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  // Belt and braces: callers pass catalog copy, but if anything technical
  // (a URL, a port, "Failed to fetch") ever slipped through, show the
  // generic sentence instead of leaking it.
  const text = safeMessage(message, inlineMessage('systemInfo'));
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-[var(--critical)]/30 px-4 py-3 text-[13px] leading-relaxed text-[var(--critical)]"
      style={{ backgroundColor: 'color-mix(in srgb, var(--critical) 9%, transparent)' }}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

export function OfflineBanner() {
  return (
    <div
      role="alert"
      className="flex items-center gap-2.5 rounded-[var(--radius-control)] border border-[var(--warn)]/30 px-4 py-2.5 text-[13px] text-[var(--text)]"
      style={{ backgroundColor: 'color-mix(in srgb, var(--warn) 8%, transparent)' }}
    >
      <WifiOff className="h-4 w-4 shrink-0 text-[var(--warn)]" />
      <span>
        <strong className="font-semibold">Live updates paused.</strong>{' '}
        <span className="text-[var(--text-muted)]">
          Showing the last data received. This page will refresh on its own once the connection is back.
        </span>
      </span>
    </div>
  );
}
