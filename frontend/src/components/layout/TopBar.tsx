import type { ReactNode } from 'react';

interface TopBarProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export default function TopBar({ title, description, action }: TopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--bg)] px-5">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="truncate text-[14px] font-medium text-[var(--text)]">{title}</h1>
        {description && (
          <span className="hidden truncate text-[12px] text-[var(--text-faint)] sm:inline">
            {description}
          </span>
        )}
      </div>
      {action}
    </header>
  );
}
