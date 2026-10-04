import { memo } from 'react';
import { Cable } from 'lucide-react';
import type { NetworkInfo } from '../../../types/system';
import { formatRate } from '../../../lib/format';
import { isLive } from '../../../lib/network';
import { EmptyState } from '../../common/States';
import Panel from '../../common/Panel';
import { Badge } from '../../common/Primitives';
import { Td, Th, Tr } from '../../common/Table';

/** Every interface the OS reports. Loopback and idle adapters stay listed, marked Idle, never hidden. */
function InterfacesPanel({ network }: { network: NetworkInfo[] }) {
  const activeCount = network.filter(isLive).length;
  return (
    <Panel title="Interfaces" icon={Cable} hue="net" meta={`${network.length} total · ${activeCount} active`} noPad>
      {network.length === 0 ? (
        <EmptyState icon={Cable} hue="net" title="No network interfaces reported" description="Connect to a network and this list fills in on its own." />
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
                const live = isLive(n);
                return (
                  <Tr key={n.iface}>
                    <Td className="font-medium">{n.iface}</Td>
                    <Td><Badge tone={live ? 'ok' : 'muted'}>{live ? 'Active' : 'Idle'}</Badge></Td>
                    <Td className="num text-right">{formatRate(n.rxKBps)}</Td>
                    <Td className="num text-right">{formatRate(n.txKBps)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export default memo(InterfacesPanel);
