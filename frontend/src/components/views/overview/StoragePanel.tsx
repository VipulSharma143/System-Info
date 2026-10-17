import { memo } from 'react';
import { HardDrive } from 'lucide-react';
import type { DiskInfo } from '../../../types/system';
import { formatGB, severity } from '../../../lib/format';
import Panel from '../../common/Panel';
import { Badge } from '../../common/Primitives';
import { EmptyState } from '../../common/States';
import UsageBar from '../../common/UsageBar';

const TONE = { ok: 'ok', warn: 'warn', critical: 'critical' } as const;
const MAX_SHOWN = 4;

/** Each drive: name, free space, a usage bar, and a plain-word status when it is getting full. */
function StoragePanel({ disks }: { disks: DiskInfo[] }) {
  const shown = [...disks].sort((a, b) => b.usedPercent - a.usedPercent).slice(0, MAX_SHOWN);
  const hidden = disks.length - shown.length;
  return (
    <Panel title="Storage" icon={HardDrive} hue="disk" meta={`${disks.length} drive${disks.length === 1 ? '' : 's'}`}>
      {disks.length === 0 ? (
        <EmptyState icon={HardDrive} hue="disk" title="No drives reported" />
      ) : (
        <ul className="space-y-4">
          {shown.map((d) => {
            const level = severity(d.usedPercent);
            return (
              <li key={d.name}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[13px] font-medium text-ink">
                    {d.name}
                    {d.volumeLabel && <span className="ml-2 text-[12px] font-normal text-faint">{d.volumeLabel}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {level !== 'ok' && <Badge tone={TONE[level]} dot={false}>{level === 'critical' ? 'Almost full' : 'Filling up'}</Badge>}
                    <span className="num text-[12px] text-muted">{formatGB(d.freeGB)} free of {formatGB(d.totalGB)}</span>
                  </span>
                </div>
                <UsageBar percent={d.usedPercent} compact hue="disk" />
              </li>
            );
          })}
        </ul>
      )}
      {hidden > 0 && <p className="mt-4 text-[11px] text-faint">{hidden} more on the Storage page, fullest drives shown first.</p>}
    </Panel>
  );
}

export default memo(StoragePanel);
