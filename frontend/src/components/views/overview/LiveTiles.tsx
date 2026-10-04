import { memo } from 'react';
import type { SystemSnapshot } from '../../../types/system';
import type { DashboardHistory } from '../../../hooks/useDashboardHistory';
import { severity, severityWord, formatGB } from '../../../lib/format';
import type { BadgeTone } from '../../common/Primitives';
import UsageBar from '../../common/UsageBar';
import LiveTile from './LiveTile';

const usageTone = (percent: number): BadgeTone => ({ ok: 'ok', warn: 'warn', critical: 'critical' } as const)[severity(percent)];

function batteryTone(b: SystemSnapshot['battery']): BadgeTone {
  if (!b.available) return 'muted';
  if (b.status === 'Charging') return 'ok';
  return b.capacityPercent !== null && b.capacityPercent <= 20 ? 'critical' : 'info';
}

interface Props {
  cpu: SystemSnapshot['cpu'];
  ram: SystemSnapshot['ram'];
  disks: SystemSnapshot['disks'];
  network: SystemSnapshot['network'];
  battery: SystemSnapshot['battery'];
  history: DashboardHistory;
}

/*
  The five headline metrics, answered at a glance: CPU and memory are wide tiles (they have the
  most to say), disk / network / battery are compact. Only the props each tile reads are passed,
  so a poll that changes just the network does not re-render the others.
*/
function LiveTiles({ cpu, ram, disks, network, battery, history }: Props) {
  const rx = network.reduce((sum, n) => sum + n.rxKBps, 0);
  const tx = network.reduce((sum, n) => sum + n.txKBps, 0);
  const busiest = disks.length > 0 ? disks.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a)) : null;
  const hasCharge = battery.available && battery.capacityPercent !== null;

  return (
    <div className="bento">
      <LiveTile
        className="col-span-12 md:col-span-6 xl:col-span-4"
        label="Processor"
        hue="cpu"
        value={cpu.usedPercent.toFixed(1)}
        unit="%"
        status={severityWord(cpu.usedPercent)}
        tone={usageTone(cpu.usedPercent)}
        history={history.cpu}
        percentForColor={cpu.usedPercent}
      />
      <LiveTile
        className="col-span-12 md:col-span-6 xl:col-span-4"
        label="Memory"
        hue="ram"
        value={ram.usedPercent.toFixed(1)}
        unit="%"
        status={`${(ram.usedMB / 1024).toFixed(1)} of ${(ram.totalMB / 1024).toFixed(1)} GB`}
        tone={usageTone(ram.usedPercent)}
        history={history.ram}
        percentForColor={ram.usedPercent}
      />
      <LiveTile
        className="col-span-12 md:col-span-6 xl:col-span-4"
        label="Network"
        hue="net"
        value={rx.toFixed(0)}
        unit="KB/s down"
        status={`${tx.toFixed(0)} KB/s up`}
        tone="info"
        history={history.rx}
        historyMax="auto"
      />
      <LiveTile
        className="col-span-12 md:col-span-6 xl:col-span-6"
        label="Fullest drive"
        hue="disk"
        value={busiest ? busiest.usedPercent.toFixed(0) : '—'}
        unit={busiest ? '%' : undefined}
        status={busiest ? `${busiest.name} · ${formatGB(busiest.freeGB)} free` : 'No drives'}
        tone={busiest ? usageTone(busiest.usedPercent) : 'muted'}
        percentForColor={busiest?.usedPercent}
        footer={busiest ? <UsageBar percent={busiest.usedPercent} hue="disk" hideValue /> : undefined}
      />
      <LiveTile
        className="col-span-12 md:col-span-12 xl:col-span-6"
        label="Battery"
        hue="power"
        value={hasCharge ? battery.capacityPercent!.toFixed(0) : '—'}
        unit={hasCharge ? '%' : undefined}
        status={battery.available ? (battery.status ?? 'Unknown') : 'No battery'}
        tone={batteryTone(battery)}
        history={history.charge}
        percentForColor={hasCharge ? 100 - battery.capacityPercent! : undefined}
      />
    </div>
  );
}

export default memo(LiveTiles);
