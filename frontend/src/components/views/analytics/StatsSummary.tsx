import { memo } from 'react';
import { BarChart3 } from 'lucide-react';
import type { StatsResponse } from '../../../types/analytics';
import Figure from '../../common/Figure';
import { EmptyState } from '../../common/States';
import Panel from '../../common/Panel';
import { Td, Th, Tr } from '../../common/Table';

function StatsSummary({ stats }: { stats: StatsResponse }) {
  // cpu_percent / network are absent when the window has no history; reading .mean off undefined would blank the app.
  const networkEntries = Object.entries(stats.network ?? {});
  const cpu = stats.cpu_percent;

  if (!cpu) {
    return (
      <Panel title="Stats" icon={BarChart3} hue="analytics">
        <EmptyState icon={BarChart3} hue="analytics" title="No samples in this range yet" />
      </Panel>
    );
  }

  return (
    <Panel title="Stats" icon={BarChart3} hue="analytics" meta={`${stats.count} samples`}>
      <div className="mb-4 flex flex-wrap gap-x-8 gap-y-3">
        {([['Average', cpu.mean], ['Lowest', cpu.min], ['Highest', cpu.max]] as const).map(([label, value]) => (
          <div key={label}>
            <div className="mb-1 text-[12px] text-muted">Processor, {label.toLowerCase()}</div>
            <Figure size="md" value={value} unit="%" />
          </div>
        ))}
      </div>
      {networkEntries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <Th className="!pl-0">Interface</Th>
                <Th className="text-right">Download KB/s (avg / min / max)</Th>
                <Th className="text-right">Upload KB/s (avg / min / max)</Th>
              </tr>
            </thead>
            <tbody>
              {networkEntries.map(([iface, n]) => (
                <Tr key={iface}>
                  <Td className="!pl-0 font-medium">{iface}</Td>
                  <Td className="num text-right text-muted">{n.rx_kbps.mean} / {n.rx_kbps.min} / {n.rx_kbps.max}</Td>
                  <Td className="num text-right text-muted">{n.tx_kbps.mean} / {n.tx_kbps.min} / {n.tx_kbps.max}</Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export default memo(StatsSummary);
