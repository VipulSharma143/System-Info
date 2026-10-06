import { memo } from 'react';
import { Cpu, Gpu, MemoryStick } from 'lucide-react';

import { useCpuDetail } from '../../hooks/useCpuDetail';
import { useGpu } from '../../hooks/useGpu';
import { useSystemInfo } from '../../hooks/useSystemInfo';
import { formatMB, formatMemory, formatNumber } from '../../lib/format';
import type { CpuDetail, GpuAdapter, GpuLiveReading, RamInfo } from '../../types/system';

import { ViewContainer } from '../common/Primitives';

import MetricTile, { type TileStat } from './overlay/MetricTile';

const POLL_MS = 2000;

const warmth = (celsius: number | null | undefined) => (celsius == null ? undefined : celsius >= 85 ? 'var(--critical)' : celsius >= 75 ? 'var(--warn)' : undefined);
const degrees = (celsius: number | null | undefined) => (celsius == null ? null : `${formatNumber(celsius, 0)} °C`);

interface OverlayViewProps {
  active: boolean;
  /** Live system memory from the dashboard poll, so this page makes no extra request for it. */
  ram: RamInfo | null;
}

function CpuTile({ cpu, model }: { cpu: CpuDetail | null; model: string | null | undefined }) {
  const stats: TileStat[] = [
    { label: 'Temperature', value: degrees(cpu?.packageTemperatureC), color: warmth(cpu?.packageTemperatureC), hint: cpu?.note },
  ];
  return <MetricTile icon={Cpu} hue="cpu" title="CPU" subtitle={model} percent={cpu?.totalUsagePercent} pending={cpu !== null} stats={stats} />;
}

function RamTile({ ram }: { ram: RamInfo | null }) {
  const stats: TileStat[] = [
    { label: 'Used', value: ram ? formatMB(ram.usedMB, 1) : null },
    { label: 'Total', value: ram ? formatMB(ram.totalMB, 1) : null },
  ];
  return <MetricTile icon={MemoryStick} hue="ram" title="Memory" percent={ram?.usedPercent} stats={stats} />;
}

function GpuTile({ adapter, reading }: { adapter: GpuAdapter; reading: GpuLiveReading | undefined }) {
  const total = reading?.memoryTotalBytes ?? adapter.dedicatedMemoryBytes;
  const used = reading?.memoryUsedBytes;
  const memory = used != null ? `${formatMemory(used)}${total ? ` / ${formatMemory(total)}` : ''}` : null;
  const stats: TileStat[] = [
    { label: 'Video memory', value: memory, hint: reading?.note },
    { label: 'Temperature', value: degrees(reading?.temperatureC), color: warmth(reading?.temperatureC), hint: reading?.note },
  ];
  const kind = adapter.integrated === null ? null : adapter.integrated ? 'Integrated' : 'Discrete';
  return <MetricTile icon={Gpu} hue="gpu" title={adapter.name} subtitle={kind} percent={reading?.utilizationPercent} pending={reading !== undefined} stats={stats} />;
}

/** CPU, memory and every GPU as compact live tiles: utilisation, temperature and memory, nothing else. */
function OverlayView({ active, ram }: OverlayViewProps) {
  const cpu = useCpuDetail(active, POLL_MS);
  const { hardware, live } = useGpu(active, POLL_MS);
  const { info } = useSystemInfo(active);

  const adapters = hardware.data?.adapters ?? [];
  const readings = new Map(live.data?.readings.map((r) => [r.id, r]));

  return (
    <ViewContainer>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">
        <CpuTile cpu={cpu.data} model={info?.cpuModel} />
        <RamTile ram={ram} />
        {adapters.map((adapter) => (
          <GpuTile key={adapter.id} adapter={adapter} reading={readings.get(adapter.id)} />
        ))}
      </div>
    </ViewContainer>
  );
}

export default memo(OverlayView);
