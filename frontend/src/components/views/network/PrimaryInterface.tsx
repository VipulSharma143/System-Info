import { memo } from 'react';
import { Router } from 'lucide-react';
import type { NetworkInfo } from '../../../types/system';
import { formatRate } from '../../../lib/format';
import { EmptyState } from '../../common/States';
import Panel from '../../common/Panel';
import { Badge, InfoRow } from '../../common/Primitives';
import { isLive } from '../../../lib/network';

/** The busiest interface right now, as a small spec sheet. */
function PrimaryInterface({ network }: { network: NetworkInfo[] }) {
  const busiest = network.length > 0 ? network.reduce((a, b) => (b.rxKBps + b.txKBps > a.rxKBps + a.txKBps ? b : a)) : null;

  return (
    <Panel title="Busiest interface" icon={Router} hue="net">
      {busiest ? (
        <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="num truncate text-[18px] font-semibold text-ink">{busiest.iface}</span>
            <Badge tone={isLive(busiest) ? 'ok' : 'muted'}>{isLive(busiest) ? 'Connected' : 'Idle'}</Badge>
          </div>
          <InfoRow label="Download" value={formatRate(busiest.rxKBps)} />
          <InfoRow label="Upload" value={formatRate(busiest.txKBps)} />
          <InfoRow label="Interfaces" value={network.length} />
        </>
      ) : (
        <EmptyState icon={Router} hue="net" title="No interfaces yet" />
      )}
    </Panel>
  );
}

export default memo(PrimaryInterface);
