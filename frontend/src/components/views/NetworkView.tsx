import { memo } from 'react';
import type { NetworkInfo } from '../../types/system';
import type { DashboardHistory } from '../../hooks/useDashboardHistory';
import { StatTile, TileGrid, ViewContainer } from '../common/Primitives';
import SpeedTestCard from '../SpeedTestCard';
import { formatRate } from '../../lib/format';
import { interfaceRows, isLive } from '../../lib/network';
import InterfacesPanel from './network/InterfacesPanel';
import PrimaryInterface from './network/PrimaryInterface';
import TrafficPanel from './network/TrafficPanel';

/*
  Live traffic is KB/s measured on local interfaces; the speed test is Mbps measured against a
  remote server. They are different things, so they live in separate panels with separate labels.
  Order: headline numbers, live traffic beside the busiest interface, every interface, then the speed test.
*/
function NetworkView({ network, history }: { network: NetworkInfo[]; history: DashboardHistory }) {
  const rx = network.reduce((sum, n) => sum + n.rxKBps, 0);
  const tx = network.reduce((sum, n) => sum + n.txKBps, 0);
  const activeCount = network.filter(isLive).length;
  const busiest = interfaceRows(network)[0];

  return (
    <ViewContainer>
      <TileGrid cols={4}>
        <StatTile hue="net" label="Download" value={formatRate(rx)} detail="all interfaces" />
        <StatTile hue="net" label="Upload" value={formatRate(tx)} detail="all interfaces" />
        <StatTile hue="net" label="Active interfaces" value={String(activeCount)} detail={`of ${network.length}`} />
        <StatTile hue="net" label="Busiest interface" value={busiest && busiest.live ? busiest.net.iface : '—'} detail={busiest && busiest.live ? `${busiest.share.toFixed(0)}% of traffic` : 'nothing moving'} />
      </TileGrid>
      <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TrafficPanel rx={rx} tx={tx} rxHistory={history.rx} txHistory={history.tx} active={activeCount > 0} />
        </div>
        <PrimaryInterface network={network} />
      </div>
      <InterfacesPanel network={network} />
      <SpeedTestCard />
    </ViewContainer>
  );
}

export default memo(NetworkView);
