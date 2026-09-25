import type { ReactNode } from 'react';
import type { SystemSnapshot } from '../../types/system';
import { useMetricHistory } from '../../hooks/useMetricHistory';
import Panel from '../common/Panel';
import Sparkline from '../common/Sparkline';
import UsageBar from '../common/UsageBar';
import { Badge, StatTile, TileGrid, ViewContainer, severityColor } from '../common/Primitives';

interface OverviewViewProps {
  data: SystemSnapshot;
}

/*
  Overview answers one question: "what is happening on my computer right
  now?" — and it has to answer it inside roughly one laptop viewport.

  Layout, top to bottom in priority order:
    1. Five Level-1 live metrics (CPU / Memory / Disk / Network / Battery)
    2. One wide activity timeline (shared CPU + memory trend)
    3. Two supporting panels side by side (top processes, storage)

  Everything below that is detail the user chooses to scroll to, not
  something they need in order to read the machine's state.
*/

function HeroMetric({
  label,
  value,
  unit,
  status,
  statusTone,
  history,
  historyMax,
  percentForColor,
  footer,
  chartColor,
}: {
  label: string;
  value: string;
  unit?: string;
  status: string;
  statusTone?: 'ok' | 'warn' | 'critical' | 'info' | 'muted';
  history?: number[];
  historyMax?: number | 'auto';
  percentForColor?: number;
  footer?: ReactNode;
  /** Explicit chart colour for metrics that have no severity scale
      (network throughput has no "bad" value to threshold against). */
  chartColor?: string;
}) {
  const color = chartColor ?? severityColor(percentForColor);

  return (
    <div className="card flex min-w-0 flex-col justify-between px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-[var(--text-muted)]">{label}</span>
        <Badge tone={statusTone ?? 'muted'}>{status}</Badge>
      </div>

      <div className="mt-2 flex items-baseline gap-1 whitespace-nowrap">
        <span className="tabular text-[26px] font-medium leading-none text-[var(--text)]">
          {value}
        </span>
        {unit && <span className="text-[13px] text-[var(--text-muted)]">{unit}</span>}
      </div>

      {/* Fixed-height footer slot keeps every hero card exactly the same
          height whether it has a chart, a bar, or neither. */}
      <div className="mt-2 flex h-6 items-end">
        {footer ? (
          <div className="w-full">{footer}</div>
        ) : history && history.length > 1 ? (
          <Sparkline points={history} color={color} height={24} max={historyMax} />
        ) : null}
      </div>
    </div>
  );
}

function usageTone(percent: number): 'ok' | 'warn' | 'critical' {
  if (percent >= 90) return 'critical';
  if (percent >= 70) return 'warn';
  return 'ok';
}

function usageWord(percent: number): string {
  if (percent >= 90) return 'Critical';
  if (percent >= 70) return 'High';
  return 'Normal';
}

export default function OverviewView({ data }: OverviewViewProps) {
  const cpuHistory = useMetricHistory(data.cpu.usedPercent);
  const ramHistory = useMetricHistory(data.ram.usedPercent);

  const totalRx = data.network.reduce((sum, n) => sum + n.rxKBps, 0);
  const totalTx = data.network.reduce((sum, n) => sum + n.txKBps, 0);
  const netHistory = useMetricHistory(totalRx);

  // Busiest disk stands in for "Disk" at Level 1 — the full per-drive
  // breakdown lives on the Storage page rather than crowding Overview.
  const busiestDisk =
    data.disks.length > 0
      ? data.disks.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a))
      : null;

  const battery = data.battery;
  const topProcesses = [...data.processes]
    .sort((a, b) => b.memoryMB - a.memoryMB)
    .slice(0, 6);

  return (
    <ViewContainer>
      {/* ---- Level 1: live state, visible without scrolling ---- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <HeroMetric
          label="CPU"
          value={data.cpu.usedPercent.toFixed(1)}
          unit="%"
          status={usageWord(data.cpu.usedPercent)}
          statusTone={usageTone(data.cpu.usedPercent)}
          history={cpuHistory}
          percentForColor={data.cpu.usedPercent}
        />
        <HeroMetric
          label="Memory"
          value={data.ram.usedPercent.toFixed(1)}
          unit="%"
          status={`${(data.ram.usedMB / 1024).toFixed(1)} / ${(data.ram.totalMB / 1024).toFixed(1)} GB`}
          statusTone={usageTone(data.ram.usedPercent)}
          history={ramHistory}
          percentForColor={data.ram.usedPercent}
        />
        <HeroMetric
          label="Disk"
          value={busiestDisk ? busiestDisk.usedPercent.toFixed(0) : '—'}
          unit={busiestDisk ? '%' : undefined}
          status={busiestDisk ? busiestDisk.name : 'No drives'}
          statusTone={busiestDisk ? usageTone(busiestDisk.usedPercent) : 'muted'}
          percentForColor={busiestDisk?.usedPercent}
          footer={
            busiestDisk ? <UsageBar percent={busiestDisk.usedPercent} compact /> : undefined
          }
        />
        <HeroMetric
          label="Network"
          value={totalRx.toFixed(0)}
          unit="KB/s down"
          status={`${totalTx.toFixed(0)} KB/s up`}
          statusTone="info"
          history={netHistory}
          historyMax="auto"
          chartColor="var(--info)"
        />
        <HeroMetric
          label="Battery"
          value={
            battery.available && battery.capacityPercent !== null
              ? battery.capacityPercent.toFixed(0)
              : '—'
          }
          unit={battery.available && battery.capacityPercent !== null ? '%' : undefined}
          status={battery.available ? (battery.status ?? 'Unknown') : 'None'}
          statusTone={
            !battery.available
              ? 'muted'
              : battery.status === 'Charging'
                ? 'ok'
                : battery.capacityPercent !== null && battery.capacityPercent <= 20
                  ? 'critical'
                  : 'info'
          }
          percentForColor={
            battery.available && battery.capacityPercent !== null
              ? 100 - battery.capacityPercent
              : undefined
          }
        />
      </div>

      {/* ---- Level 2: shared activity trend ---- */}
      <Panel
        title="System activity"
        meta="last ~80 seconds"
        action={
          <div className="flex items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
              CPU
            </span>
            <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--info)' }} />
              Memory
            </span>
          </div>
        }
      >
        <div className="relative h-24">
          <div className="absolute inset-0">
            <Sparkline points={ramHistory} color="var(--info)" height={96} />
          </div>
          <div className="absolute inset-0">
            <Sparkline points={cpuHistory} color="var(--accent)" height={96} />
          </div>
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-[var(--text-faint)]">
          <span>0%</span>
          <span>100% scale</span>
        </div>
      </Panel>

      {/* ---- Level 2: supporting detail, two equal columns ---- */}
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
        <Panel title="Top processes" meta="by memory" noPad bodyClassName="px-2 py-1.5">
          {topProcesses.length === 0 ? (
            <p className="px-2 py-3 text-[13px] text-[var(--text-faint)]">
              No process data available.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {topProcesses.map((p) => (
                <li
                  key={p.pid}
                  className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-[var(--surface-hover)]"
                >
                  <span className="tabular w-14 shrink-0 text-[12px] text-[var(--text-faint)]">
                    {p.pid}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">
                    {p.name}
                  </span>
                  <span className="tabular shrink-0 text-[12px] text-[var(--text-muted)]">
                    {p.memoryMB >= 1024
                      ? `${(p.memoryMB / 1024).toFixed(1)} GB`
                      : `${p.memoryMB.toFixed(0)} MB`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Storage"
          meta={`${data.disks.length} drive${data.disks.length === 1 ? '' : 's'}`}
        >
          {data.disks.length === 0 ? (
            <p className="text-[13px] text-[var(--text-faint)]">No drives reported.</p>
          ) : (
            <div className="space-y-2.5">
              {data.disks.slice(0, 4).map((d) => (
                <div key={d.name}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] text-[var(--text)]">
                      {d.name}
                      {d.volumeLabel && (
                        <span className="ml-1.5 text-[12px] text-[var(--text-faint)]">
                          {d.volumeLabel}
                        </span>
                      )}
                    </span>
                    <span className="tabular shrink-0 text-[12px] text-[var(--text-muted)]">
                      {d.freeGB.toFixed(0)} GB free · {d.totalGB.toFixed(0)} GB
                    </span>
                  </div>
                  <UsageBar percent={d.usedPercent} compact />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ---- Level 2: network + power summary, compact ---- */}
      <TileGrid cols={4}>
        <StatTile
          label="Download"
          value={totalRx.toFixed(1)}
          unit="KB/s"
          detail={`${data.network.length} interface${data.network.length === 1 ? '' : 's'}`}
          accent="var(--info)"
        />
        <StatTile label="Upload" value={totalTx.toFixed(1)} unit="KB/s" accent="var(--info)" />
        <StatTile label="Processes" value={String(data.processes.length)} unit="running" />
        <StatTile
          label="Battery health"
          value={
            battery.available && battery.healthPercent !== null
              ? battery.healthPercent.toFixed(1)
              : '—'
          }
          unit={battery.available && battery.healthPercent !== null ? '%' : undefined}
          detail={
            !battery.available
              ? 'No battery'
              : battery.healthPercent === null
                ? 'Not reported by this device'
                : battery.cycleCount !== null
                  ? `${battery.cycleCount} cycles`
                  : 'Cycle count unavailable'
          }
        />
      </TileGrid>
    </ViewContainer>
  );
}
