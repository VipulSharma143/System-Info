import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { BottleneckEpisode, BottlenecksResponse } from '../types/analytics';
import { formatNumber, formatTimeSafe } from '../lib/format';
import type { ProcessSnapshot } from '../hooks/useProcessHistory';
import Panel from './common/Panel';
import { Th, Td, Tr } from './common/Table';
import { EmptyState } from './common/States';
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

export default function BottleneckTimeline({ bottlenecks, findNearest }: BottleneckTimelineProps) {
  const [openRow, setOpenRow] = useState<string | null>(null);

  const sustained: LabeledEpisode[] = [
    ...bottlenecks.sustained_cpu_episodes.map((e) => ({ ...e, __label: 'CPU' })),
    ...bottlenecks.sustained_network_episodes.map((e) => ({ ...e, __label: 'Network' })),
  ];
  const spikes = bottlenecks.isolated_cpu_spikes;
  const hasAny = sustained.length > 0 || spikes.length > 0;
  const openSpikeIndex = openRow?.startsWith('spike-') ? Number(openRow.split('-')[1]) : null;

  return (
    <Panel
      title="Bottlenecks"
      meta={`${bottlenecks.summary.sustained_cpu_episode_count} CPU · ${bottlenecks.summary.sustained_network_episode_count} network · ${bottlenecks.summary.isolated_cpu_spike_count} spikes`}
    >
      {!hasAny && <EmptyState title="No bottleneck episodes in this window" />}

      {sustained.length > 0 && (
        <table className="w-full border-collapse">
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
                    <Td className="text-[var(--text-faint)]">
                      {t ? (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
                    </Td>
                    <Td className="font-medium">{ep.__label}</Td>
                    <Td className="tabular text-[var(--text-muted)]">{formatTimeSafe(t)}</Td>
                    <Td className="tabular text-[var(--text-muted)]">
                      {ep.duration_sec != null ? `${ep.duration_sec}s` : '—'}
                    </Td>
                    <Td className="tabular text-right">{peakOf(ep)}</Td>
                    <Td className="text-[var(--text-muted)]">{ep.classification ?? '—'}</Td>
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
      )}

      {spikes.length > 0 && (
        <>
          <p className={`text-[12px] text-[var(--text-muted)] ${sustained.length ? 'mt-4' : ''} mb-2`}>
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
                  className={`tabular rounded-md border px-2.5 py-1 text-[12px] transition-colors disabled:opacity-40 ${
                    isOpen
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : critical
                        ? 'border-[var(--critical)]/40 text-[var(--critical)] hover:bg-[var(--surface-hover)]'
                        : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
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
