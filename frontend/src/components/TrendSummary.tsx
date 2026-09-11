import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { DirectionalTrend, TrendResponse } from '../types/analytics';
import Panel from './common/Panel';
import { Th, Td, Tr } from './common/Table';

const ICONS: Record<string, typeof TrendingUp> = {
  climbing: TrendingUp,
  dropping: TrendingDown,
  flat: Minus,
};

const COLORS: Record<string, string> = {
  climbing: 'var(--warn)',
  dropping: 'var(--info)',
  flat: 'var(--text-muted)',
};

function DirectionTag({ t }: { t: DirectionalTrend }) {
  const Icon = ICONS[t.direction] ?? Minus;
  const color = COLORS[t.direction] ?? 'var(--text-muted)';
  const sign = t.per_minute > 0 ? '+' : '';
  return (
    <span className="inline-flex items-center gap-1 text-[13px]" style={{ color }}>
      <Icon className="h-3.5 w-3.5" />
      {t.direction}
      <span className="tabular text-[12px] text-[var(--text-faint)]">
        ({sign}
        {t.per_minute.toFixed(1)}/min)
      </span>
    </span>
  );
}

function windowMinutes(from: string, to: string) {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);
}

export default function TrendSummary({ trend }: { trend: TrendResponse }) {
  const networkEntries = Object.entries(trend.network_trend_rx);
  return (
    <Panel title="Trend" meta={`${trend.count} samples · last ${windowMinutes(trend.from, trend.to)} min`}>
      <div className="mb-3 flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
        CPU
        <DirectionTag t={trend.cpu_trend} />
      </div>
      {networkEntries.length > 0 && (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Interface</Th>
              <Th>Direction</Th>
            </tr>
          </thead>
          <tbody>
            {networkEntries.map(([iface, t]) => (
              <Tr key={iface}>
                <Td className="font-medium">{iface}</Td>
                <Td>
                  <DirectionTag t={t} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
