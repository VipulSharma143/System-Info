import { memo, useMemo } from 'react';
import { ArrowDown, ArrowUp, Waves } from 'lucide-react';
import { formatRate } from '../../../lib/format';
import Figure from '../../common/Figure';
import Legend from '../../common/Legend';
import Panel from '../../common/Panel';
import Sparkline from '../../common/Sparkline';
import { Badge } from '../../common/Primitives';

interface Props {
  rx: number;
  tx: number;
  rxHistory: number[];
  txHistory: number[];
  active: boolean;
}

/** Live traffic: two big readings and one chart where download and upload share a scale. */
function TrafficPanel({ rx, tx, rxHistory, txHistory, active }: Props) {
  // One scale for both series keeps up/down visually comparable.
  const scale = useMemo(() => (rxHistory.length > 0 ? Math.max(...rxHistory, ...txHistory) * 1.15 || 1 : 1), [rxHistory, txHistory]);

  return (
    <Panel
      variant="hero"
      title="Current traffic"
      icon={Waves}
      hue="net"
      action={<Badge tone={active ? 'ok' : 'muted'}>{active ? 'Active' : 'Idle'}</Badge>}
    >
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-muted"><ArrowDown className="h-3.5 w-3.5" style={{ color: 'var(--hue-net)' }} />Download</div>
          <Figure size="lg" value={formatRate(rx)} />
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-muted"><ArrowUp className="h-3.5 w-3.5" style={{ color: 'var(--hue-power)' }} />Upload</div>
          <Figure size="lg" value={formatRate(tx)} />
        </div>
      </div>
      <div className="relative mt-5 h-20">
        <div className="absolute inset-0"><Sparkline points={rxHistory} color="var(--hue-net)" max={scale} height={80} dot /></div>
        <div className="absolute inset-0"><Sparkline points={txHistory} color="var(--hue-power)" max={scale} height={80} dot /></div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <Legend items={[{ label: 'Download', color: 'var(--hue-net)' }, { label: 'Upload', color: 'var(--hue-power)' }]} />
        <span className="text-[12px] text-faint">last ~80 seconds</span>
      </div>
    </Panel>
  );
}

export default memo(TrafficPanel);
