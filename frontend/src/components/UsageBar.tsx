import { severity } from '../lib/format';

interface UsageBarProps {
  percent: number;
}

export default function UsageBar({ percent }: UsageBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="usage-bar">
      <div
        className={`usage-bar__fill usage-bar__fill--${severity(percent)}`}
        style={{ width: `${clamped}%` }}
      />
      <span className="usage-bar__label">{percent.toFixed(1)}%</span>
    </div>
  );
}
