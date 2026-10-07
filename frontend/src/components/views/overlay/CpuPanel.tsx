import { memo } from 'react';
import { Cpu } from 'lucide-react';

import { formatNumber } from '../../../lib/format';
import type { CpuDetail } from '../../../types/system';

import { Badge } from '../../common/Primitives';

import CoreGrid from './CoreGrid';
import { hotness, topologyLabel, type CpuView } from './model';
import { Meter, Metric, MetricGrid, Section, SubHeading } from './parts';

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

function CpuTopology({ view }: { view: CpuView }) {
  return (
    <MetricGrid>
      <Metric label="Physical cores" value={view.physical} />
      <Metric label="Logical processors" value={view.logical} />
      <Metric label="Active processors" value={view.active} detail={view.active == null ? undefined : `of ${view.measured} measured · above 10%`} />
      {view.hybrid ? (
        <>
          <Metric label="P-cores" value={view.performanceCores} detail={view.performanceThreads != null ? `${view.performanceThreads} threads` : undefined} />
          <Metric label="E-cores" value={view.efficiencyCores} detail={view.efficiencyThreads != null ? `${view.efficiencyThreads} threads` : undefined} />
        </>
      ) : (
        <Metric label="Core types" value="Uniform" detail="No P/E split reported" />
      )}
    </MetricGrid>
  );
}

interface CpuPanelProps {
  cpu: CpuDetail | null;
  view: CpuView;
  model: string | null;
  architecture: string | null;
}

function CpuPanel({ cpu, view, model, architecture }: CpuPanelProps) {
  const status = STATUS[view.status];
  return (
    <Section title="CPU" icon={Cpu} hue="cpu" meta={topologyLabel(view)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{model ?? 'Processor'}</div>
          <div className="text-[11px] text-faint">{architecture ?? 'Architecture not reported'}</div>
        </div>
        <div className="flex items-center gap-2">
          {view.load && <Badge tone={view.load === 'Saturated' ? 'critical' : view.load === 'Heavy' ? 'warn' : 'muted'}>{view.load} load</Badge>}
          <Badge tone={status.tone}>{status.text}</Badge>
        </div>
      </div>

      <Meter percent={view.usage} hue="cpu" label="CPU utilization" />
      <CpuSummary view={view} />

      <div className="space-y-2"><SubHeading>Topology</SubHeading><CpuTopology view={view} /></div>

      {cpu && cpu.cores.length > 0 && (
        <div className="space-y-2"><SubHeading>Per-processor utilization</SubHeading><CoreGrid cores={cpu.cores} /></div>
      )}

      {view.systemTemperature != null && (
        <p className="text-[12px] text-faint">
          System thermal zone {formatNumber(view.systemTemperature, 0)} °C — a firmware sensor, not the CPU.
        </p>
      )}
      {view.packageTemperature == null && cpu?.note && <p className="text-[12px] text-faint">{cpu.note}</p>}
    </Section>
  );
}

export default memo(CpuPanel);
