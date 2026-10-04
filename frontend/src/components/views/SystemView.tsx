import { memo } from 'react';
import { Laptop } from 'lucide-react';
import type { GpuInfo, SystemIdentification, SystemSnapshot } from '../../types/system';
import { ALERT_COPY } from '../../lib/errors';
import Button from '../common/Button';
import Panel from '../common/Panel';
import { EmptyState, LoadingState } from '../common/States';
import { ViewContainer } from '../common/Primitives';
import GpuPanels from './system/GpuPanels';
import { ApplicationPanel, IdentityPanels, SystemTiles } from './system/IdentityPanels';

interface SystemViewProps {
  info: SystemIdentification | null;
  infoError: string | null;
  onRetryInfo: () => void;
  data: SystemSnapshot;
  gpus: GpuInfo[] | null;
  gpuError: string | null;
}

/*
  Reference information the user reads once, not something they monitor — so it is a spec-sheet
  layout (label ··· value), not a grid of large cards.
*/
function SystemView({ info, infoError, onRetryInfo, data, gpus, gpuError }: SystemViewProps) {
  if (infoError) {
    return (
      <ViewContainer>
        <Panel>
          <EmptyState
            icon={Laptop}
            hue="sys"
            title={ALERT_COPY.systemInfo.title}
            description={`${infoError} Live monitoring is unaffected; only this reference page needs this information.`}
            action={<Button onClick={onRetryInfo}>Try again</Button>}
          />
        </Panel>
      </ViewContainer>
    );
  }

  if (!info) {
    return (
      <ViewContainer>
        <Panel>
          <LoadingState label="Collecting hardware information…" />
        </Panel>
      </ViewContainer>
    );
  }

  return (
    <ViewContainer>
      <SystemTiles info={info} ram={data.ram} />
      <IdentityPanels info={info} ram={data.ram} cpuPercent={data.cpu.usedPercent} />
      <GpuPanels gpus={gpus} error={gpuError} />
      <ApplicationPanel info={info} drives={data.disks.length} interfaces={data.network.length} />
    </ViewContainer>
  );
}

export default memo(SystemView);
