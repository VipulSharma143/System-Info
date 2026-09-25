import type { NetworkInfo } from '../../types/system';
import { useMetricHistory } from '../../hooks/useMetricHistory';
import Panel from '../common/Panel';
import Sparkline from '../common/Sparkline';
import SpeedTestCard from '../SpeedTestCard';
import { Badge, StatTile, TileGrid, ViewContainer } from '../common/Primitives';
import { Th, Td, Tr } from '../common/Table';

interface NetworkViewProps {
  network: NetworkInfo[];
}

/*
  Network was previously one large table with very little in it. The
  redesign splits it into four right-sized blocks:

    Current traffic (live totals + chart)  |  Interface summary
    Traffic history (wide chart)
    Interfaces (compact table)
    Internet speed test (contained, not dominating the page)

  Speed-test numbers are Mbps measured against a remote server; the live
  traffic numbers are KB/s measured on local interfaces. Those are
  different things, so they're kept visually distinct and separately
  labelled rather than sitting in one undifferentiated grid.
*/

function formatRate(kbps: number): string {
  return kbps >= 1024 ? `${(kbps / 1024).toFixed(2)} MB/s` : `${kbps.toFixed(1)} KB/s`;
}

export default function NetworkView({ network }: NetworkViewProps) {
  const totalRx = network.reduce((sum, n) => sum + n.rxKBps, 0);
  const totalTx = network.reduce((sum, n) => sum + n.txKBps, 0);

  const rxHistory = useMetricHistory(totalRx);
  const txHistory = useMetricHistory(totalTx);

  const trafficScale =
    rxHistory.length > 0 ? Math.max(...rxHistory, ...txHistory) * 1.15 || 1 : 1;

  // An interface counts as "active" if it's actually moving bytes right
  // now. Loopback and idle adapters stay listed but are marked Idle rather
  // than being hidden — the user can see everything the OS reports.
  const active = network.filter((n) => n.rxKBps > 0.1 || n.txKBps > 0.1);
  const busiest =
    network.length > 0
      ? network.reduce((a, b) => (b.rxKBps + b.txKBps > a.rxKBps + a.txKBps ? b : a))
      : null;

  return (
    <ViewContainer>
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-3">
        {/* Live traffic — the primary answer on this page */}
        <Panel
          title="Current traffic"
          className="xl:col-span-2"
          action={
            <Badge tone={active.length > 0 ? 'ok' : 'muted'}>
              {active.length > 0 ? 'Active' : 'Idle'}
            </Badge>
          }
        >
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div>
              <div className="text-[12px] text-[var(--text-muted)]">Download</div>
              <div className="tabular mt-0.5 text-[24px] font-medium leading-none text-[var(--text)]">
                {formatRate(totalRx)}
              </div>
            </div>
            <div>
              <div className="text-[12px] text-[var(--text-muted)]">Upload</div>
              <div className="tabular mt-0.5 text-[24px] font-medium leading-none text-[var(--text)]">
                {formatRate(totalTx)}
              </div>
            </div>
          </div>

          <div className="relative mt-3 h-16">
            {/* Both series share one scale so up/down are visually
                comparable, and it's derived from the larger (rx) series.
                Math.max on an empty array returns -Infinity, hence the
                explicit floor. */}
            <div className="absolute inset-0">
              <Sparkline points={rxHistory} color="var(--info)" max={trafficScale} height={64} />
            </div>
            <div className="absolute inset-0">
              <Sparkline points={txHistory} color="var(--accent)" max={trafficScale} height={64} />
            </div>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--text-faint)]">
            <span className="inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--info)' }} />
                Down
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
                Up
              </span>
            </span>
            <span>last ~80 seconds</span>
          </div>
        </Panel>

        {/* Interface summary — compact, sized to its content */}
        <Panel title="Primary interface">
          {busiest ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[15px] font-medium text-[var(--text)]">
                  {busiest.iface}
                </span>
                <Badge tone={busiest.rxKBps + busiest.txKBps > 0.1 ? 'ok' : 'muted'}>
                  {busiest.rxKBps + busiest.txKBps > 0.1 ? 'Connected' : 'Idle'}
                </Badge>
              </div>
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-[var(--text-muted)]">Download</span>
                <span className="tabular text-[var(--text)]">{formatRate(busiest.rxKBps)}</span>
              </div>
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-[var(--text-muted)]">Upload</span>
                <span className="tabular text-[var(--text)]">{formatRate(busiest.txKBps)}</span>
              </div>
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-[var(--text-muted)]">Total interfaces</span>
                <span className="tabular text-[var(--text)]">{network.length}</span>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--text-faint)]">
              No network interfaces reported.
            </p>
          )}
        </Panel>
      </div>

      {/* All interfaces — compact rows, not one panel per adapter */}
      <Panel
        title="Interfaces"
        meta={`${network.length} total · ${active.length} active`}
        noPad
      >
        {network.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-[var(--text-faint)]">
            No network interfaces reported.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-flush w-full">
              <thead>
                <tr>
                  <Th>Interface</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Download</Th>
                  <Th className="text-right">Upload</Th>
                </tr>
              </thead>
              <tbody>
                {network.map((n) => {
                  const live = n.rxKBps > 0.1 || n.txKBps > 0.1;
                  return (
                    <Tr key={n.iface}>
                      <Td className="font-medium">{n.iface}</Td>
                      <Td>
                        <Badge tone={live ? 'ok' : 'muted'}>{live ? 'Active' : 'Idle'}</Badge>
                      </Td>
                      <Td className="tabular text-right">{formatRate(n.rxKBps)}</Td>
                      <Td className="tabular text-right">{formatRate(n.txKBps)}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Totals strip */}
      <TileGrid cols={4}>
        <StatTile label="Total download" value={formatRate(totalRx)} accent="var(--info)" />
        <StatTile label="Total upload" value={formatRate(totalTx)} accent="var(--accent)" />
        <StatTile label="Interfaces" value={String(network.length)} detail={`${active.length} active`} />
        <StatTile
          label="Combined throughput"
          value={formatRate(totalRx + totalTx)}
        />
      </TileGrid>

      {/* Speed test — part of the page, not the whole page */}
      <SpeedTestCard />
    </ViewContainer>
  );
}
