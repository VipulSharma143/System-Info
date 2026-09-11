import { Network as NetworkIcon } from 'lucide-react';
import type { NetworkInfo } from '../types/system';
import Panel from './common/Panel';
import { Th, Td, Tr } from './common/Table';
import { EmptyState } from './common/States';

interface NetworkTableProps {
  network: NetworkInfo[];
}

export default function NetworkTable({ network }: NetworkTableProps) {
  return (
    <Panel title="Interfaces" meta={network.length ? `${network.length} active` : undefined} noPad>
      {network.length === 0 ? (
        <EmptyState icon={NetworkIcon} title="No network interfaces reported" />
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Interface</Th>
              <Th className="text-right">Down</Th>
              <Th className="text-right">Up</Th>
            </tr>
          </thead>
          <tbody>
            {network.map((n) => (
              <Tr key={n.iface}>
                <Td className="font-medium">{n.iface}</Td>
                <Td className="tabular text-right text-[var(--info)]">
                  {n.rxKBps} <span className="text-[var(--text-faint)]">KB/s</span>
                </Td>
                <Td className="tabular text-right text-[var(--accent)]">
                  {n.txKBps} <span className="text-[var(--text-faint)]">KB/s</span>
                </Td>
              </Tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
