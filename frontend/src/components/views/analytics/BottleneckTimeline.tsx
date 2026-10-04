import { Fragment, memo, useState } from 'react';
import { ChevronDown, ChevronRight, Siren } from 'lucide-react';
import type { BottleneckEpisode, BottlenecksResponse } from '../../../types/analytics';
import { formatNumber, formatTimeSafe } from '../../../lib/format';
import type { ProcessSnapshot } from '../../../hooks/useProcessHistory';
import Panel from '../../common/Panel';
import { Th, Td, Tr } from '../../common/Table';
import { EmptyState } from '../../common/States';
import SpikeDetail from './SpikeDetail';

interface BottleneckTimelineProps {
  bottlenecks: BottlenecksResponse;
  findNearest: (isoTime: string) => ProcessSnapshot | null;
}

interface LabeledEpisode extends BottleneckEpisode {
  __label: string;
}

function peakOf(ep: BottleneckEpisode): string {
  const value = ep.peak ?? ep.value;
  return value != null ? `${formatNumber(value)}%` : '—';
}

function timeOf(ep: BottleneckEpisode): string | undefined {
  const v = ep.start ?? ep.timestamp ?? ep.time;
  return typeof v === 'string' ? v : undefined;
}

function BottleneckTimeline({ bottlenecks, findNearest }: BottleneckTimelineProps) {
  const [openRow, setOpenRow] = useState<string | null>(null);

  const sustained: LabeledEpisode[] = [
    // Every array here is optional: AnalyticsService.cs returns only
    // { message, count: 0 } when the window holds no history, which is the
    // normal fresh-install state. Default to [] rather than letting an
    // undefined .map() blank the whole dashboard.
    ...(bottlenecks.sustained_cpu_episodes ?? []).map((e) => ({ ...e, __label: 'CPU' })),
    ...(bottlenecks.sustained_network_episodes ?? []).map((e) => ({ ...e, __label: 'Network' })),
  ];
  const spikes = bottlenecks.isolated_cpu_spikes ?? [];
  const hasAny = sustained.length > 0 || spikes.length > 0;
  const openSpikeIndex = openRow?.startsWith('spike-') ? Number(openRow.split('-')[1]) : null;

  return (
    <Panel
      title="Bottlenecks"
      icon={Siren}
      hue="analytics"
      meta={
        bottlenecks.summary
          ? `${bottlenecks.summary.sustained_cpu_episode_count} CPU · ${bottlenecks.summary.sustained_network_episode_count} network · ${bottlenecks.summary.isolated_cpu_spike_count} spikes`
          : 'no history in this window'
      }
    >
      {!hasAny && <EmptyState icon={Siren} hue="analytics" title="No bottlenecks in this range" description="Nothing stayed under heavy load for long enough to count." />}

      {sustained.length > 0 && (
        <div className="overflow-x-auto">
        <table className="table-flush w-full">
          <thead>
            <tr>
              <Th className="w-6" />
              <Th>Type</Th>
              <Th>Start</Th>
              <Th>Duration</Th>
              <Th className="text-right">Peak</Th>
              <Th>Class</Th>
            </tr>
          </thead>
          <tbody>
            {sustained.map((ep, i) => {
              const key = `s-${i}`;
              const t = timeOf(ep);
              const isOpen = openRow === key;
              return (
                <Fragment key={key}>
                  <Tr
                    className={t ? 'cursor-pointer' : ''}
                    onClick={() => t && setOpenRow(isOpen ? null : key)}
                  >
                    <Td className="text-faint">
                      {t ? (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
                    </Td>
                    <Td className="font-medium">{ep.__label}</Td>
                    <Td className="num text-muted">{formatTimeSafe(t)}</Td>
                    <Td className="num text-muted">
                      {ep.duration_sec != null ? `${ep.duration_sec}s` : '—'}
                    </Td>
                    <Td className="num text-right">{peakOf(ep)}</Td>
                    <Td className="text-muted">{ep.classification ?? '—'}</Td>
                  </Tr>
                  {isOpen && t && (
                    <tr>
                      <td colSpan={6} className="px-3 pb-3">
                        <SpikeDetail snapshot={findNearest(t)} spikeTime={t} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      {spikes.length > 0 && (
        <>
          <p className={`text-[12px] text-muted ${sustained.length ? 'mt-4' : ''} mb-2`}>
            Isolated spikes — select one to see what was running
          </p>
          <div className="flex flex-wrap gap-1.5">
            {spikes.map((s, i) => {
              const peakVal = s.peak ?? s.value;
              const critical = typeof peakVal === 'number' && peakVal >= 100;
              const t = timeOf(s);
              const key = `spike-${i}`;
              const isOpen = openRow === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => t && setOpenRow(isOpen ? null : key)}
                  disabled={!t}
                  className={`num rounded-full px-3 py-1 text-[12px] font-medium transition-colors disabled:opacity-40 ${
                    isOpen
                      ? 'bg-[var(--primary)] text-[var(--on-primary)]'
                      : critical
                        ? 'bg-[color-mix(in_srgb,var(--critical)_16%,transparent)] text-critical hover:bg-[color-mix(in_srgb,var(--critical)_24%,transparent)]'
                        : 'bg-surface-2 text-muted hover:bg-surface-3'
                  }`}
                >
                  {formatTimeSafe(t)} · {peakOf(s)}
                </button>
              );
            })}
          </div>
          {openSpikeIndex !== null &&
            spikes[openSpikeIndex] &&
            (() => {
              const t = timeOf(spikes[openSpikeIndex]);
              return t ? (
                <div className="mt-3">
                  <SpikeDetail snapshot={findNearest(t)} spikeTime={t} />
                </div>
              ) : null;
            })()}
        </>
      )}
    </Panel>
  );
}

export default memo(BottleneckTimeline);
