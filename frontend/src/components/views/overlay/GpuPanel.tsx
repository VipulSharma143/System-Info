import { memo } from 'react';
import { Gpu } from 'lucide-react';

import { formatMemory, formatNumber } from '../../../lib/format';

import { Badge } from '../../common/Primitives';

import { hotness, type GpuView } from './model';
import { Meter, Metric, MetricGrid, Section, SubHeading } from './parts';

const degrees = (n: number | null) => (n == null ? null : `${formatNumber(n, 0)} °C`);
const memory = (n: number | null) => (n == null ? null : formatMemory(n));

function GpuCard({ gpu }: { gpu: GpuView }) {
  const vramLabel = gpu.kind === 'Integrated' ? 'Graphics memory' : 'VRAM';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{gpu.name}</div>
          <div className="text-[11px] text-faint">{gpu.vendor ?? 'Vendor not reported'}</div>
        </div>
        <div className="flex items-center gap-2">
          {gpu.kind && <Badge tone="muted" dot={false}>{gpu.kind}</Badge>}
          <Badge tone={gpu.status === 'live' ? 'ok' : 'muted'}>{gpu.status === 'live' ? 'Live' : 'No live data'}</Badge>
        </div>
      </div>

      <Meter percent={gpu.usage} hue="gpu" label={`${gpu.name} utilization`} />
      <MetricGrid>
        <Metric label="Utilization" value={gpu.usage == null ? null : `${formatNumber(gpu.usage, 0)}%`} hint={gpu.note} />
        <Metric label="Temperature" value={degrees(gpu.temperature)} color={hotness(gpu.temperature)} hint={gpu.note} />
        <Metric label="Power" value={gpu.power == null ? null : `${formatNumber(gpu.power, gpu.power % 1 === 0 ? 0 : 1)} W`} detail={gpu.powerLimit != null ? `limit ${formatNumber(gpu.powerLimit, 0)} W` : undefined} hint={gpu.note} />
        <Metric label={`${vramLabel} usage`} value={gpu.vramPercent == null ? null : `${formatNumber(gpu.vramPercent, 0)}%`} />
      </MetricGrid>

      <div className="space-y-2">
        <SubHeading>{vramLabel}</SubHeading>
        <Meter percent={gpu.vramPercent} hue="gpu" label={`${vramLabel} used`} />
        <MetricGrid>
          <Metric label="Used" value={memory(gpu.vramUsedBytes)} />
          <Metric label="Available" value={memory(gpu.vramFreeBytes)} />
          <Metric label="Total" value={memory(gpu.vramTotalBytes)} />
          {gpu.kind === 'Integrated' && <Metric label="Shared memory used" value={memory(gpu.sharedUsedBytes)} />}
        </MetricGrid>
      </div>
    </div>
  );
}

function GpuPanel({ gpus, available }: { gpus: GpuView[]; available: boolean | null }) {
  return (
    <Section title="GPU" icon={Gpu} hue="gpu" meta={gpus.length > 1 ? `${gpus.length} adapters` : gpus[0]?.name}>
      {gpus.length > 0 ? (
        <div className="space-y-5 divide-y divide-line [&>*:not(:first-child)]:pt-5">
          {gpus.map((gpu) => <GpuCard key={gpu.id} gpu={gpu} />)}
        </div>
      ) : (
        <p className="text-[13px] text-faint">{available === false ? 'No graphics adapter was reported by this system.' : 'Looking for graphics adapters…'}</p>
      )}
    </Section>
  );
}

export default memo(GpuPanel);
