import { memo } from 'react';
import { HardDrive } from 'lucide-react';
import type { DiskInfo } from '../../../types/system';
import { formatGB } from '../../../lib/format';
import Panel from '../../common/Panel';
import { EmptyState } from '../../common/States';
import UsageBar from '../../common/UsageBar';

function StoragePanel({ disks }: { disks: DiskInfo[] }) {
  return (
    <Panel title="Storage" icon={HardDrive} hue="disk" meta={`${disks.length} drive${disks.length === 1 ? '' : 's'}`}>
      {disks.length === 0 ? (
        <EmptyState icon={HardDrive} hue="disk" title="No drives reported" />
      ) : (
        <ul className="space-y-3.5">
          {disks.slice(0, 4).map((d) => (
            <li key={d.name}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[13px] font-medium text-ink">
                  {d.name}
                  {d.volumeLabel && <span className="ml-2 text-[12px] font-normal text-faint">{d.volumeLabel}</span>}
                </span>
                <span className="num shrink-0 text-[12px] text-muted">{formatGB(d.freeGB)} free of {formatGB(d.totalGB)}</span>
              </div>
              <UsageBar percent={d.usedPercent} compact hue="disk" />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default memo(StoragePanel);
