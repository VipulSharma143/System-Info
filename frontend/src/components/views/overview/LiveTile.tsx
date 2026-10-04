import { memo, type ReactNode } from 'react';
import { hueStyle, usageColor, type Hue } from '../../../lib/hues';
import Figure from '../../common/Figure';
import Sparkline from '../../common/Sparkline';
import { Badge, type BadgeTone } from '../../common/Primitives';

interface LiveTileProps {
  label: string;
  value: string;
  unit?: string;
  hue: Hue;
  status: string;
  tone?: BadgeTone;
  history?: number[];
  historyMax?: number | 'auto';
  /** Usage percentage that flips the figure to warn / critical colour. */
  percentForColor?: number;
  /** Replaces the sparkline (a disk shows a bar, not a trend). */
  footer?: ReactNode;
  /** Wide tiles span two columns of the bento grid. */
  className?: string;
}

/** One live metric: label, status pill, figure, and a sparkline (or custom footer) at the bottom. */
function LiveTile({ label, value, unit, hue, status, tone = 'muted', history, historyMax, percentForColor, footer, className = '' }: LiveTileProps) {
  const color = usageColor(percentForColor, hue);
  return (
    <div className={`panel flex min-w-0 flex-col justify-between gap-3 p-4 ${className}`} style={hueStyle(hue)}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <span className="h-2 w-2 rounded-full bg-[var(--h)]" />
          {label}
        </span>
        <Badge tone={tone} dot={false}>{status}</Badge>
      </div>
      <Figure size="lg" value={value} unit={unit} color={percentForColor !== undefined && percentForColor >= 70 ? color : undefined} />
      <div className="flex h-9 items-end">
        {footer ? (
          <div className="w-full">{footer}</div>
        ) : history && history.length > 1 ? (
          <div className="w-full"><Sparkline points={history} color={color} height={36} max={historyMax} dot /></div>
        ) : null}
      </div>
    </div>
  );
}

export default memo(LiveTile);
