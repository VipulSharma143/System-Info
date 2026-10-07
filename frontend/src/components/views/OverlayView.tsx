import { memo, useMemo } from 'react';

import { useCpuDetail } from '../../hooks/useCpuDetail';
import { useGpu } from '../../hooks/useGpu';
import { useJsonResource } from '../../hooks/useJsonResource';
import { useSystemInfo } from '../../hooks/useSystemInfo';
import type { MemoryHardwareInfo, RamDetails } from '../../types/system';

import { ViewContainer } from '../common/Primitives';

import CpuPanel from './overlay/CpuPanel';
import GpuPanel from './overlay/GpuPanel';
import HardwareSummary from './overlay/HardwareSummary';
import MemoryPanel from './overlay/MemoryPanel';
import SummaryTiles from './overlay/SummaryTiles';
import { cpuView, gpuView, memoryView } from './overlay/model';

const CPU_POLL_MS = 2000;
const RAM_POLL_MS = 3000;

/**
 * Hardware monitor. Every request is gated on `active`, so the page costs nothing while hidden; static data
 * (identity, adapters, DIMMs) is fetched once and live data is polled by the same shared hooks the other pages use.
 */
function OverlayView({ active }: { active: boolean }) {
  const cpu = useCpuDetail(active, CPU_POLL_MS);
  const { hardware: gpuHardware, live: gpuLive } = useGpu(active, CPU_POLL_MS);
  const { info } = useSystemInfo(active);
  const ram = useJsonResource<RamDetails>('/api/system/ram', { active, intervalMs: RAM_POLL_MS });
  const memoryHardware = useJsonResource<MemoryHardwareInfo>('/api/system/memory/hardware', { active });

  const cpuModel = useMemo(() => cpuView(cpu.data, info?.physicalCores ?? null, info?.logicalProcessors ?? null), [cpu.data, info?.physicalCores, info?.logicalProcessors]);
  const gpus = useMemo(() => {
    const readings = new Map(gpuLive.data?.readings.map((r) => [r.id, r]));
    return (gpuHardware.data?.adapters ?? []).map((adapter) => gpuView(adapter, readings.get(adapter.id)));
  }, [gpuHardware.data, gpuLive.data]);
  const memory = useMemo(() => memoryView(ram.data), [ram.data]);

  return (
    <ViewContainer>
      <SummaryTiles cpu={cpuModel} gpus={gpus} memory={memory} />
      <CpuPanel cpu={cpu.data} view={cpuModel} model={info?.cpuModel ?? null} architecture={info?.processArchitecture ?? null} />
      <GpuPanel gpus={gpus} available={gpuHardware.data?.available ?? null} />
      <MemoryPanel memory={memory} hardware={memoryHardware.data} />
      <HardwareSummary info={info} cpu={cpuModel} gpus={gpus} memory={memory} hardware={memoryHardware.data} />
    </ViewContainer>
  );
}

export default memo(OverlayView);
