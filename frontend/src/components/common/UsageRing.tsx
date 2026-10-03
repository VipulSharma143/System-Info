import { severityColor } from './Primitives';
import { formatPercent } from '../../lib/format';

interface UsageRingProps {
  percent: number;
  label?: string;
  size?: number;
}

// Circular usage gauge. Colour follows the shared severity thresholds (70 / 90),
// and the number is always printed, so colour is never the only signal.
export default function UsageRing({ percent, label = 'used', size = 132 }: UsageRingProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${formatPercent(clamped)} ${label}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-hover)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={severityColor(clamped)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-[26px] font-medium leading-none text-[var(--text)]">
          {formatPercent(clamped)}
        </span>
        <span className="mt-1 text-[12px] text-[var(--text-muted)]">{label}</span>
      </div>
    </div>
  );
}
