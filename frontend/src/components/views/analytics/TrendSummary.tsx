import { memo } from 'react';
import { Minus, TrendingDown, TrendingUp, Waypoints } from 'lucide-react';
import type { DirectionalTrend, TrendResponse } from '../../../types/analytics';
import { EmptyState } from '../../common/States';
import Panel from '../../common/Panel';
import { Td, Th, Tr } from '../../common/Table';

const ICONS: Record<string, typeof TrendingUp> = { climbing: TrendingUp, dropping: TrendingDown, flat: Minus };
const COLORS: Record<string, string> = { climbing: 'var(--warn)', dropping: 'var(--info)', flat: 'var(--text-muted)' };

function DirectionTag({ t }: { t: DirectionalTrend }) {
  const Icon = ICONS[t.direction] ?? Minus;
  const color = COLORS[t.direction] ?? 'var(--text-muted)';
  const sign = t.per_minute > 0 ? '+' : '';
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color }}>
      <Icon className="h-3.5 w-3.5" />
      {t.direction}
      <span className="num text-[12px] font-normal text-faint">({sign}{t.per_minute.toFixed(1)}/min)</span>
    </span>
  );
}

function windowMinutes(from?: string, to?: string) {
  if (!from || !to) return null;
  const minutes = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);
  return Number.isFinite(minutes) ? minutes : null;
}

function TrendSummary({ trend }: { trend: TrendResponse }) {
  // cpu_trend / network_trend_rx are absent when the window holds no history (a fresh install).
  // Guard here: Object.entries(undefined) throws, and a throw during render blanks the whole app.
  const networkEntries = Object.entries(trend.network_trend_rx ?? {});
  const cpuTrend = trend.cpu_trend;

  if (!cpuTrend) {
    return (
      <Panel title="Trend" icon={Waypoints} hue="analytics">
        <EmptyState icon={Waypoints} hue="analytics" title="Not enough history yet" description="A trend needs a few minutes of recorded samples." />
      </Panel>
    );
  }

  const mins = windowMinutes(trend.from, trend.to);
  return (
    <Panel title="Trend" icon={Waypoints} hue="analytics" meta={`${trend.count} samples${mins !== null ? ` · last ${mins} min` : ''}`}>
      <div className="mb-4 flex items-center gap-3 text-[13px] text-muted">
        Processor <DirectionTag t={cpuTrend} />
      </div>
      {networkEntries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><Th className="!pl-0">Interface</Th><Th>Direction</Th></tr></thead>
            <tbody>
              {networkEntries.map(([iface, t]) => (
                <Tr key={iface}><Td className="!pl-0 font-medium">{iface}</Td><Td><DirectionTag t={t} /></Td></Tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export default memo(TrendSummary);
