import { memo } from 'react';
import { HardDrive } from 'lucide-react';
import type { DiskInfo } from '../../../types/system';
import { formatGB, severity, severityWord } from '../../../lib/format';
import { usageColor } from '../../../lib/hues';
import Figure from '../../common/Figure';
import Panel from '../../common/Panel';
import { Badge, type BadgeTone } from '../../common/Primitives';
import UsageBar from '../../common/UsageBar';

const TONE: Record<ReturnType<typeof severity>, BadgeTone> = { ok: 'ok', warn: 'warn', critical: 'critical' };

/** One drive: how full it is, what is left, and a plain-language state. */
function DriveCard({ disk }: { disk: DiskInfo }) {
  return (
    <Panel
      title={disk.name}
      icon={HardDrive}
      hue="disk"
      meta={disk.volumeLabel || disk.driveType}
      action={<Badge tone={TONE[severity(disk.usedPercent)]}>{severityWord(disk.usedPercent, ['Healthy', 'Low space', 'Almost full'])}</Badge>}
    >
      <div className="flex items-end justify-between gap-3">
        <Figure size="lg" value={disk.usedPercent.toFixed(0)} unit="% full" color={disk.usedPercent >= 70 ? usageColor(disk.usedPercent) : undefined} />
        <span className="num pb-1 text-right text-[12px] text-muted">
          <span className="block text-[15px] font-semibold text-ink">{formatGB(disk.freeGB, 1)}</span>
          free
        </span>
      </div>
      <div className="mt-3">
        <UsageBar percent={disk.usedPercent} hue="disk" hideValue />
      </div>
      <div className="mt-2.5 flex justify-between text-[12px] text-faint">
        <span>{formatGB(disk.usedGB)} used of {formatGB(disk.totalGB)}</span>
        <span>{disk.driveType}</span>
      </div>
    </Panel>
  );
}

export default memo(DriveCard);
