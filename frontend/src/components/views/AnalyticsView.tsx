import { memo, useState } from 'react';
import { DatabaseZap, History } from 'lucide-react';
import { useAnalytics } from '../../hooks/useAnalytics';
import type { ProcessSnapshot } from '../../hooks/useProcessHistory';
import Panel from '../common/Panel';
import Segmented from '../common/Segmented';
import Skeleton from '../common/Skeleton';
import { EmptyState } from '../common/States';
import { ViewContainer } from '../common/Primitives';
import BottleneckTimeline from './analytics/BottleneckTimeline';
import StatsSummary from './analytics/StatsSummary';
import TrendSummary from './analytics/TrendSummary';

/*
  Analytics answers "what has my computer been doing over time?" — the counterpart to Overview's
  "right now". The range selector swaps the window of the existing polling loop in useAnalytics
  rather than starting a second one. History comes from the local JSONL store; if that service is
  down the page degrades to an explanation, because live monitoring is genuinely unaffected.
*/

const RANGES = [
  { label: '1 hour', value: 60 },
  { label: '6 hours', value: 360 },
  { label: '24 hours', value: 1440 },
  { label: '7 days', value: 10080 },
] as const;

function LoadingPanels() {
  return (
    <>
      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
      </div>
      <Skeleton className="h-56" />
    </>
  );
}

function AnalyticsView({ findNearest }: { findNearest: (isoTime: string) => ProcessSnapshot | null }) {
  const [minutes, setMinutes] = useState<number>(RANGES[0].value);
  const { trend, bottlenecks, stats, unavailable, loading } = useAnalytics(minutes);

  // The service answers { message, count: 0 } when the window is empty — normal right after install.
  const noHistory = !loading && !unavailable && (trend?.count ?? 0) === 0 && (stats?.count ?? 0) === 0;

  return (
    <ViewContainer>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">Built from snapshots stored on this computer. No external database involved.</p>
        <Segmented ariaLabel="Analytics time range" value={minutes} onChange={setMinutes} options={RANGES} />
      </div>

      {loading && <LoadingPanels />}

      {!loading && unavailable && (
        <Panel>
          <EmptyState
            icon={DatabaseZap}
            hue="analytics"
            title="Analytics is taking a break"
            description="Live monitoring still works. History comes back as soon as the analytics service does."
          />
        </Panel>
      )}

      {noHistory && (
        <Panel>
          <EmptyState
            icon={History}
            hue="analytics"
            title="No history for this range yet"
            description="Snapshots are recorded while System Info runs. Pick a shorter range, or leave the app open and check back."
          />
        </Panel>
      )}

      {!loading && !unavailable && !noHistory && (
        <>
          <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-2">
            {trend && <TrendSummary trend={trend} />}
            {stats && <StatsSummary stats={stats} />}
          </div>
          {bottlenecks && <BottleneckTimeline bottlenecks={bottlenecks} findNearest={findNearest} />}
        </>
      )}
    </ViewContainer>
  );
}

export default memo(AnalyticsView);
