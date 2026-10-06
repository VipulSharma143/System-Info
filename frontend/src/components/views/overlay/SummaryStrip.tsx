import { memo, type ReactNode } from 'react';

import { formatMemory, formatNumber } from '../../../lib/format';
import type { CpuDetail, GpuAdapter, GpuLiveReading } from '../../../types/system';

import { StatTile, TileGrid } from '../../common/Primitives';
import { NotReported, val } from '../ram/cells';

const celsius = (n: number) => `${formatNumber(n, 0)} °C`;
const watts = (n: number) => `${formatNumber(n, n % 1 === 0 ? 0 : 1)} W`;
const percent = (n: number) => `${formatNumber(n, 0)}%`;

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="truncate text-[12px] font-medium uppercase tracking-wide text-faint">{title}</div>
      <TileGrid>{children}</TileGrid>
    </div>
  );
}

function CpuRow({ cpu }: { cpu: CpuDetail | null }) {
  const clockDetail = cpu?.highestClockMhz != null ? `Highest ${formatNumber(cpu.highestClockMhz, 0)} MHz` : undefined;
  return (
    <Row title="CPU">
      <StatTile label="Usage" value={val(cpu?.totalUsagePercent, percent)} percentForColor={cpu?.totalUsagePercent ?? undefined} hue="cpu" />
      <StatTile label="Temperature" value={val(cpu?.packageTemperatureC, celsius)} percentForColor={cpu?.packageTemperatureC ?? undefined} hue="cpu" />
      <StatTile label="Clock speed" value={val(cpu?.averageClockMhz, (n) => `${formatNumber(n, 0)} MHz`)} detail={clockDetail} hue="cpu" />
      <StatTile label="Power" value={val(cpu?.powerWatts, watts)} hue="cpu" />
    </Row>
  );
}

function GpuRow({ adapter, reading }: { adapter: GpuAdapter; reading: GpuLiveReading | undefined }) {
  const total = reading?.memoryTotalBytes ?? adapter.dedicatedMemoryBytes;
  const used = reading?.memoryUsedBytes;
  const memoryPercent = reading?.memoryUsagePercent ?? undefined;
  return (
    <Row title={adapter.name}>
      <StatTile label="Usage" value={val(reading?.utilizationPercent, percent)} percentForColor={reading?.utilizationPercent ?? undefined} hue="gpu" />
      <StatTile label="Temperature" value={val(reading?.temperatureC, celsius)} percentForColor={reading?.temperatureC ?? undefined} hue="gpu" />
      <StatTile
        label={adapter.integrated ? 'Graphics memory' : 'VRAM'}
        value={used != null ? formatMemory(used) : <NotReported />}
        detail={total ? `of ${formatMemory(total)}${memoryPercent !== undefined ? ` · ${formatNumber(memoryPercent, 0)}%` : ''}` : undefined}
        percentForColor={memoryPercent}
        hue="gpu"
      />
      <StatTile
        label="Clock · power"
        value={val(reading?.coreClockMhz, (n) => `${formatNumber(n, 0)} MHz`)}
        detail={reading?.powerWatts != null ? watts(reading.powerWatts) : undefined}
        hue="gpu"
      />
    </Row>
  );
}

function SummaryStrip({ cpu, adapters, readings }: { cpu: CpuDetail | null; adapters: GpuAdapter[]; readings: Map<string, GpuLiveReading> }) {
  return (
    <div className="space-y-4">
      <CpuRow cpu={cpu} />
      {adapters.map((adapter) => <GpuRow key={adapter.id} adapter={adapter} reading={readings.get(adapter.id)} />)}
    </div>
  );
}

export default memo(SummaryStrip);
