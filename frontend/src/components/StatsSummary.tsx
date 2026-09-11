import type { StatsResponse } from '../types/analytics';
import Panel from './common/Panel';
import { Th, Td, Tr } from './common/Table';

export default function StatsSummary({ stats }: { stats: StatsResponse }) {
  const networkEntries = Object.entries(stats.network);
  return (
    <Panel title="Stats" meta={`${stats.count} samples`}>
      <div className="tabular mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[var(--text-muted)]">
        <span>CPU mean <span className="text-[var(--text)]">{stats.cpu_percent.mean}%</span></span>
        <span>min <span className="text-[var(--text)]">{stats.cpu_percent.min}%</span></span>
        <span>max <span className="text-[var(--text)]">{stats.cpu_percent.max}%</span></span>
      </div>
      {networkEntries.length > 0 && (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Interface</Th>
              <Th className="text-right">RX KB/s (mean / min / max)</Th>
              <Th className="text-right">TX KB/s (mean / min / max)</Th>
            </tr>
          </thead>
          <tbody>
            {networkEntries.map(([iface, n]) => (
              <Tr key={iface}>
                <Td className="font-medium">{iface}</Td>
                <Td className="tabular text-right text-[var(--text-muted)]">
                  {n.rx_kbps.mean} / {n.rx_kbps.min} / {n.rx_kbps.max}
                </Td>
                <Td className="tabular text-right text-[var(--text-muted)]">
                  {n.tx_kbps.mean} / {n.tx_kbps.min} / {n.tx_kbps.max}
                </Td>
              </Tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
