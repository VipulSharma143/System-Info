import { Fragment, useState } from 'react';
import type { BottleneckEpisode, BottlenecksResponse } from '../types/analytics';
import { formatNumber, formatTimeSafe } from '../lib/format';
import type { ProcessSnapshot } from '../hooks/useProcessHistory';
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
    <div className="analytics-block">
      <h3 className="analytics-block__title">
        Bottlenecks{' '}
        <span className="analytics-block__meta">
          {bottlenecks.summary.sustained_cpu_episode_count} CPU ·{' '}
          {bottlenecks.summary.sustained_network_episode_count} network ·{' '}
          {bottlenecks.summary.isolated_cpu_spike_count} spikes
        </span>
      </h3>

      {!hasAny && <p className="analytics-block__empty">No bottleneck episodes in this window.</p>}

      {sustained.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th />
              <th>Type</th>
              <th>Start</th>
              <th>Duration</th>
              <th>Peak</th>
              <th>Class</th>
            </tr>
          </thead>
          <tbody>
            {sustained.map((ep, i) => {
              const key = `s-${i}`;
              const t = timeOf(ep);
              const isOpen = openRow === key;
              return (
                <Fragment key={key}>
                  <tr
                    className={`data-table__row--clickable ${isOpen ? 'is-open' : ''}`}
                    onClick={() => t && setOpenRow(isOpen ? null : key)}
                  >
                    <td className="data-table__chevron">{t ? (isOpen ? '▾' : '▸') : ''}</td>
                    <td>{ep.__label}</td>
                    <td>{formatTimeSafe(t)}</td>
                    <td>{ep.duration_sec != null ? `${ep.duration_sec}s` : '—'}</td>
                    <td>{peakOf(ep)}</td>
                    <td>{ep.classification ?? '—'}</td>
                  </tr>
                  {isOpen && t && (
                    <tr className="data-table__detail-row">
                      <td colSpan={6}>
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
          <p className="analytics-block__lead" style={{ marginTop: sustained.length ? '1rem' : 0 }}>
            Isolated spikes — click one to see what was running
          </p>
          <div className="spike-list">
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
                  className={`spike-chip ${critical ? 'spike-chip--critical' : ''} ${isOpen ? 'spike-chip--active' : ''}`}
                  onClick={() => t && setOpenRow(isOpen ? null : key)}
                  disabled={!t}
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
              return t ? <SpikeDetail snapshot={findNearest(t)} spikeTime={t} /> : null;
            })()}
        </>
      )}
    </div>
  );
}
