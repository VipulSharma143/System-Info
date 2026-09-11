import type { DirectionalTrend, TrendResponse } from '../types/analytics';

interface TrendSummaryProps {
  trend: TrendResponse;
}

const ARROWS: Record<string, string> = { climbing: '↑', dropping: '↓', flat: '→' };

function directionLabel(t: DirectionalTrend) {
  const sign = t.per_minute > 0 ? '+' : '';
  return `${ARROWS[t.direction] ?? '→'} ${t.direction} (${sign}${t.per_minute.toFixed(1)}/min)`;
}

function windowMinutes(from: string, to: string) {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);
}

export default function TrendSummary({ trend }: TrendSummaryProps) {
  return (
    <div className="analytics-block">
      <h3 className="analytics-block__title">
        Trend <span className="analytics-block__meta">{trend.count} samples · last {windowMinutes(trend.from, trend.to)} min</span>
      </h3>
      <p className="analytics-block__lead">CPU {directionLabel(trend.cpu_trend)}</p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Interface</th>
            <th>Direction</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(trend.network_trend_rx).map(([iface, t]) => (
            <tr key={iface}>
              <td>{iface}</td>
              <td>{directionLabel(t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
