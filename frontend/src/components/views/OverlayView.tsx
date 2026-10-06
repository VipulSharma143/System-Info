import { memo } from 'react';

import { useCpuDetail } from '../../hooks/useCpuDetail';
import { useGpu } from '../../hooks/useGpu';
import { useSystemInfo } from '../../hooks/useSystemInfo';
import type { RamInfo } from '../../types/system';

import { ViewContainer } from '../common/Primitives';

import GpuCard from './gpu/GpuCard';
import CpuPanel from './overlay/CpuPanel';
import OverlayTable from './overlay/OverlayTable';

const POLL_MS = 1500;

interface OverlayViewProps {
  active: boolean;
  /** Live system memory from the dashboard poll, so this page makes no extra request for it. */
  ram: RamInfo | null;
}

/** The table answers "how hot and how busy is everything" at a glance; the panels below hold the detail. */
function OverlayView({ active, ram }: OverlayViewProps) {
  const cpu = useCpuDetail(active, POLL_MS);
  const { hardware, live } = useGpu(active, POLL_MS);
  const { info } = useSystemInfo(active);

  const adapters = hardware.data?.adapters ?? [];
  const readings = new Map(live.data?.readings.map((r) => [r.id, r]));

  return (
    <ViewContainer>
      <OverlayTable cpu={cpu.data} info={info} adapters={adapters} readings={readings} ram={ram} />
      <CpuPanel cpu={cpu.data} info={info} />
      {adapters.map((adapter) => (
        <GpuCard key={adapter.id} adapter={adapter} reading={readings.get(adapter.id)} />
      ))}
    </ViewContainer>
  );
}

export default memo(OverlayView);
