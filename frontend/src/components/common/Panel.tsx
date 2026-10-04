import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { hueStyle, type Hue } from '../../lib/hues';

interface PanelProps {
  title?: string;
  meta?: ReactNode;
  action?: ReactNode;
  /** Small tinted glyph before the title. */
  icon?: LucideIcon;
  hue?: Hue;
  /** `hero` is the larger, hue-washed surface used for the one headline panel of a page. */
  variant?: 'default' | 'hero';
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  noPad?: boolean;
}

export default function Panel({
  title,
  meta,
  action,
  icon: Icon,
  hue = 'neutral',
  variant = 'default',
  children,
  className = '',
  bodyClassName = '',
  noPad = false,
}: PanelProps) {
  const hero = variant === 'hero';
  const px = hero ? 'px-6' : 'px-5';
  const hasHeader = Boolean(title || action);
  const bodyPad = noPad ? '' : hasHeader ? `${px} pt-2 ${hero ? 'pb-6' : 'pb-5'}` : hero ? 'p-6' : 'p-5';

  return (
    <section
      style={hueStyle(hue)}
      className={`panel min-w-0 ${hero ? 'panel--hero' : ''} ${noPad ? 'overflow-hidden' : ''} ${className}`}
    >
      {hasHeader && (
        <header className={`flex min-h-12 items-center justify-between gap-3 ${px} ${hero ? 'pt-5' : 'pt-4'} ${noPad ? 'pb-3' : ''}`}>
          <div className="flex min-w-0 items-center gap-2.5">
            {Icon && (
              <span className="glyph">
                <Icon className="h-4 w-4" strokeWidth={2} />
              </span>
            )}
            {title && <h2 className="num truncate text-[15px] font-semibold text-ink">{title}</h2>}
            {meta && <span className="truncate text-[12px] text-faint">{meta}</span>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={`${bodyPad} ${bodyClassName}`}>{children}</div>
    </section>
  );
}
