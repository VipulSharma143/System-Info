import { memo } from 'react';
import { Cpu } from 'lucide-react';

import { formatNumber } from '../../../lib/format';
import type { CpuDetail } from '../../../types/system';

import { Badge } from '../../common/Primitives';

import CoreGrid from './CoreGrid';
import { hotness, type CpuView } from './model';
import { Metric, MetricGrid, Section, SubHeading } from './parts';

const degrees = (n: number | null) => (n == null ? null : `${formatNumber(n, 0)} °C`);

const STATUS = {
  live: { tone: 'ok', text: 'Live' },
  measuring: { tone: 'info', text: 'Measuring…' },
  unavailable: { tone: 'muted', text: 'Unavailable' },
} as const;

function CpuSummary({ view }: { view: CpuView }) {
  return (
    <MetricGrid>
      <Metric label="Utilization" value={view.usage == null ? null : `${formatNumber(view.usage, 0)}%`} detail={view.load ?? undefined} />
      <Metric label="Package temperature" value={degrees(view.packageTemperature)} color={hotness(view.packageTemperature)} />
      <Metric label="Hottest core" value={degrees(view.hottestCore)} color={hotness(view.hottestCore)} />
      <Metric label="Package power" value={view.power == null ? null : `${formatNumber(view.power, 1)} W`} />
    </MetricGrid>
  );
}

function CpuActivity({ view }: { view: CpuView }) {
  return (
    <MetricGrid>
      <Metric label="Active processors" value={view.active} detail={view.active == null ? undefined : `of ${view.measured} · above 10% busy`} />
      {view.hybrid && <Metric label="Busy P-core threads" value={view.performanceActive} detail={view.performanceThreads != null ? `of ${view.performanceThreads}` : undefined} />}
      {view.hybrid && <Metric label="Busy E-core threads" value={view.efficiencyActive} detail={view.efficiencyThreads != null ? `of ${view.efficiencyThreads}` : undefined} />}
    </MetricGrid>
  );
}

interface CpuPanelProps {
  cpu: CpuDetail | null;
  view: CpuView;
}

function CpuPanel({ cpu, view }: CpuPanelProps) {
  const status = STATUS[view.status];
  return (
    <Section title="CPU activity" icon={Cpu} hue="cpu" meta={view.usage == null ? undefined : `${formatNumber(view.usage, 0)}%`}>
      <div className="flex items-center justify-end gap-2">
        {view.load && <Badge tone={view.load === 'Saturated' ? 'critical' : view.load === 'Heavy' ? 'warn' : 'muted'}>{view.load} load</Badge>}
        <Badge tone={status.tone}>{status.text}</Badge>
      </div>
      <CpuSummary view={view} />
      <CpuActivity view={view} />
      {cpu && cpu.cores.length > 0 && (
        <div className="space-y-2"><SubHeading>Per-processor utilization</SubHeading><CoreGrid cores={cpu.cores} /></div>
      )}
      {view.systemTemperature != null && (
        <p className="text-[12px] text-faint">System thermal zone {formatNumber(view.systemTemperature, 0)} °C — a firmware sensor, not the CPU.</p>
      )}
      {view.packageTemperature == null && cpu?.note && <p className="text-[12px] text-faint">{cpu.note}</p>}
    </Section>
  );
}

export default memo(CpuPanel);
