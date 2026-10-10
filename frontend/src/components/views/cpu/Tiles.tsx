import { memo } from 'react';

import type { CpuDetail } from '../../../types/cpu';
import { StatTile, TileGrid } from '../../common/Primitives';
import { formatClock, num } from '../overlay/model';
import { cpuSourceLabel, describeCoreCounts, describeHybrid, formatWatts } from './model';

const DASH = '—';

/** The six numbers worth glancing at. A reading the machine did not give is a dash with the reason, never 0. */
function Tiles({ detail }: { detail: CpuDetail }) {
  const { live, power, topology } = detail;
  const clock = formatClock(live?.clockMhz ?? null);
  const [clockValue, clockUnit] = clock ? clock.split(' ') : [DASH, undefined];
  const limits = [power.limit1Watts, power.limit2Watts].filter(num);

  return (
    <TileGrid cols={3}>
      <StatTile label="Utilization" hue="cpu"
        value={num(live?.usagePercent) ? Math.round(live.usagePercent) : DASH} unit={num(live?.usagePercent) ? '%' : undefined}
        percentForColor={live?.usagePercent ?? undefined}
        detail={num(live?.busiestThreadPercent) ? `Busiest thread ${Math.round(live.busiestThreadPercent)}%` : 'Measuring…'} />
      <StatTile label="Temperature" hue="cpu"
        value={num(live?.temperatureC) ? Math.round(live.temperatureC) : DASH} unit={num(live?.temperatureC) ? '°C' : undefined}
        percentForColor={num(live?.temperatureC) ? live.temperatureC : undefined}
        detail={num(live?.temperatureC) ? (cpuSourceLabel(live?.temperatureSource ?? null) ?? 'System sensor') : (live?.temperatureNote ?? 'Not reported')} />
      <StatTile label="Clock speed" hue="cpu" value={clockValue} unit={clockUnit}
        detail={num(live?.highestClockMhz) ? `Fastest ${formatClock(live.highestClockMhz)} · slowest ${formatClock(live?.lowestClockMhz ?? null) ?? DASH}` : 'Average across threads'} />
      <StatTile label="Active threads" hue="cpu"
        value={num(live?.activeThreads) ? `${live.activeThreads} of ${detail.cores.length}` : DASH}
        detail="Threads at 10% load or more" />
      <StatTile label="Package power" hue="cpu"
        value={formatWatts(power.packageWatts)?.replace(' W', '') ?? DASH} unit={num(power.packageWatts) ? 'W' : undefined}
        detail={num(power.packageWatts) ? (limits.length ? `Limit ${limits.map((l) => formatWatts(l)).join(' / ')}` : 'Whole processor package') : (power.note ?? 'Not reported')} />
      <StatTile label="Cores · threads" hue="cpu"
        value={num(topology.physicalCores) ? `${topology.physicalCores} · ${topology.logicalProcessors ?? DASH}` : (describeCoreCounts(detail) ?? DASH)}
        detail={describeHybrid(detail) ?? (num(topology.packages) && topology.packages > 1 ? `${topology.packages} sockets` : 'Physical · logical')} />
    </TileGrid>
  );
}

export default memo(Tiles);
