import { memo } from 'react';
import { usageColor, type Hue } from '../../lib/hues';
import { formatPercent } from '../../lib/format';
import Figure from './Figure';

interface UsageRingProps {
  percent: number;
  label?: string;
  size?: number;
  hue?: Hue;
}

// Circular usage gauge. The number is always printed, so colour is never the only signal.
function UsageRing({ percent, label = 'used', size = 148, hue = 'neutral' }: UsageRingProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = usageColor(clamped, hue);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${formatPercent(clamped)} ${label}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <Figure size="lg" value={clamped.toFixed(0)} unit="%" color={clamped >= 70 ? color : undefined} />
        <span className="text-[12px] text-muted">{label}</span>
      </div>
    </div>
  );
}

export default memo(UsageRing);
