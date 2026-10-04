import type { ReactNode } from 'react';
import { hueStyle, type Hue } from '../../lib/hues';

interface TopBarProps {
  title: string;
  description?: string;
  hue?: Hue;
  action?: ReactNode;
}

/** Page header: a large title in the page's hue-marked display face, the one-line purpose below it. */
export default function TopBar({ title, description, hue = 'neutral', action }: TopBarProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-3 px-6 pb-4 pt-6 max-md:px-4" style={hueStyle(hue)}>
      <div className="min-w-0">
        <h1 className="num flex items-center gap-3 truncate text-[30px] font-bold leading-none text-ink">
          <span aria-hidden="true" className="h-7 w-1.5 rounded-full bg-[var(--h)]" />
          {title}
        </h1>
        {description && <p className="mt-2 truncate text-[13px] text-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center">{action}</div>}
    </header>
  );
}
