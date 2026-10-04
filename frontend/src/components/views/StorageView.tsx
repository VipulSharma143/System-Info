import { memo, useMemo } from 'react';
import { HardDrive } from 'lucide-react';
import type { DiskInfo } from '../../types/system';
import { formatGB } from '../../lib/format';
import { EmptyState } from '../common/States';
import Panel from '../common/Panel';
import { StatTile, TileGrid, ViewContainer } from '../common/Primitives';
import DriveCard from './storage/DriveCard';
import DriveTable from './storage/DriveTable';

// Up to this many drives each gets a card; beyond it the table keeps the page compact.
const TABLE_THRESHOLD = 4;

function StorageView({ disks }: { disks: DiskInfo[] }) {
  const totals = useMemo(() => {
    const total = disks.reduce((s, d) => s + d.totalGB, 0);
    const used = disks.reduce((s, d) => s + d.usedGB, 0);
    const free = disks.reduce((s, d) => s + d.freeGB, 0);
    const fullest = disks.length ? disks.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a)) : null;
    return { total, used, free, fullest, percent: total > 0 ? (used / total) * 100 : 0 };
  }, [disks]);

  if (disks.length === 0) {
    return (
      <ViewContainer>
        <Panel>
          <EmptyState icon={HardDrive} hue="disk" title="No drives reported" description="The operating system did not list any mounted drives. This page updates on its own if one appears." />
        </Panel>
      </ViewContainer>
    );
  }

  const { fullest } = totals;
  return (
    <ViewContainer>
      <TileGrid cols={4}>
        <StatTile hue="disk" label="Total capacity" value={formatGB(totals.total)} detail={`${disks.length} drive${disks.length === 1 ? '' : 's'}`} />
        <StatTile hue="disk" label="Used" value={formatGB(totals.used)} detail={`${totals.percent.toFixed(1)}% of total`} percentForColor={totals.percent} />
        <StatTile hue="disk" label="Free" value={formatGB(totals.free)} />
        <StatTile hue="disk" label="Fullest drive" value={fullest!.usedPercent.toFixed(0)} unit="%" detail={fullest!.name} percentForColor={fullest!.usedPercent} />
      </TileGrid>

      {disks.length <= TABLE_THRESHOLD ? (
        <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
          {disks.map((d) => (
            <DriveCard key={d.name} disk={d} />
          ))}
        </div>
      ) : (
        <DriveTable disks={disks} />
      )}
    </ViewContainer>
  );
}

export default memo(StorageView);
