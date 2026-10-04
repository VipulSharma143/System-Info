import type { ReactNode } from 'react';

const SIZE = {
  xl: ['text-[64px] leading-[0.95]', 'text-[22px]'],
  lg: ['text-[40px] leading-none', 'text-[16px]'],
  md: ['text-[26px] leading-none', 'text-[13px]'],
  sm: ['text-[19px] leading-none', 'text-[12px]'],
} as const;

interface FigureProps {
  value: ReactNode;
  unit?: string;
  size?: keyof typeof SIZE;
  /** CSS colour for the value (used to flag warn / critical). */
  color?: string;
  className?: string;
}

/** A big live number with its unit. The one place figures are typeset. */
export default function Figure({ value, unit, size = 'md', color, className = '' }: FigureProps) {
  const [valueClass, unitClass] = SIZE[size];
  return (
    <span className={`inline-flex items-baseline gap-1.5 whitespace-nowrap ${className}`}>
      <span className={`num font-semibold ${valueClass}`} style={{ color: color ?? 'var(--text)' }}>
        {value}
      </span>
      {unit && <span className={`font-medium text-muted ${unitClass}`}>{unit}</span>}
    </span>
  );
}
