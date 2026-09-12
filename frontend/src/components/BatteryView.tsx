import { useMetricHistory } from "../hooks/useMetricHistory";
import type { BatteryInfo } from "../types/system";
import MetricCard from "./common/MetricCard";


interface BatteryViewProps {
  battery: BatteryInfo;
}

// Simple label/value row for the detail card — mirrors the same visual
// language as MetricCard (muted label, text color for value) without
// needing a new shared component just for this one view.
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] py-2 last:border-b-0">
      <span className="text-[12px] text-[var(--text-muted)]">{label}</span>
      <span className="tabular text-[13px] text-[var(--text)]">{value}</span>
    </div>
  );
}

export default function BatteryView({ battery }: BatteryViewProps) {
  const batteryHistory = useMetricHistory(battery.capacityPercent ?? 0);

  if (!battery.available) {
    return (
      <div className="p-5">
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 text-[13px] text-[var(--text-muted)]">
          {battery.note ?? 'No battery detected on this system.'}
        </div>
      </div>
    );
  }

  const fmtMah = (v: number | null) => (v !== null ? `${v.toLocaleString()} mAh` : '—');
  const fmtPct = (v: number | null) => (v !== null ? `${v.toFixed(1)} %` : '—');

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap gap-3">
        <MetricCard
          label="Charge"
          value={battery.capacityPercent !== null ? battery.capacityPercent.toFixed(0) : '—'}
          unit="%"
          percentForColor={
            battery.capacityPercent !== null ? 100 - battery.capacityPercent : undefined
          }
          history={batteryHistory}
          detail={battery.status ?? 'Unknown'}
        />
        <MetricCard
          label="Health"
          value={battery.healthPercent !== null ? battery.healthPercent.toFixed(0) : '—'}
          unit="%"
          detail="Full-charge vs design capacity"
        />
        <MetricCard
          label="Power draw"
          value={battery.powerWatts !== null ? battery.powerWatts.toFixed(1) : '—'}
          unit="W"
          detail={
            battery.voltageNow !== null ? `${battery.voltageNow.toFixed(2)} V` : undefined
          }
        />
        <MetricCard
          label="Cycle count"
          value={battery.cycleCount !== null ? String(battery.cycleCount) : '—'}
          unit="cycles"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-2 text-[13px] font-medium text-[var(--text)]">Capacity</h3>
          <DetailRow label="Design capacity" value={fmtMah(battery.designCapacityMah)} />
          <DetailRow label="Full-charge capacity" value={fmtMah(battery.fullCapacityMah)} />
          <DetailRow label="Current charge" value={fmtMah(battery.nowCapacityMah)} />
          <DetailRow label="Health (full ÷ design)" value={fmtPct(battery.healthPercent)} />
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-2 text-[13px] font-medium text-[var(--text)]">Device</h3>
          <DetailRow label="Model" value={battery.model || '—'} />
          <DetailRow label="Manufacturer" value={battery.manufacturer || '—'} />
          <DetailRow label="Status" value={battery.status ?? '—'} />
          <DetailRow
            label="Voltage"
            value={battery.voltageNow !== null ? `${battery.voltageNow.toFixed(2)} V` : '—'}
          />
        </div>
      </div>

      {battery.cycleCountNote && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[12px] text-[var(--text-faint)]">
          * {battery.cycleCountNote}
        </div>
      )}
    </div>
  );
}