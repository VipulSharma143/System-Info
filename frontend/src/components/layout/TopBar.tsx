import type { ReactNode } from 'react';

interface TopBarProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export default function TopBar({ title, description, action }: TopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--bg)] px-5">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)]">
          {title}
        </h1>
        {description && (
          <span className="hidden truncate text-[12px] text-[var(--text-faint)] md:inline">
            {description}
          </span>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center">{action}</div>}
    </header>
  );
}
