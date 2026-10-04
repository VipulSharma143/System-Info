import { memo } from 'react';
import { Cpu, Gauge } from 'lucide-react';
import type { BatteryInfo } from '../../../types/system';
import Panel from '../../common/Panel';
import { InfoRow, StatTile, TileGrid, Unavailable } from '../../common/Primitives';

/*
  Capacity fields are named *Mah for contract stability, but the unit differs by platform: mAh on
  Linux (sysfs charge_*), mWh on Windows (the battery class driver reports energy). The unit comes
  from the backend so Windows never shows "mAh" over mWh values.
*/
const capacity = (value: number | null, unit: string) => (value !== null ? `${value.toLocaleString()} ${unit}` : <Unavailable />);

/** The four headline health numbers. */
export const BatteryHealthTiles = memo(function BatteryHealthTiles({ battery }: { battery: BatteryInfo }) {
  const unit = battery.capacityUnit ?? 'mAh';
  const hasCapacity = battery.fullCapacityMah !== null && battery.designCapacityMah !== null;
  return (
    <TileGrid cols={4}>
      <StatTile
        hue="power"
        label="Health"
        value={battery.healthPercent !== null ? battery.healthPercent.toFixed(1) : 'Unavailable'}
        unit={battery.healthPercent !== null ? '%' : undefined}
        detail={battery.healthPercent !== null ? 'Full-charge ÷ design capacity' : 'Capacity data not reported'}
      />
      <StatTile
        hue="power"
        label="Cycle count"
        value={battery.cycleCount !== null ? String(battery.cycleCount) : 'Unavailable'}
        unit={battery.cycleCount !== null ? 'cycles' : undefined}
        detail={battery.cycleCount !== null ? undefined : (battery.cycleCountNote ?? 'Not reported by this battery driver')}
      />
      <StatTile
        hue="power"
        label="Capacity"
        value={hasCapacity ? `${battery.fullCapacityMah!.toLocaleString()} / ${battery.designCapacityMah!.toLocaleString()}` : 'Unavailable'}
        unit={hasCapacity ? unit : undefined}
        detail="Full-charge vs design"
      />
      <StatTile hue="power" label="Voltage" value={battery.voltageNow !== null ? battery.voltageNow.toFixed(2) : 'Unavailable'} unit={battery.voltageNow !== null ? 'V' : undefined} />
    </TileGrid>
  );
});

export const BatteryDetailPanels = memo(function BatteryDetailPanels({ battery }: { battery: BatteryInfo }) {
  const unit = battery.capacityUnit ?? 'mAh';
  return (
    <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-2">
      <Panel title="Capacity" icon={Gauge} hue="power">
        <InfoRow label="Design capacity" value={capacity(battery.designCapacityMah, unit)} />
        <InfoRow label="Full-charge capacity" value={capacity(battery.fullCapacityMah, unit)} />
        <InfoRow label="Current charge" value={capacity(battery.nowCapacityMah, unit)} />
        <InfoRow
          label="Health"
          value={battery.healthPercent !== null ? `${battery.healthPercent.toFixed(1)} %` : <Unavailable reason="Requires both design and full-charge capacity" />}
        />
      </Panel>

      <Panel title="Device" icon={Cpu} hue="power">
        <InfoRow label="Status" value={battery.status ?? <Unavailable />} />
        <InfoRow label="Cycle count" value={battery.cycleCount !== null ? String(battery.cycleCount) : <Unavailable reason={battery.cycleCountNote} />} />
        <InfoRow label="Voltage" value={battery.voltageNow !== null ? `${battery.voltageNow.toFixed(2)} V` : <Unavailable />} />
        <InfoRow label="Power draw" value={battery.powerWatts !== null ? `${battery.powerWatts.toFixed(1)} W` : <Unavailable />} />
        <InfoRow label="Model" value={battery.model || <Unavailable />} />
        <InfoRow label="Manufacturer" value={battery.manufacturer || <Unavailable />} />
      </Panel>
    </div>
  );
});
