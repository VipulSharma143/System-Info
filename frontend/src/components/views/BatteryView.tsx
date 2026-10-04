import { memo } from 'react';
import { BatteryWarning } from 'lucide-react';
import type { BatteryInfo } from '../../types/system';
import Panel from '../common/Panel';
import { EmptyState } from '../common/States';
import { ViewContainer } from '../common/Primitives';
import BatteryHero from './battery/BatteryHero';
import { BatteryDetailPanels, BatteryHealthTiles } from './battery/BatteryDetails';

/*
  Three states have to look intentional: full data, partial data (Windows drivers often withhold
  cycle count) and no battery at all (desktops). The backend never fabricates a missing reading,
  so the UI renders "we don't know" compactly and honestly instead of filling the page with
  disabled cards.
*/
function BatteryView({ battery, chargeHistory }: { battery: BatteryInfo; chargeHistory: number[] }) {
  if (!battery.available) {
    return (
      <ViewContainer>
        <Panel>
          <EmptyState
            icon={BatteryWarning}
            hue="power"
            title="No battery detected"
            description={battery.note ?? 'This device does not expose a battery to the operating system, so there is nothing to show here.'}
          />
        </Panel>
      </ViewContainer>
    );
  }

  return (
    <ViewContainer>
      <BatteryHero battery={battery} chargeHistory={chargeHistory} />
      <BatteryHealthTiles battery={battery} />
      <BatteryDetailPanels battery={battery} />
      {(battery.cycleCountNote || battery.note) && (
        <div className="rounded-[var(--r-md)] bg-surface-2 px-4 py-3 text-[12px] leading-relaxed text-muted">
          {battery.cycleCountNote && <div>{battery.cycleCountNote}</div>}
          {battery.note && <div className={battery.cycleCountNote ? 'mt-1' : ''}>{battery.note}</div>}
        </div>
      )}
    </ViewContainer>
  );
}

export default memo(BatteryView);
