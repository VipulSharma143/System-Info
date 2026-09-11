import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Inbox, Loader2, WifiOff } from 'lucide-react';

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
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-[var(--critical)]/30 bg-[var(--critical-soft,transparent)] px-4 py-3 text-[13px] text-[var(--critical)]"
      style={{ backgroundColor: 'color-mix(in srgb, var(--critical) 10%, transparent)' }}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function OfflineBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md border border-[var(--critical)]/30 px-4 py-2.5 text-[13px] text-[var(--critical)]"
      style={{ backgroundColor: 'color-mix(in srgb, var(--critical) 8%, transparent)' }}
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      Backend unreachable — {message}
    </div>
  );
}
