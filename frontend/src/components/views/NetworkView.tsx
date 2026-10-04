import { memo } from 'react';
import type { NetworkInfo } from '../../types/system';
import type { DashboardHistory } from '../../hooks/useDashboardHistory';
import { ViewContainer } from '../common/Primitives';
import SpeedTestCard from '../SpeedTestCard';
import { isLive } from '../../lib/network';
import InterfacesPanel from './network/InterfacesPanel';
import PrimaryInterface from './network/PrimaryInterface';
import TrafficPanel from './network/TrafficPanel';

/*
  Live traffic is KB/s measured on local interfaces; the speed test is Mbps measured against a
  remote server. They are different things, so they live in separate panels with separate labels.
*/
function NetworkView({ network, history }: { network: NetworkInfo[]; history: DashboardHistory }) {
  const rx = network.reduce((sum, n) => sum + n.rxKBps, 0);
  const tx = network.reduce((sum, n) => sum + n.txKBps, 0);

  return (
    <ViewContainer>
      <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TrafficPanel rx={rx} tx={tx} rxHistory={history.rx} txHistory={history.tx} active={network.some(isLive)} />
        </div>
        <PrimaryInterface network={network} />
      </div>
      <InterfacesPanel network={network} />
      <SpeedTestCard />
    </ViewContainer>
  );
}

export default memo(NetworkView);
