import { severity } from '../../lib/format';

const SEVERITY_COLOR: Record<string, string> = {
  ok: 'var(--accent)',
  warn: 'var(--warn)',
  critical: 'var(--critical)',
};

interface UsageBarProps {
  percent: number;
  compact?: boolean;
}

export default function UsageBar({ percent, compact = false }: UsageBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  const color = SEVERITY_COLOR[severity(percent)];

  return (
    <div className="flex items-center gap-2">
      <div
        className={`relative flex-1 overflow-hidden rounded-full bg-[var(--surface-hover)] ${
          compact ? 'h-1' : 'h-1.5'
        }`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
      <span className="tabular w-11 shrink-0 text-right text-[12px] text-[var(--text-muted)]">
        {percent.toFixed(1)}%
      </span>
    </div>
  );
}
