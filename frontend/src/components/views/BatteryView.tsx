import { useMetricHistory } from '../../hooks/useMetricHistory';
import type { BatteryInfo } from '../../types/system';
import Panel from '../common/Panel';
import Sparkline from '../common/Sparkline';
import UsageBar from '../common/UsageBar';
import { Badge, InfoRow, StatTile, TileGrid, ViewContainer } from '../common/Primitives';

interface BatteryViewProps {
  battery: BatteryInfo;
}

/*
  The battery page has to look intentional in three quite different states:

    1. Full data          — capacities, cycle count, voltage, health
    2. Partial data       — Windows drivers often withhold cycle count
    3. No battery at all  — desktops

  The backend never fabricates a missing reading (no 0-cycle lies), so the
  UI's job is to render "we don't know" compactly and honestly, rather than
  filling the screen with disabled cards.
*/

// The one place "unavailable" is rendered, so it reads identically
// everywhere. Shows the driver's explanation as a tooltip when there is one.
function NotReported({ reason }: { reason?: string | null }) {
  return (
    <span className="text-[13px] text-[var(--text-faint)]" title={reason ?? undefined}>
      Unavailable
    </span>
  );
}

function statusTone(battery: BatteryInfo): 'ok' | 'warn' | 'critical' | 'info' | 'muted' {
  if (!battery.available) return 'muted';
  if (battery.status === 'Charging') return 'ok';
  if (battery.status === 'Fully Charged') return 'ok';
  if (battery.capacityPercent !== null && battery.capacityPercent <= 15) return 'critical';
  if (battery.capacityPercent !== null && battery.capacityPercent <= 30) return 'warn';
  return 'info';
}

export default function BatteryView({ battery }: BatteryViewProps) {
  // Hook must run unconditionally (rules of hooks). The 0 fallback never
  // reaches the screen — it's only ever read when available is true.
  const chargeHistory = useMetricHistory(battery.capacityPercent ?? 0);

  if (!battery.available) {
    return (
      <ViewContainer>
        <Panel title="Battery">
          <div className="py-6 text-center">
            <p className="text-[15px] text-[var(--text)]">No battery detected</p>
            <p className="mx-auto mt-1.5 max-w-md text-[13px] text-[var(--text-faint)]">
              {battery.note ??
                'This device does not expose a battery to the operating system.'}
            </p>
          </div>
        </Panel>
      </ViewContainer>
    );
  }

  // Capacity fields are named *Mah for contract stability, but the actual
  // unit differs by platform: mAh on Linux (sysfs charge_*), mWh on Windows
  // (the battery class driver reports energy). Label from the backend
  // rather than assuming, so Windows never shows "mAh" over mWh values.
  const unit = battery.capacityUnit ?? 'mAh';
  const fmtCapacity = (v: number | null) =>
    v !== null ? `${v.toLocaleString()} ${unit}` : null;

  const tone = statusTone(battery);

  return (
    <ViewContainer>
      {/* Hero: charge and state, the two things read at a glance */}
      <Panel
        title="Battery"
        action={<Badge tone={tone}>{battery.status ?? 'Unknown'}</Badge>}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="tabular text-[38px] font-medium leading-none text-[var(--text)]">
                {battery.capacityPercent !== null ? battery.capacityPercent.toFixed(0) : '—'}
              </span>
              <span className="text-[16px] text-[var(--text-muted)]">%</span>
            </div>
            <div className="mt-1.5 text-[13px] text-[var(--text-muted)]">
              {battery.status ?? 'Unknown'}
              {battery.powerWatts !== null && (
                <span className="text-[var(--text-faint)]">
                  {' · '}
                  {battery.powerWatts.toFixed(1)} W
                </span>
              )}
            </div>
          </div>

          <div className="min-w-[200px] flex-1">
            {chargeHistory.length > 1 ? (
              <Sparkline points={chargeHistory} color="var(--accent)" height={48} />
            ) : (
              <div className="h-12" />
            )}
            <div className="mt-1 text-right text-[11px] text-[var(--text-faint)]">
              charge, last ~80 seconds
            </div>
          </div>
        </div>

        {battery.capacityPercent !== null && (
          <div className="mt-3">
            <UsageBar percent={battery.capacityPercent} lowIsBad />
          </div>
        )}
      </Panel>

      {/* Level 2: the four headline health numbers */}
      <TileGrid cols={4}>
        <StatTile
          label="Health"
          value={
            battery.healthPercent !== null ? battery.healthPercent.toFixed(1) : 'Unavailable'
          }
          unit={battery.healthPercent !== null ? '%' : undefined}
          detail={
            battery.healthPercent !== null
              ? 'Full-charge ÷ design capacity'
              : 'Capacity data not reported'
          }
        />
        <StatTile
          label="Cycle count"
          value={battery.cycleCount !== null ? String(battery.cycleCount) : 'Unavailable'}
          unit={battery.cycleCount !== null ? 'cycles' : undefined}
          detail={
            battery.cycleCount !== null
              ? undefined
              : (battery.cycleCountNote ?? 'Not reported by this battery driver')
          }
        />
        <StatTile
          label="Capacity"
          value={
            battery.fullCapacityMah !== null && battery.designCapacityMah !== null
              ? `${battery.fullCapacityMah.toLocaleString()} / ${battery.designCapacityMah.toLocaleString()}`
              : 'Unavailable'
          }
          unit={
            battery.fullCapacityMah !== null && battery.designCapacityMah !== null
              ? unit
              : undefined
          }
          detail="Full-charge vs design"
        />
        <StatTile
          label="Voltage"
          value={battery.voltageNow !== null ? battery.voltageNow.toFixed(2) : 'Unavailable'}
          unit={battery.voltageNow !== null ? 'V' : undefined}
        />
      </TileGrid>

      {/* Level 3: full detail, two compact columns */}
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2">
        <Panel title="Capacity detail">
          <InfoRow
            label="Design capacity"
            value={fmtCapacity(battery.designCapacityMah) ?? <NotReported />}
          />
          <InfoRow
            label="Full-charge capacity"
            value={fmtCapacity(battery.fullCapacityMah) ?? <NotReported />}
          />
          <InfoRow
            label="Current charge"
            value={fmtCapacity(battery.nowCapacityMah) ?? <NotReported />}
          />
          <InfoRow
            label="Health"
            value={
              battery.healthPercent !== null ? (
                `${battery.healthPercent.toFixed(1)} %`
              ) : (
                <NotReported reason="Requires both design and full-charge capacity" />
              )
            }
          />
        </Panel>

        <Panel title="Device">
          <InfoRow label="Status" value={battery.status ?? <NotReported />} />
          <InfoRow
            label="Cycle count"
            value={
              battery.cycleCount !== null ? (
                String(battery.cycleCount)
              ) : (
                <NotReported reason={battery.cycleCountNote} />
              )
            }
          />
          <InfoRow
            label="Voltage"
            value={
              battery.voltageNow !== null ? `${battery.voltageNow.toFixed(2)} V` : <NotReported />
            }
          />
          <InfoRow
            label="Power draw"
            value={
              battery.powerWatts !== null ? `${battery.powerWatts.toFixed(1)} W` : <NotReported />
            }
          />
          <InfoRow label="Model" value={battery.model || <NotReported />} />
          <InfoRow label="Manufacturer" value={battery.manufacturer || <NotReported />} />
        </Panel>
      </div>

      {(battery.cycleCountNote || battery.note) && (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[12px] text-[var(--text-faint)]">
          {battery.cycleCountNote && <div>{battery.cycleCountNote}</div>}
          {battery.note && <div className={battery.cycleCountNote ? 'mt-1' : ''}>{battery.note}</div>}
        </div>
      )}
    </ViewContainer>
  );
}
