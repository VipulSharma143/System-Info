import { memo } from 'react';
import type { SystemSnapshot } from '../../types/system';
import type { DashboardHistory } from '../../hooks/useDashboardHistory';
import { ViewContainer } from '../common/Primitives';
import ActivityPanel from './overview/ActivityPanel';
import LiveTiles from './overview/LiveTiles';
import StatusHero from './overview/StatusHero';
import StoragePanel from './overview/StoragePanel';
import TopProcessesPanel from './overview/TopProcessesPanel';

/*
  Overview answers one question — "what is happening on my computer right now?" — top to bottom:
  a one-line verdict with the key numbers, the three live metrics, the shared activity chart, then
  the heaviest processes beside storage.
*/
function OverviewView({ data, history }: { data: SystemSnapshot; history: DashboardHistory }) {
  return (
    <ViewContainer>
      <StatusHero cpu={data.cpu} ram={data.ram} disks={data.disks} network={data.network} battery={data.battery} processCount={data.processes.length} />
      <LiveTiles cpu={data.cpu} ram={data.ram} network={data.network} history={history} />
      <ActivityPanel cpu={history.cpu} ram={history.ram} />
      <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-2">
        <TopProcessesPanel processes={data.processes} />
        <StoragePanel disks={data.disks} />
      </div>
    </ViewContainer>
  );
}

export default memo(OverviewView);
