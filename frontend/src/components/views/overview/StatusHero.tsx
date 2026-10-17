import { memo } from 'react';
import { ArrowDown, ArrowUp, BatteryMedium, ListTree } from 'lucide-react';
import type { SystemSnapshot } from '../../../types/system';
import { formatRate } from '../../../lib/format';
import Panel from '../../common/Panel';
import { Badge } from '../../common/Primitives';
import { fullestDrive, overallState } from './model';

const WORD = { ok: 'Normal', warn: 'Elevated', critical: 'Critical' } as const;

function Fact({ icon: Icon, label, value }: { icon: typeof ListTree; label: string; value: string }) {
  return (
    <div className="min-w-[7.5rem]">
      <div className="flex items-center gap-1.5 text-[12px] text-muted"><Icon className="h-3.5 w-3.5 text-faint" />{label}</div>
      <div className="num mt-1 text-[17px] font-semibold text-ink">{value}</div>
    </div>
  );
}

interface Props {
  cpu: SystemSnapshot['cpu'];
  ram: SystemSnapshot['ram'];
  disks: SystemSnapshot['disks'];
  network: SystemSnapshot['network'];
  battery: SystemSnapshot['battery'];
  processCount: number;
}

/** The first thing on the page: one sentence about the whole machine, then the four numbers people check next. */
function StatusHero({ cpu, ram, disks, network, battery, processCount }: Props) {
  const fullest = fullestDrive(disks);
  const state = overallState(cpu.usedPercent, ram.usedPercent, fullest && { name: fullest.name, percent: fullest.percent });
  const rx = network.reduce((s, n) => s + n.rxKBps, 0);
  const tx = network.reduce((s, n) => s + n.txKBps, 0);
  const charge = battery.available && battery.capacityPercent !== null ? `${battery.capacityPercent.toFixed(0)}%` : battery.available ? 'Unknown' : 'No battery';

  return (
    <Panel variant="hero" hue="overview">
      <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-5">
        <div className="min-w-0 max-w-xl">
          <Badge tone={state.tone}>{WORD[state.tone]}</Badge>
          <h2 className="num mt-3 text-[28px] font-semibold leading-tight text-ink">{state.headline}</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{state.detail}</p>
        </div>
        <div className="flex flex-wrap gap-x-9 gap-y-4">
          <Fact icon={ListTree} label="Processes" value={String(processCount)} />
          <Fact icon={ArrowDown} label="Download" value={formatRate(rx)} />
          <Fact icon={ArrowUp} label="Upload" value={formatRate(tx)} />
          <Fact icon={BatteryMedium} label={battery.available ? (battery.status ?? 'Battery') : 'Battery'} value={charge} />
        </div>
      </div>
    </Panel>
  );
}

export default memo(StatusHero);
