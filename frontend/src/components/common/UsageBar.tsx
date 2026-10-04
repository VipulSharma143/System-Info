import { usageColor, type Hue } from '../../lib/hues';

interface UsageBarProps {
  percent: number;
  compact?: boolean;
  /** Subsystem hue for the fill while usage is normal. */
  hue?: Hue;
  /** Hide the trailing percentage when the surrounding layout already prints it. */
  hideValue?: boolean;
  /**
   * Severity normally assumes "high is bad". Battery charge is the opposite: 80% is healthy and
   * 10% is critical, so it passes `lowIsBad`.
   */
  lowIsBad?: boolean;
}

export default function UsageBar({ percent, compact = false, hue = 'neutral', hideValue = false, lowIsBad = false }: UsageBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  const color = usageColor(lowIsBad ? 100 - percent : percent, hue);

  return (
    <div className="flex items-center gap-3">
      <div className={`relative flex-1 overflow-hidden rounded-full bg-surface-3 ${compact ? 'h-1.5' : 'h-2.5'}`}>
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
      {!hideValue && (
        <span className="num w-12 shrink-0 text-right text-[12px] font-medium text-muted">{percent.toFixed(1)}%</span>
      )}
    </div>
  );
}
