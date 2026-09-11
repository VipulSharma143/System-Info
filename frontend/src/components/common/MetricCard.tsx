import type { ReactNode } from 'react';
import { severity } from '../../lib/format';
import Sparkline from './Sparkline';

const SEVERITY_COLOR: Record<string, string> = {
  ok: 'var(--accent)',
  warn: 'var(--warn)',
  critical: 'var(--critical)',
};

interface MetricCardProps {
  label: string;
  value: string;
  unit?: string;
  detail?: ReactNode;
  percentForColor?: number;
  history?: number[];
}

export default function MetricCard({
  label,
  value,
  unit,
  detail,
  percentForColor,
  history,
}: MetricCardProps) {
  const color =
    percentForColor !== undefined ? SEVERITY_COLOR[severity(percentForColor)] : 'var(--text-muted)';

  return (
    <div className="flex flex-1 min-w-[180px] flex-col justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] text-[var(--text-muted)]">{label}</span>
        {percentForColor !== undefined && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <span className="tabular text-[26px] font-medium leading-none text-[var(--text)]">
            {value}
          </span>
          {unit && (
            <span className="ml-1 text-[13px] text-[var(--text-muted)]">{unit}</span>
          )}
          {detail && (
            <div className="mt-1 text-[12px] text-[var(--text-faint)]">{detail}</div>
          )}
        </div>
        {history && history.length > 1 && (
          <div className="w-16 shrink-0">
            <Sparkline points={history} color={color} />
          </div>
        )}
      </div>
    </div>
  );
}
