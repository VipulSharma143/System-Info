import { memo, useMemo } from 'react';
import { ArrowDown, ArrowUp, Cable } from 'lucide-react';
import type { NetworkInfo } from '../../../types/system';
import { formatRate } from '../../../lib/format';
import { interfaceRows, KIND_LABEL } from '../../../lib/network';
import { EmptyState } from '../../common/States';
import Panel from '../../common/Panel';
import { Badge } from '../../common/Primitives';

/** Every interface the OS reports as a card, active ones first. Loopback and idle adapters stay listed, marked Idle, never hidden. */
function InterfacesPanel({ network }: { network: NetworkInfo[] }) {
  const rows = useMemo(() => interfaceRows(network), [network]);
  const activeCount = rows.filter((r) => r.live).length;

  return (
    <Panel title="Interfaces" icon={Cable} hue="net" meta={`${rows.length} total · ${activeCount} active`}>
      {rows.length === 0 ? (
        <EmptyState icon={Cable} hue="net" title="No network interfaces reported" description="Connect to a network and this list fills in on its own." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ net, kind, live, share }) => (
            <li key={net.iface} className={`min-w-0 rounded-[var(--r-md)] border border-line px-4 py-3.5 ${live ? 'bg-surface-2' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-ink" title={net.iface}>{net.iface}</div>
                  <div className="text-[11px] text-faint" title="Inferred from the interface name">{KIND_LABEL[kind]}</div>
                </div>
                <Badge tone={live ? 'ok' : 'muted'}>{live ? 'Active' : 'Idle'}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
                <div><div className="flex items-center gap-1 text-faint"><ArrowDown className="h-3 w-3" />Download</div><div className="num mt-0.5 text-[13px] font-medium text-ink">{formatRate(net.rxKBps)}</div></div>
                <div><div className="flex items-center gap-1 text-faint"><ArrowUp className="h-3 w-3" />Upload</div><div className="num mt-0.5 text-[13px] font-medium text-ink">{formatRate(net.txKBps)}</div></div>
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-3" title={`${share.toFixed(0)}% of current traffic`}>
                <div className="h-full rounded-full bg-[var(--h)]" style={{ width: `${share}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default memo(InterfacesPanel);
