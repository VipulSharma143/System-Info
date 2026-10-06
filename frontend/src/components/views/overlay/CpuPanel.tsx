import { memo } from 'react';
import { Cpu } from 'lucide-react';

import { useMetricHistory } from '../../../hooks/useMetricHistory';
import { formatNumber } from '../../../lib/format';
import { usageColor } from '../../../lib/hues';
import type { CpuDetail, SystemIdentification } from '../../../types/system';

import Panel from '../../common/Panel';
import Sparkline from '../../common/Sparkline';
import UsageBar from '../../common/UsageBar';
import { InfoRow } from '../../common/Primitives';
import { NotReported, val } from '../ram/cells';

import CoreGrid from './CoreGrid';

const mhz = (n: number) => `${formatNumber(n, 0)} MHz`;

function CpuPanel({ cpu, info }: { cpu: CpuDetail | null; info: SystemIdentification | null }) {
  const usage = cpu?.totalUsagePercent ?? undefined;
  const usageHistory = useMetricHistory(usage);
  const temperatureHistory = useMetricHistory(cpu?.packageTemperatureC ?? undefined);
  const load = cpu?.loadAverage;

  return (
    <Panel title={info?.cpuModel ?? 'Processor'} icon={Cpu} hue="cpu">
      <div className="space-y-4">
        <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[12px] text-muted">Total usage</div>
            {usage === undefined ? <NotReported hint={cpu ? 'Measuring…' : undefined} /> : <UsageBar percent={usage} hue="cpu" />}
          </div>
          <Sparkline points={usageHistory} color={usageColor(usage, 'cpu')} height={64} />
        </div>

        {temperatureHistory.length > 1 && (
          <div>
            <div className="mb-1 text-[12px] text-muted">Temperature, last minute</div>
            <Sparkline points={temperatureHistory} color="var(--hue-cpu)" max="auto" height={48} />
          </div>
        )}

        {cpu && cpu.cores.length > 0 && <CoreGrid cores={cpu.cores} />}

        <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
          <div>
            <InfoRow label="Cores / threads" value={info ? `${info.physicalCores ?? '—'} / ${info.logicalProcessors}` : <NotReported />} />
            <InfoRow label="Average clock" value={val(cpu?.averageClockMhz, mhz)} />
            <InfoRow label="Highest core clock" value={val(cpu?.highestClockMhz, mhz)} />
            <InfoRow label="Base clock" value={val(cpu?.baseClockMhz, mhz)} />
            <InfoRow label="Maximum clock" value={val(cpu?.maxClockMhz, mhz)} />
          </div>
          <div>
            <InfoRow label="Package temperature" value={val(cpu?.packageTemperatureC, (n) => `${formatNumber(n, 0)} °C`)} hint={cpu?.temperatureSource ?? undefined} />
            <InfoRow label="Package power" value={val(cpu?.powerWatts, (n) => `${formatNumber(n, 1)} W`)} />
            <InfoRow label="Load average" value={load ? load.map((n) => formatNumber(n, 2)).join(' · ') : <NotReported />} hint={load ? '1 · 5 · 15 min' : undefined} />
          </div>
        </div>

        {cpu?.note && <p className="text-[12px] text-faint">{cpu.note}</p>}
      </div>
    </Panel>
  );
}

export default memo(CpuPanel);
