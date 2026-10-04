import { memo } from 'react';
import type { SystemSnapshot } from '../../types/system';
import type { DashboardHistory } from '../../hooks/useDashboardHistory';
import { ViewContainer } from '../common/Primitives';
import ActivityPanel from './overview/ActivityPanel';
import LiveTiles from './overview/LiveTiles';
import StoragePanel from './overview/StoragePanel';
import TopProcessesPanel from './overview/TopProcessesPanel';

/*
  Overview answers one question — "what is happening on my computer right now?" — inside one
  laptop viewport: five live tiles, one shared activity chart, then processes and storage.
*/
function OverviewView({ data, history }: { data: SystemSnapshot; history: DashboardHistory }) {
  return (
    <ViewContainer>
      <LiveTiles cpu={data.cpu} ram={data.ram} disks={data.disks} network={data.network} battery={data.battery} history={history} />
      <ActivityPanel cpu={history.cpu} ram={history.ram} />
      <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-2">
        <TopProcessesPanel processes={data.processes} />
        <StoragePanel disks={data.disks} />
      </div>
    </ViewContainer>
  );
}

export default memo(OverviewView);
