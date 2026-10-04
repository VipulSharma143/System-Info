import { memo } from 'react';
import { BatteryCharging, BatteryMedium } from 'lucide-react';
import type { BatteryInfo } from '../../../types/system';
import Figure from '../../common/Figure';
import Panel from '../../common/Panel';
import { Badge, type BadgeTone } from '../../common/Primitives';
import Sparkline from '../../common/Sparkline';
import UsageBar from '../../common/UsageBar';

export function batteryTone(battery: BatteryInfo): BadgeTone {
  if (!battery.available) return 'muted';
  if (battery.status === 'Charging' || battery.status === 'Fully Charged') return 'ok';
  const pct = battery.capacityPercent;
  if (pct !== null && pct <= 15) return 'critical';
  if (pct !== null && pct <= 30) return 'warn';
  return 'info';
}

/** Charge and state — the two things read at a glance — with the recent charge curve beside them. */
function BatteryHero({ battery, chargeHistory }: { battery: BatteryInfo; chargeHistory: number[] }) {
  const charging = battery.status === 'Charging';
  const Icon = charging ? BatteryCharging : BatteryMedium;

  return (
    <Panel variant="hero" title="Charge" icon={Icon} hue="power" action={<Badge tone={batteryTone(battery)}>{battery.status ?? 'Unknown'}</Badge>}>
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
        <div>
          <Figure size="xl" value={battery.capacityPercent !== null ? battery.capacityPercent.toFixed(0) : '—'} unit="%" />
          {battery.powerWatts !== null && (
            <p className="mt-2 text-[13px] text-muted">{charging ? 'Charging at' : 'Drawing'} <span className="num font-medium text-ink">{battery.powerWatts.toFixed(1)} W</span></p>
          )}
        </div>
        <div className="min-w-[220px] flex-1">
          {chargeHistory.length > 1 ? <Sparkline points={chargeHistory} color="var(--hue-power)" height={56} dot /> : <div className="h-14" />}
          <div className="mt-1 text-right text-[12px] text-faint">charge, last ~80 seconds</div>
        </div>
      </div>
      {battery.capacityPercent !== null && (
        <div className="mt-5">
          <UsageBar percent={battery.capacityPercent} lowIsBad hue="power" hideValue />
        </div>
      )}
    </Panel>
  );
}

export default memo(BatteryHero);
