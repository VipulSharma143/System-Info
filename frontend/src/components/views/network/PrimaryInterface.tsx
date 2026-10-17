import { memo } from 'react';
import { Router } from 'lucide-react';
import type { NetworkInfo } from '../../../types/system';
import { formatRate } from '../../../lib/format';
import { interfaceRows, KIND_LABEL } from '../../../lib/network';
import { EmptyState } from '../../common/States';
import Panel from '../../common/Panel';
import { Badge, InfoRow } from '../../common/Primitives';

/** The busiest interface right now, as a small spec sheet. The type is a hint from the interface's name, and says so. */
function PrimaryInterface({ network }: { network: NetworkInfo[] }) {
  const top = interfaceRows(network)[0];

  return (
    <Panel title="Busiest interface" icon={Router} hue="net">
      {top ? (
        <>
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="num min-w-0 truncate text-[20px] font-semibold text-ink" title={top.net.iface}>{top.net.iface}</span>
            <Badge tone={top.live ? 'ok' : 'muted'}>{top.live ? 'Connected' : 'Idle'}</Badge>
          </div>
          <InfoRow label="Download" value={formatRate(top.net.rxKBps)} />
          <InfoRow label="Upload" value={formatRate(top.net.txKBps)} />
          <InfoRow label="Type" value={KIND_LABEL[top.kind]} hint="from its name" />
          <InfoRow label="Share of traffic" value={`${top.share.toFixed(0)}%`} />
        </>
      ) : (
        <EmptyState icon={Router} hue="net" title="No interfaces yet" />
      )}
    </Panel>
  );
}

export default memo(PrimaryInterface);
