import { useAnalytics } from '../hooks/useAnalytics';
import type { ProcessSnapshot } from '../hooks/useProcessHistory';
import TrendSummary from './TrendSummary';
import StatsSummary from './StatsSummary';
import BottleneckTimeline from './BottleneckTimeline';
import Panel from './common/Panel';
import { LoadingState } from './common/States';

interface AnalyticsPanelProps {
  findNearest: (isoTime: string) => ProcessSnapshot | null;
}

export default function AnalyticsPanel({ findNearest }: AnalyticsPanelProps) {
  const { trend, bottlenecks, stats, unavailable, loading } = useAnalytics();

  if (loading) return <LoadingState label="Loading analytics" />;

  if (unavailable) {
    return (
      <Panel>
        <p className="text-[13px] text-[var(--text-muted)]">
          Analytics service unavailable — live system data is unaffected.
        </p>
      </Panel>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {trend && <TrendSummary trend={trend} />}
      {stats && <StatsSummary stats={stats} />}
      {bottlenecks && (
        <div className="xl:col-span-2">
          <BottleneckTimeline bottlenecks={bottlenecks} findNearest={findNearest} />
        </div>
      )}
    </div>
  );
}
