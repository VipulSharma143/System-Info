import { useAnalytics } from '../hooks/useAnalytics';
import type { ProcessSnapshot } from '../hooks/useProcessHistory';
import TrendSummary from './TrendSummary';
import StatsSummary from './StatsSummary';
import BottleneckTimeline from './BottleneckTimeline';

interface AnalyticsPanelProps {
  findNearest: (isoTime: string) => ProcessSnapshot | null;
}

export default function AnalyticsPanel({ findNearest }: AnalyticsPanelProps) {
  const { trend, bottlenecks, stats, unavailable, loading } = useAnalytics();

  if (loading) return null; // avoid a flash of "unavailable" before the first fetch resolves

  if (unavailable) {
    return (
      <div className="panel panel--analytics">
        <h2 className="panel__title">Analytics</h2>
        <p className="panel__empty">
          Analytics service unavailable — live system data above is unaffected.
        </p>
      </div>
    );
  }

  return (
    <div className="panel panel--analytics">
      <h2 className="panel__title">Analytics</h2>
      <div className="analytics-grid">
        {trend && <TrendSummary trend={trend} />}
        {stats && <StatsSummary stats={stats} />}
        {bottlenecks && <BottleneckTimeline bottlenecks={bottlenecks} findNearest={findNearest} />}
      </div>
    </div>
  );
}
