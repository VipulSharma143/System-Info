import { memo, useMemo } from 'react';

import { useCpuDetail } from '../../hooks/useCpuDetail';
import { useGpu } from '../../hooks/useGpu';
import { useJsonResource } from '../../hooks/useJsonResource';
import { useSystemInfo } from '../../hooks/useSystemInfo';
import type { RamDetails } from '../../types/system';

import { ViewContainer } from '../common/Primitives';

import CpuPanel from './overlay/CpuPanel';
import GpuPanel from './overlay/GpuPanel';
import LiveMonitor from './overlay/LiveMonitor';
import MemoryPanel from './overlay/MemoryPanel';
import { cpuView, gpuView, memoryView, orderGpus } from './overlay/model';

const CPU_POLL_MS = 1500;
const GPU_POLL_MS = 2000;
const RAM_POLL_MS = 2000;

/**
 * Live performance monitor. Each source is polled by the same shared hook the other pages use and only while this
 * tab is open; nothing here fetches static hardware data except the GPU adapter list (once, cached) the table
 * needs to label rows.
 */
function OverlayView({ active }: { active: boolean }) {
  const cpu = useCpuDetail(active, CPU_POLL_MS);
  const { hardware: gpuHardware, live: gpuLive } = useGpu(active, GPU_POLL_MS);
  const { info } = useSystemInfo(active);
  const ram = useJsonResource<RamDetails>('/api/system/ram', { active, intervalMs: RAM_POLL_MS });

  const cpuModel = useMemo(() => cpuView(cpu.data, info?.physicalCores ?? null, info?.logicalProcessors ?? null), [cpu.data, info?.physicalCores, info?.logicalProcessors]);
  const gpus = useMemo(() => {
    const readings = new Map(gpuLive.data?.readings.map((r) => [r.id, r]));
    return orderGpus((gpuHardware.data?.adapters ?? []).map((adapter) => gpuView(adapter, readings.get(adapter.id))));
  }, [gpuHardware.data, gpuLive.data]);
  const memory = useMemo(() => memoryView(ram.data), [ram.data]);

  return (
    <ViewContainer>
      <LiveMonitor
        cpu={cpuModel} cpuSampledAt={cpu.data?.sampledAtUnixMs}
        gpus={gpus} gpuSampledAt={gpuLive.data?.sampledAtUnixMs} gpusLoaded={gpuLive.data !== null || gpuHardware.data?.available === false}
        memory={memory} active={active}
      />
      <CpuPanel cpu={cpu.data} view={cpuModel} />
      <GpuPanel gpus={gpus} available={gpuHardware.data?.available ?? null} />
      <MemoryPanel memory={memory} />
    </ViewContainer>
  );
}

export default memo(OverlayView);
