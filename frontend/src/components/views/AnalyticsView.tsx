import { useState } from 'react';
import { useAnalytics } from '../../hooks/useAnalytics';
import type { ProcessSnapshot } from '../../hooks/useProcessHistory';
import TrendSummary from '../TrendSummary';
import StatsSummary from '../StatsSummary';
import BottleneckTimeline from '../BottleneckTimeline';
import Panel from '../common/Panel';
import { LoadingState } from '../common/States';
import { ViewContainer } from '../common/Primitives';

interface AnalyticsViewProps {
  findNearest: (isoTime: string) => ProcessSnapshot | null;
}

/*
  Analytics answers "what has my computer been doing over time?" — the
  historical counterpart to Overview's "right now".

  The range selector drives useAnalytics' window parameter, which swaps the
  existing polling loop's range rather than starting a second loop. History
  here comes from the local JSONL snapshot store via the Python service; if
  that service is down the page degrades to an explanatory state instead of
  a raw error, because live monitoring is genuinely unaffected by it.
*/

const RANGES = [
  { label: '1 hour', minutes: 60 },
  { label: '6 hours', minutes: 360 },
  { label: '24 hours', minutes: 1440 },
  { label: '7 days', minutes: 10080 },
] as const;

export default function AnalyticsView({ findNearest }: AnalyticsViewProps) {
  const [minutes, setMinutes] = useState<number>(RANGES[0].minutes);
  const { trend, bottlenecks, stats, unavailable, loading } = useAnalytics(minutes);

  // The service answers with { message, count: 0 } when the window is empty.
  const noHistory =
    !loading &&
    !unavailable &&
    (trend?.count ?? 0) === 0 &&
    (stats?.count ?? 0) === 0;

  const rangeSelector = (
    <div
      className="flex items-center gap-0.5 rounded-md border border-[var(--border)] p-0.5"
      role="group"
      aria-label="Analytics time range"
    >
      {RANGES.map((r) => (
        <button
          key={r.minutes}
          type="button"
          onClick={() => setMinutes(r.minutes)}
          aria-pressed={minutes === r.minutes}
          className={`rounded px-2.5 py-1 text-[12px] transition-colors ${
            minutes === r.minutes
              ? 'bg-[var(--surface-hover)] text-[var(--text)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );

  return (
    <ViewContainer>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-medium text-[var(--text)]">Historical analysis</h2>
          <p className="text-[12px] text-[var(--text-faint)]">
            From locally stored snapshots — no external database involved.
          </p>
        </div>
        {rangeSelector}
      </div>

      {loading && (
        <Panel>
          <LoadingState label="Loading analytics" />
        </Panel>
      )}

      {!loading && unavailable && (
        <Panel title="Analytics">
          <div className="py-5 text-center">
            <p className="text-[15px] text-[var(--text)]">Analytics temporarily unavailable</p>
            <p className="mx-auto mt-1.5 max-w-md text-[13px] text-[var(--text-faint)]">
              Live system monitoring is still working. Historical analysis will
              resume when the analytics service becomes available.
            </p>
          </div>
        </Panel>
      )}

      {/*
        Distinct from "unavailable": the service is up and answering, there
        just isn't any history in the selected window yet. Common right
        after a fresh install, since local storage starts empty — so it gets
        a real explanation instead of empty panels.
      */}
      {!loading && !unavailable && noHistory && (
        <Panel title="Analytics">
          <div className="py-5 text-center">
            <p className="text-[15px] text-[var(--text)]">No history for this range yet</p>
            <p className="mx-auto mt-1.5 max-w-md text-[13px] text-[var(--text-faint)]">
              Snapshots are recorded continuously while System Info runs. Pick a
              shorter range, or leave the app running and check back.
            </p>
          </div>
        </Panel>
      )}

      {!loading && !unavailable && !noHistory && (
        <>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {trend && <TrendSummary trend={trend} />}
            {stats && <StatsSummary stats={stats} />}
          </div>
          {bottlenecks && (
            <BottleneckTimeline bottlenecks={bottlenecks} findNearest={findNearest} />
          )}
        </>
      )}
    </ViewContainer>
  );
}
