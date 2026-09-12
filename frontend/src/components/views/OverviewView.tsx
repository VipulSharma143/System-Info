import type { SystemSnapshot } from '../../types/system';
import { useMetricHistory } from '../../hooks/useMetricHistory';
import MetricCard from '../common/MetricCard';
import DiskTable from '../DiskTable';
import NetworkTable from '../NetworkTable';
import ProcessTable from '../ProcessTable';

interface OverviewViewProps {
data: SystemSnapshot;
}

export default function OverviewView({ data }: OverviewViewProps) {
const cpuHistory = useMetricHistory(data.cpu.usedPercent);
const ramHistory = useMetricHistory(data.ram.usedPercent);
// Hook always runs (rules of hooks) — falls back to 0 when no battery is
// present so the call stays unconditional, but that history is only ever
// handed to MetricCard when battery.available is true, so a 0 never
// silently renders as if it were a real reading.
const batteryHistory = useMetricHistory(data.battery.capacityPercent ?? 0);

const totalRx = data.network.reduce((sum, n) => sum + n.rxKBps, 0);
const totalTx = data.network.reduce((sum, n) => sum + n.txKBps, 0);

const battery = data.battery;
const batteryDetail = battery.available
? `${battery.status ?? 'Unknown'}${
battery.powerWatts !== null ? ` · ${battery.powerWatts.toFixed(1)} W` : ''
      }`
: battery.note ?? 'No battery detected';

const healthDetail = battery.available
? `${battery.cycleCount ?? '—'} cycles${battery.cycleCountNote ? ' *' : ''}`
: undefined;

return (
<div className="space-y-4 p-5">
<div className="flex flex-wrap gap-3">
<MetricCard
label="CPU"
value={data.cpu.usedPercent.toFixed(1)}
unit="%"
percentForColor={data.cpu.usedPercent}
history={cpuHistory}
/>
<MetricCard
label="Memory"
value={data.ram.usedPercent.toFixed(1)}
unit="%"
percentForColor={data.ram.usedPercent}
history={ramHistory}
detail={`${data.ram.usedMB.toLocaleString()} / ${data.ram.totalMB.toLocaleString()} MB`}
/>
<MetricCard
label="Memory free"
value={data.ram.availableMB.toLocaleString()}
unit="MB"
/>
<MetricCard
label="Network"
value={totalRx.toFixed(0)}
unit="KB/s down"
detail={`${totalTx.toFixed(0)} KB/s up`}
/>
<MetricCard label="Processes" value={String(data.processes.length)} unit="running" />
{battery.available && (
<MetricCard
label="Battery"
value={battery.capacityPercent !== null ? battery.capacityPercent.toFixed(0) : '—'}
unit="%"
// Inverted: low charge should read as "critical" the same way high
// CPU/RAM usage does, so severity() gets fed the inverse value
// rather than needing a separate high-is-bad/low-is-bad branch.
percentForColor={
battery.capacityPercent !== null ? 100 - battery.capacityPercent : undefined
              }
history={batteryHistory}
detail={batteryDetail}
/>
        )}
{battery.available && (
<MetricCard
label="Battery health"
value={
battery.healthPercent !== null ? battery.healthPercent.toFixed(0) : '—'
              }
unit="%"
detail={healthDetail}
/>
        )}
{!battery.available && (
<MetricCard label="Battery" value="—" detail={batteryDetail} />
        )}
</div>

<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
<DiskTable disks={data.disks} />
<NetworkTable network={data.network} />
</div>

<ProcessTable processes={data.processes} limit={8} showSearch={false} />
</div>
  );
}