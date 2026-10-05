import { memo } from 'react';
import { Gpu as GpuIcon, RefreshCw } from 'lucide-react';

import { useGpu } from '../../hooks/useGpu';
import { inlineMessage, safeMessage } from '../../lib/errors';

import Button from '../common/Button';
import Panel from '../common/Panel';
import Skeleton from '../common/Skeleton';
import { EmptyState, ErrorState } from '../common/States';
import { ViewContainer } from '../common/Primitives';

import GpuCard from './gpu/GpuCard';

function GpuView({ active }: { active: boolean }) {
  const { hardware, live } = useGpu(active);
  const adapters = hardware.data?.adapters ?? [];

  if (hardware.loading) {
    return (
      <ViewContainer>
        <Panel title="Graphics" icon={GpuIcon} hue="gpu"><Skeleton className="h-40" /></Panel>
      </ViewContainer>
    );
  }

  if (!hardware.data?.available) {
    return (
      <ViewContainer>
        <Panel>
          <EmptyState
            icon={GpuIcon}
            hue="gpu"
            title="No graphics adapter found"
            description={hardware.error ? 'Graphics details could not be loaded.' : safeMessage(hardware.data?.note, 'This system did not report a graphics adapter.')}
            action={<Button size="sm" icon={RefreshCw} onClick={hardware.retry}>Try again</Button>}
          />
          {hardware.error && <div className="mt-2"><ErrorState message={inlineMessage('systemInfo')} /></div>}
        </Panel>
      </ViewContainer>
    );
  }

  const readings = new Map(live.data?.readings.map((r) => [r.id, r]));

  return (
    <ViewContainer>
      {adapters.map((adapter) => (
        <GpuCard key={adapter.id} adapter={adapter} reading={readings.get(adapter.id)} />
      ))}
    </ViewContainer>
  );
}

export default memo(GpuView);
