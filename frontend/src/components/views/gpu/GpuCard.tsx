import { memo, type ReactNode } from 'react';
import { Gpu } from 'lucide-react';

import { useMetricHistory } from '../../../hooks/useMetricHistory';
import { formatMemory, formatNumber } from '../../../lib/format';
import { usageColor } from '../../../lib/hues';
import type { GpuAdapter, GpuLiveReading } from '../../../types/system';

import Panel from '../../common/Panel';
import Sparkline from '../../common/Sparkline';
import UsageBar from '../../common/UsageBar';
import { Badge, InfoRow, StatTile, TileGrid } from '../../common/Primitives';
import { NotReported, val } from '../ram/cells';

const unit = (suffix: string) => (n: number) => `${formatNumber(n, n % 1 === 0 ? 0 : 1)} ${suffix}`;
const celsius = unit('°C');
const mhz = unit('MHz');
const watts = unit('W');

function Metric({ label, value, detail, percent }: { label: string; value: ReactNode; detail?: ReactNode; percent?: number }) {
  return <StatTile label={label} value={value} detail={detail} percentForColor={percent} hue="gpu" />;
}

function Utilization({ reading, memoryLabel }: { reading: GpuLiveReading | undefined; memoryLabel: string }) {
  const percent = reading?.utilizationPercent ?? undefined;
  const history = useMetricHistory(percent);

  return (
    <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <div>
          <div className="mb-1.5 text-[12px] text-muted">GPU usage</div>
          {percent === undefined ? <NotReported hint={reading?.note ?? undefined} /> : <UsageBar percent={percent} hue="gpu" />}
        </div>
        <div>
          <div className="mb-1.5 text-[12px] text-muted">{memoryLabel}</div>
          {reading?.memoryUsagePercent == null ? <NotReported /> : <UsageBar percent={reading.memoryUsagePercent} hue="gpu" />}
        </div>
      </div>
      <Sparkline points={history} color={usageColor(percent, 'gpu')} height={72} />
    </div>
  );
}

function Engines({ reading }: { reading: GpuLiveReading }) {
  const engines = reading.engines?.slice(0, 4);
  if (!engines?.length) return null;
  return (
    <div className="mt-1 text-[12px] text-faint">
      {engines.map((e) => `${e.instanceName.split('_engtype_').pop() ?? 'Engine'} ${formatNumber(e.usagePercent, 0)}%`).join(' · ')}
    </div>
  );
}

function GpuCard({ adapter, reading }: { adapter: GpuAdapter; reading: GpuLiveReading | undefined }) {
  const memory = adapter.dedicatedMemoryBytes;
  const used = reading?.memoryUsedBytes;
  const total = reading?.memoryTotalBytes ?? memory;
  const unified = adapter.integrated === true;
  const memoryLabel = unified ? 'Graphics memory' : 'Video memory';
  const fan = reading?.fanPercent != null ? `${reading.fanPercent}%` : reading?.fanRpm != null ? `${reading.fanRpm} RPM` : null;

  return (
    <Panel
      title={adapter.name}
      icon={Gpu}
      hue="gpu"
      meta={
        <span className="flex items-center gap-1.5">
          {adapter.integrated !== null && <Badge tone="muted" dot={false}>{adapter.integrated ? 'Integrated' : 'Discrete'}</Badge>}
          {adapter.primary && <Badge tone="info" dot={false}>Primary</Badge>}
        </span>
      }
    >
      <div className="space-y-4">
        <Utilization reading={reading} memoryLabel={memoryLabel} />
        {reading && <Engines reading={reading} />}

        <TileGrid>
          <Metric label="Temperature" value={val(reading?.temperatureC, celsius)} percent={reading?.temperatureC ?? undefined} detail={reading?.memoryTemperatureC != null ? `Memory ${celsius(reading.memoryTemperatureC)}` : undefined} />
          <Metric label="Power" value={val(reading?.powerWatts, watts)} detail={reading?.powerLimitWatts != null ? `Limit ${watts(reading.powerLimitWatts)}` : undefined} />
          <Metric label="Core clock" value={val(reading?.coreClockMhz, mhz)} detail={reading?.memoryClockMhz != null ? `Memory ${mhz(reading.memoryClockMhz)}` : undefined} />
          <Metric label={unified ? 'Graphics memory' : 'VRAM'} value={used != null ? formatMemory(used) : <NotReported />} detail={total ? `of ${formatMemory(total)}` : undefined} />
        </TileGrid>

        <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
          <div>
            <InfoRow label="Vendor" value={val(adapter.vendor, String)} />
            <InfoRow label="Driver" value={val(adapter.driverVersion ?? adapter.driver, String)} />
            {adapter.driverDate && <InfoRow label="Driver date" value={adapter.driverDate} />}
            <InfoRow label="Dedicated memory" value={val(memory, formatMemory)} />
            <InfoRow label="Shared memory" value={val(adapter.sharedMemoryBytes, formatMemory)} />
          </div>
          <div>
            <InfoRow label="PCI address" value={val(adapter.pciAddress, String)} />
            <InfoRow label="Device ID" value={adapter.vendorId && adapter.deviceId ? `${adapter.vendorId}:${adapter.deviceId}` : <NotReported />} />
            {fan && <InfoRow label="Fan" value={fan} />}
            {reading?.voltageV != null && <InfoRow label="Voltage" value={`${formatNumber(reading.voltageV, 2)} V`} />}
            {reading?.performanceState && <InfoRow label="Performance state" value={reading.performanceState} />}
            {!unified && reading?.sharedMemoryUsedBytes != null && <InfoRow label="Shared memory used" value={formatMemory(reading.sharedMemoryUsedBytes)} />}
          </div>
        </div>

        {reading?.note && <p className="text-[12px] text-faint">{reading.note}</p>}
      </div>
    </Panel>
  );
}

export default memo(GpuCard);
