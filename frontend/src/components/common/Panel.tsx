import type { ReactNode } from 'react';

interface PanelProps {
  title?: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  noPad?: boolean;
}

export default function Panel({
  title,
  meta,
  action,
  children,
  className = '',
  bodyClassName = '',
  noPad = false,
}: PanelProps) {
  return (
    <section className={`card min-w-0 ${noPad ? 'overflow-hidden' : ''} ${className}`}>
      {(title || action) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2">
          <div className="flex min-w-0 items-baseline gap-2">
            {title && (
              <h2 className="truncate text-[13px] font-semibold tracking-[-0.005em] text-[var(--text)]">
                {title}
              </h2>
            )}
            {meta && (
              <span className="truncate text-[12px] text-[var(--text-faint)]">{meta}</span>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={noPad ? bodyClassName : `p-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
